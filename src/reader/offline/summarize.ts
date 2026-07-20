import { z } from 'zod';
import { generateObject } from 'ai';
import { readerModel, DEFAULT_MODEL, type BaseLlmConfig } from '../llm.js';
import {
  LinkSchema,
  ProfileSchema,
  type BatchNote,
  type Contradiction,
  type FailedBatch,
  type Link,
  type Profile,
  type Repo,
} from '../schema.js';
import type { ConventionDoc } from './conventions.js';
import type { RepoManifest } from './manifest.js';

/**
 * S3 汇总:把分批笔记与约定文档重组成一份"指路地图"。
 *
 * 职责边界(设计:产出是目录而非单个 JSON):
 * - **LLM 产**需要理解才能得出的部分:地图正文分节、project_name、entrypoints、
 *   推导的 links、汇总的 open_questions。
 * - **代码机械拼**必须确定的部分:repos(扫描)、contradictions(S1)、
 *   failed_batches(S2)、用户手写 links、目录树附录(原样,不过 LLM)。
 *
 * GRILL.md 作为**独立 markdown**返回,绝不塞进 profile.json 的字符串字段
 * (设计决策 3:埋进 JSON 就等于永远没人改)。
 */

/**
 * S3 系统 Prompt —— 只讲取舍判据,不讲 JSON 结构(结构由下面的 schema 强制)。
 * 判据固定为一句:删掉这行,下游会不会误判?含 Include / Exclude 清单。
 */
const S3_SYSTEM_PROMPT = `你在把若干"分批精读笔记"和项目约定文档汇总成一份给下游用的"项目地图"。

这是地图,不是百科。每一行的取舍只有一条判据:**删掉这一行,下游会不会因此误判?** 不会,就删掉。

写进地图(Include):
- 跨模块的调用契约
- 架构决策与取舍(为什么这么设计,而非罗列它"是什么")
- 不显然的坑
- 用户自述与代码证据不一致之处(输入已给出 contradictions,择要点出)

不写进地图(Exclude):
- 逐文件的清单或组件表
- 构建 / 测试 / lint 命令
- 代码风格约定
- 语言通用常识
- 输入材料里没有依据的内容

各字段写什么:
- overview:项目定位,一句到一段
- architecture:模块如何协作、数据与控制流怎么走
- key_decisions:关键决策与取舍
- notable:不显然的坑、下游需警惕之处
- entrypoints:项目的入口文件路径
- open_questions:笔记中悬而未决、地图回答不了的问题
- inferred_links:你从证据推导出的功能关系;用户已提供的关系不要重复

忠实于输入,不臆造。若某一节没有够格写进地图的内容,给一句诚实的说明而非硬凑。`;

/** LLM 产出的部分(其余字段由代码补齐)。source 不交给模型 —— 推导来源由代码钉死 */
const MapSchema = z.object({
  project_name: z.string().min(1),
  overview: z.string(),
  architecture: z.string(),
  key_decisions: z.string(),
  notable: z.string(),
  entrypoints: z.array(z.string()),
  open_questions: z.array(z.string()),
  inferred_links: z.array(LinkSchema.omit({ source: true })),
});

export type MapFields = z.infer<typeof MapSchema>;

export interface SummarizeConfig extends BaseLlmConfig {
  maxOutputTokens: number;
}

export const DEFAULT_SUMMARIZE_CONFIG: SummarizeConfig = {
  model: DEFAULT_MODEL,
  temperature: 0.3,
  maxOutputTokens: 8192,
};

export interface SummarizeInput {
  repos: Repo[];
  notes: BatchNote[];
  conventions: ConventionDoc[];
  readmes: ConventionDoc[];
  manifests: RepoManifest[];
  contradictions: Contradiction[];
  failedBatches: FailedBatch[];
  userLinks: Link[];
}

/** GRILL.md 之外需要一并落盘的附属文件(路径相对于输出目录) */
export interface Sidecar {
  path: string;
  content: string;
}

export interface SummarizeResult {
  grillMarkdown: string;
  profile: Profile;
  sidecars: Sidecar[];
}

/**
 * 单个仓目录树内联进 GRILL.md 的字节上限。超过则外置到 sidecar 文件、正文放引用。
 *
 * 动因(面向大项目,如 UE 超大仓):目录树对巨型项目可达 MB 级,全量内联会毁掉
 * "地图精简"这一前提、并撑爆下游整篇读入 GRILL.md 的上下文。参照 Claude Code
 * `/init` 用 `@path/to/import` 引用大内容而非内联的做法 —— 小则内联(自包含),
 * 大则引用(正文保持精简)。逐字、不过 LLM 这两条性质在两种情形下都不变。
 */
const TREE_INLINE_LIMIT_BYTES = 8 * 1024;

/** 精读笔记 → 地图字段。默认走 DeepSeek,测试可注入 */
export type MapGenerator = (input: SummarizeInput) => Promise<MapFields>;

/**
 * 汇总为 GRILL.md 正文 + profile.json。
 *
 * profile 在返回前经 ProfileSchema 校验;不通过则抛错(上层据此非零退出、不落盘)。
 */
