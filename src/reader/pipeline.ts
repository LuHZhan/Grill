import { readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { scanRepo } from './offline/tree.js';
import { validateLinks } from './offline/links.js';
import { collectConventions } from './offline/conventions.js';
import { extractManifests, type RepoManifest } from './offline/manifest.js';
import { assembleEvidence, evaluateShortCircuit } from './offline/evidence.js';
import { detectContradictions } from './offline/contradictions.js';
import { planBatches, type FileEntry } from './offline/batch.js';
import {
  deepReadBatches,
  DEFAULT_DEEPREAD_CONFIG,
  type BatchNoteGenerator,
} from './offline/deepread.js';
import {
  summarize,
  DEFAULT_SUMMARIZE_CONFIG,
  type MapGenerator,
  type Sidecar,
} from './offline/summarize.js';
import { resolveRepoPath, type RepoRoot } from './repo.js';
import type { BatchNote, Contradiction, FailedBatch, Link, Profile, Repo } from './schema.js';

/** 单批精读的 token 预算(设计 Open Question,MVP 保守取值,留足到 100K 上限的余量) */
export const READ_BUDGET_TOKENS = 40_000;

export interface GenerateGrillInput {
  /** 被测仓库的绝对根(调用方已校验存在) */
  repoRoots: string[];
  /** 简历履历原文 */
  resume: string;
  /** 岗位 JD 原文 */
  jd: string;
  /** 用户手写的关系(未校验;管道会按扫描结果校验存在性),不给则由阅读者推导 */
  rawLinks?: Link[];
  /** 输出目录 —— 仅用于定位 notes/ 缓存;管道不写 GRILL.md/profile.json(交给外壳) */
  outDir: string;
}

export interface GenerateGrillDeps {
  log?: (msg: string) => void;
  warn?: (msg: string) => void;
  /** 注入 S2 精读的 LLM 调用(测试用);不给则走真实 DeepSeek */
  batchGenerate?: BatchNoteGenerator;
  /** 注入 S3 汇总的 LLM 调用(测试用);不给则走真实 DeepSeek */
  mapGenerate?: MapGenerator;
  /** 覆盖批预算(测试用) */
  budgetTokens?: number;
}

export interface GrillArtifacts {
  grillMarkdown: string;
  profile: Profile;
  sidecars: Sidecar[];
  notes: BatchNote[];
  failedBatches: FailedBatch[];
}

/**
 * 离线生成管道(S0→S3)—— 纯逻辑:进参数、出产物,不解析命令行、不写盘、不退进程。
 *
 * 这样整条管道能注入假 LLM 做端到端单测,而命令行外壳(index.ts)只管 IO 与退出码。
 * LLM 调用两处都可注入(batchGenerate / mapGenerate),不注入则走真实 DeepSeek。
 */
export async function generateGrill(
  input: GenerateGrillInput,
  deps: GenerateGrillDeps = {},
): Promise<GrillArtifacts> {
  const log = deps.log ?? ((): void => {});
  const warn = deps.warn ?? ((): void => {});
  const budget = deps.budgetTokens ?? READ_BUDGET_TOKENS;

  // S0 扫描:目录树、文件清单(带体积)、清单字段
  log('扫描仓库…');
  const repos: Repo[] = [];
  const repoIds: RepoRoot[] = [];
  const filesByRepo = new Map<string, Set<string>>();
  const fileEntries: FileEntry[] = [];
  const manifests: RepoManifest[] = [];
  for (const root of input.repoRoots) {
    const name = basename(root);
    const scan = scanRepo(root);
    repos.push({ name, path: root, tree: scan.tree });
    repoIds.push({ name, root });
    filesByRepo.set(name, new Set(scan.files));
    for (const rel of scan.files) {
      fileEntries.push({ path: `${name}/${rel}`, bytes: statSync(join(root, rel)).size });
    }
    manifests.push(...extractManifests(root, name));
    log(`  ${name}:${scan.files.length} 个文件`);
  }
  const allFiles = fileEntries.map((f) => f.path);

  // 用户关系:按扫描结果校验存在性,写错的跳过并告警
  let links: Link[] = [];
  if (input.rawLinks) {
    links = validateLinks(input.rawLinks, filesByRepo, warn);
    log(`关系配置:${links.length}/${input.rawLinks.length} 条通过校验`);
  } else {
    log('未提供关系配置,关系将由阅读者推导');
  }

  // 约定文档:自各仓根向上遍历收集
  const docs = collectConventions(input.repoRoots);
  const conventionCount = docs.filter((d) => d.kind === 'convention').length;
  log(`约定文档:${conventionCount} 份约定 + ${docs.length - conventionCount} 份 README`);
  const depCount = manifests.reduce((n, m) => n + m.dependencies.length, 0);
  log(`清单文件:${manifests.length} 份(依赖名合计 ${depCount} 个)`);

  // S1 证据分级 + 短路判据
  const evidence = assembleEvidence(input.resume, input.jd, docs, manifests);
  const shortCircuit = evaluateShortCircuit(evidence.conventions);
  log(`短路判据:${shortCircuit.reason}`);

  // contradictions(不修正用户说法)
  const contradictions: Contradiction[] = detectContradictions(input.resume, manifests, allFiles);
  if (contradictions.length > 0) {
    log(`发现 ${contradictions.length} 处自述与代码证据不一致:`);
    for (const c of contradictions) log(`  - ${c.claim} —— ${c.evidence}`);
  }

  // S2 分批精读:短路未触发时才跑
  const notesDir = join(input.outDir, 'notes');
  let notes: BatchNote[] = [];
  let failedBatches: FailedBatch[] = [];
  if (shortCircuit.skip) {
    log('已短路,跳过 S2 分批精读');
  } else {
    const batches = planBatches(fileEntries, budget);
    log(`\n分批精读:${fileEntries.length} 个文件切成 ${batches.length} 批(预算 ${budget} token/批)`);
    const readContent = (path: string): string =>
      readFileSync(resolveRepoPath(path, repoIds).abs, 'utf8');
    const result = await deepReadBatches(batches, { ...DEFAULT_DEEPREAD_CONFIG, notesDir }, {
      readContent,
      generate: deps.batchGenerate,
      log,
    });
    notes = result.notes;
    failedBatches = result.failed;
    log(`精读完成:${notes.length} 批成功,${failedBatches.length} 批失败,笔记落盘到 ${notesDir}`);
  }

  // S3 汇总 → GRILL.md + profile.json(profile 在 summarize 内经 Zod 校验)
  log('\n汇总生成地图…');
  const { grillMarkdown, profile, sidecars } = await summarize(
    {
      repos,
      notes,
      conventions: evidence.conventions,
      readmes: evidence.readmes,
      manifests,
      contradictions,
      failedBatches,
      userLinks: links,
    },
    DEFAULT_SUMMARIZE_CONFIG,
    deps.mapGenerate,
  );

  return { grillMarkdown, profile, sidecars, notes, failedBatches };
}
