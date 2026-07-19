import { basename, resolve } from 'node:path';
import { parseCliArgs, assertReadableFile, USAGE } from './cli.js';
import { scanRepo, assertRepoDir } from './offline/tree.js';
import { readLinksConfig, validateLinks } from './offline/links.js';
import type { Link, Repo } from './schema.js';

function warn(msg: string): void {
  console.warn(`[警告] ${msg}`);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.length === 0) {
    console.log(USAGE);
    process.exit(argv.includes('--help') ? 0 : 1);
  }

  const options = parseCliArgs(argv);

  // 输入校验先于任何 LLM 调用:配置写错时不该已经烧掉调用额度
  const repoRoots = options.repos.map((p) => resolve(p));
  for (const root of repoRoots) assertRepoDir('仓库', root);
  assertReadableFile('简历履历', resolve(options.resume));
  assertReadableFile('岗位 JD', resolve(options.jd));

  console.log('扫描仓库…');
  const repos: Repo[] = [];
  const filesByRepo = new Map<string, Set<string>>();
  for (const root of repoRoots) {
    const name = basename(root);
    const scan = scanRepo(root);
    repos.push({ name, path: root, tree: scan.tree });
    filesByRepo.set(name, new Set(scan.files));
    console.log(`  ${name}:${scan.files.length} 个文件`);
  }

  let links: Link[] = [];
  if (options.links) {
    const config = readLinksConfig(resolve(options.links));
    links = validateLinks(config.links, filesByRepo, warn);
    console.log(`关系配置:${links.length}/${config.links.length} 条通过校验`);
  } else {
    console.log('未提供关系配置,关系将由阅读者推导');
  }

  // TODO(任务 2.2-2.6):约定文档收集、清单提取、证据分级、contradictions
  // TODO(任务 3.x):分批精读,笔记落盘到 notes/
  // TODO(任务 4.x):汇总为 GRILL.md + profile.json 并落盘到 options.out
  console.log(`\n产物目录(尚未写出):${resolve(options.out)}`);
}

main().catch((err: unknown) => {
  console.error(`[错误] ${(err as Error).message}`);
  process.exit(1);
});