export async function summarize(
  input: SummarizeInput,
  config: SummarizeConfig,
  generate?: MapGenerator,
): Promise<SummarizeResult> {
  const gen = generate ?? makeDeepSeekGenerator(config);
  const map = await gen(input);

  const { markdown: grillMarkdown, sidecars } = renderMarkdown(map, input);

  // 用户 link 保留 source=user;LLM 推导的一律钉成 inferred,不信模型自报来源
  const links: Link[] = [
    ...input.userLinks,
    ...map.inferred_links.map((l) => ({ ...l, source: 'inferred' as const })),
  ];

  const profile: Profile = ProfileSchema.parse({
    project_name: map.project_name,
    repos: input.repos,
    links,
    entrypoints: map.entrypoints,
    open_questions: map.open_questions,
    contradictions: input.contradictions,
    failed_batches: input.failedBatches,
  });

  return { grillMarkdown, profile, sidecars };
}

/** 默认 DeepSeek 实现:把证据拼成 prompt,产出 MapFields */
function makeDeepSeekGenerator(config: SummarizeConfig): MapGenerator {
  return async (input) => {
    const { object } = await generateObject({
      model: readerModel(config.model),
      schema: MapSchema,
      schemaName: 'ProjectMap',
      system: S3_SYSTEM_PROMPT,
      prompt: renderEvidence(input),
      temperature: config.temperature,
      maxOutputTokens: config.maxOutputTokens,
      maxRetries: 2,
    });
    return object;
  };
}

/** 把 S3 的输入证据拼成一段供 LLM 阅读的文本 */
function renderEvidence(input: SummarizeInput): string {
  const parts: string[] = [];

  parts.push(`# 仓库\n${input.repos.map((r) => `- ${r.name}`).join('\n')}`);

  if (input.conventions.length > 0) {
    parts.push(
      `# 约定文档(高可信,由根向下)\n` +
        input.conventions.map((d) => `## ${d.path}\n${d.content}`).join('\n\n'),
    );
  }
  if (input.readmes.length > 0) {
    parts.push(`# README\n` + input.readmes.map((d) => `## ${d.path}\n${d.content}`).join('\n\n'));
  }
  if (input.manifests.length > 0) {
    parts.push(
      `# 依赖清单\n` +
        input.manifests
          .map((m) => `- ${m.repo}/${m.file}: ${m.dependencies.join(', ') || '(无)'}`)
          .join('\n'),
    );
  }
  if (input.notes.length > 0) {
    parts.push(`# 分批精读笔记\n${JSON.stringify(input.notes, null, 2)}`);
  }
  if (input.userLinks.length > 0) {
    parts.push(`# 用户已声明的功能关系(勿重复推导)\n${JSON.stringify(input.userLinks)}`);
  }
  if (input.contradictions.length > 0) {
    parts.push(`# 自述与代码证据的不一致\n${JSON.stringify(input.contradictions, null, 2)}`);
  }
  return parts.join('\n\n');
}

/**
 * 渲染 GRILL.md:LLM 正文分节 + 盲区标注(若有)+ 目录树附录。
 * 目录树逐字附上、不经 LLM 改写(设计决策 7:转述必然有损);树过大时外置到
 * sidecar 文件、正文放引用(仍逐字,只是不内联)。
 */
function renderMarkdown(
  map: MapFields,
  input: SummarizeInput,
): { markdown: string; sidecars: Sidecar[] } {
  const lines: string[] = [];
  const sidecars: Sidecar[] = [];
  lines.push(`# ${map.project_name}`, '');
  lines.push('## 项目概述', '', map.overview, '');
  lines.push('## 架构', '', map.architecture, '');
  lines.push('## 关键决策', '', map.key_decisions, '');
  lines.push('## 值得注意', '', map.notable, '');

  // 入口主要进 profile.json,但列在地图里便于读者快速定位
  if (map.entrypoints.length > 0) {
    lines.push('## 入口', '', ...map.entrypoints.map((e) => `- \`${e}\``), '');
  }

  // 盲区标注:失败批次非空时必须显式,否则下游会把"没写"读成"没有"(设计决策 8)
  if (input.failedBatches.length > 0) {
    lines.push('## ⚠️ 未分析区域(精读失败,非"不存在")', '');
    for (const b of input.failedBatches) {
      lines.push(`- **${b.batch}**(${b.paths.length} 文件):${b.reason}`);
    }
    lines.push('');
  }

  // 目录树附录:小则内联,大则外置引用
  lines.push('## 目录树', '');
  for (const repo of input.repos) {
    lines.push(`### ${repo.name}`, '');
    if (Buffer.byteLength(repo.tree, 'utf8') <= TREE_INLINE_LIMIT_BYTES) {
      lines.push('```', repo.tree, '```', '');
    } else {
      const rel = `trees/${sanitize(repo.name)}.txt`;
      sidecars.push({ path: rel, content: repo.tree });
      const kb = (Buffer.byteLength(repo.tree, 'utf8') / 1024).toFixed(1);
      lines.push(
        `目录树较大(${kb} KB,~${countFiles(repo.tree)} 文件),已外置:见 [\`${rel}\`](${rel})`,
        '',
      );
    }
  }

  return { markdown: lines.join('\n'), sidecars };
}

/** 粗估目录树里的文件数:非目录行(不以 `/` 结尾)计一个 */
function countFiles(tree: string): number {
  return tree.split('\n').filter((l) => l.trim() && !l.trimEnd().endsWith('/')).length;
}

/** 仓名转安全文件名 */
function sanitize(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]+/g, '__');
}
