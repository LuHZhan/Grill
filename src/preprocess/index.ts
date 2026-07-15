import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { LightProfileSchema, type LightProfile, type Repo } from './schema.js';
import { scanRepo, assertRepoDir, type ScanResult } from './tree.js';
import { pickKeyModules, buildModules } from './modules.js';
import { readLinksConfig, validateLinks } from './links.js';

const USAGE = `用法:
  npm run preprocess -- --frontend <前端仓路径> --backend <后端仓路径> --links <链路配置.json> [--out <输出.json>]

参数:
  --frontend  被压测项目的前端仓库本地路径
  --backend   被压测项目的后端仓库本地路径
  --links     用户手写的链路配置文件(JSON,含 project_name 与 links[])
  --out       轻档案输出路径(默认 ./light-profile.json)

环境变量:
  DEEPSEEK_API_KEY  生成模块职责所需
`;

function warn(msg: string): void {
  console.warn(`[警告] ${msg}`);
}

async function buildRepo(
  name: string,
  root: string,
  scan: ScanResult,
  linkedPaths: string[],
): Promise<Repo> {
  const keyPaths = pickKeyModules(scan.files, linkedPaths);
  console.log(`  ${name}:${scan.files.length} 个文件,挑出 ${keyPaths.length} 个关键模块`);
  const modules = await buildModules(root, keyPaths, warn);
  return { name, path: root, tree: scan.tree, modules };
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      frontend: { type: 'string' },
      backend: { type: 'string' },
      links: { type: 'string' },
      out: { type: 'string', default: './light-profile.json' },
      help: { type: 'boolean', default: false },
    },
  });

  if (values.help || !values.frontend || !values.backend || !values.links) {
    console.log(USAGE);
    process.exit(values.help ? 0 : 1);
  }

  const frontendRoot = resolve(values.frontend);
  const backendRoot = resolve(values.backend);
  assertRepoDir('前端仓', frontendRoot);
  assertRepoDir('后端仓', backendRoot);

  const config = readLinksConfig(resolve(values.links));

  console.log('扫描仓库…');
  const frontendScan = scanRepo(frontendRoot);
  const backendScan = scanRepo(backendRoot);

  // 先校验链路再生成职责:链路配置写错时不该已经烧掉 LLM 调用
  const links = validateLinks(config.links, frontendScan.files, backendScan.files, warn);

  console.log('生成模块职责…');
  const frontend = await buildRepo(
    'frontend',
    frontendRoot,
    frontendScan,
    links.map((l) => l.frontend),
  );
  const backend = await buildRepo(
    'backend',
    backendRoot,
    backendScan,
    links.map((l) => l.backend),
  );

  const profile: LightProfile = {
    project_name: config.project_name,
    repos: [frontend, backend],
    links,
  };

  const validated = LightProfileSchema.safeParse(profile);
  if (!validated.success) {
    throw new Error(
      `轻档案未通过 schema 校验,不落盘:\n${validated.error.issues
        .map((i) => `  - ${i.path.join('.') || '(根)'}: ${i.message}`)
        .join('\n')}`,
    );
  }

  const outPath = resolve(values.out!);
  mkdirSync(dirname(outPath), { recursive: true });
  const json = JSON.stringify(validated.data, null, 2);
  writeFileSync(outPath, json, 'utf8');

  const kb = (Buffer.byteLength(json, 'utf8') / 1024).toFixed(1);
  console.log(`\n轻档案已落盘:${outPath}`);
  console.log(`体积:${kb} KB;链路 ${links.length} 条`);
}

main().catch((err: unknown) => {
  console.error(`[错误] ${(err as Error).message}`);
  process.exit(1);
});
