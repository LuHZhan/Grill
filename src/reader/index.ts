import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parseCliArgs, assertReadableFile, USAGE } from './cli.js';
import { assertRepoDir } from './offline/tree.js';
import { readLinksConfig } from './offline/links.js';
import { generateGrill } from './pipeline.js';

/**
 * 命令行外壳:解析入参、校验、读文件、装载 key、落盘、退出码。
 * 真正的生成逻辑在 generateGrill(纯管道),这里只负责与外界(argv / 文件系统 / 进程)打交道。
 */

function warn(msg: string): void {
  console.warn(`[警告] ${msg}`);
}

/** 尝试把 .env.local 读进 process.env —— tsx 不像 Next.js 会自动加载 */
function loadLocalEnv(): void {
  try {
    process.loadEnvFile('.env.local');
  } catch {
    // 文件不存在时静默:key 也可能由 shell 环境注入
  }
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

  const resume = readFileSync(resolve(options.resume), 'utf8');
  const jd = readFileSync(resolve(options.jd), 'utf8');
  const rawLinks = options.links ? readLinksConfig(resolve(options.links)).links : undefined;

  // S2/S3 都要调 LLM,key 缺失时提前失败,别等扫描白跑
  loadLocalEnv();
  if (!process.env.DEEPSEEK_API_KEY) {
    throw new Error('缺少 DEEPSEEK_API_KEY:请在 .env.local 或环境变量中提供');
  }

  const outDir = resolve(options.out);
  const { grillMarkdown, profile, sidecars, notes } = await generateGrill(
    { repoRoots, resume, jd, rawLinks, outDir },
    { log: (msg) => console.log(msg), warn },
  );

  // profile 已在管道内经 Zod 校验;走到这里即合法,落盘
  mkdirSync(outDir, { recursive: true });
  const grillPath = join(outDir, 'GRILL.md');
  const profilePath = join(outDir, 'profile.json');
  const profileJson = `${JSON.stringify(profile, null, 2)}\n`;
  writeFileSync(grillPath, grillMarkdown, 'utf8');
  writeFileSync(profilePath, profileJson, 'utf8');
  for (const s of sidecars) {
    const abs = join(outDir, s.path);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, s.content, 'utf8');
  }

  console.log('\n产物:');
  console.log(`  ${grillPath}(${byteSize(grillMarkdown)})`);
  console.log(`  ${profilePath}(${byteSize(profileJson)})`);
  for (const s of sidecars) console.log(`  ${join(outDir, s.path)}(${byteSize(s.content)})`);
  if (notes.length > 0) console.log(`  ${join(outDir, 'notes')}/(${notes.length} 份笔记)`);
}

/** 人类可读的字节体积 */
function byteSize(text: string): string {
  const bytes = Buffer.byteLength(text, 'utf8');
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
}

main().catch((err: unknown) => {
  console.error(`[错误] ${(err as Error).message}`);
  process.exit(1);
});
