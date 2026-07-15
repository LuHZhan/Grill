import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deepseek } from '@ai-sdk/deepseek';
import { generateText } from 'ai';
import type { Module } from './schema.js';

/** 单模块 LLM 失败时写入的占位值 —— 裁判仍可靠 read_file 自行下钻补足 */
export const ROLE_PLACEHOLDER = '(职责未生成)';

const MODEL = 'deepseek-chat';
/** 喂给 LLM 的源码上限,控制 prompt 体积 */
const MAX_SOURCE_CHARS = 4000;
/** 每个仓生成职责的模块数上限,控制调用次数与轻档案体积 */
const MAX_MODULES_PER_REPO = 25;
const CONCURRENCY = 5;

const ENTRY_BASENAMES = [
  'index', 'main', 'app', 'server', 'router', 'routes', 'api', 'client', 'store',
];
const SOURCE_EXT = ['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.java', '.rs'];

function isSourceFile(path: string): boolean {
  return SOURCE_EXT.some((ext) => path.endsWith(ext));
}

function isEntryFile(path: string): boolean {
  const base = path.slice(path.lastIndexOf('/') + 1);
  const stem = base.slice(0, base.lastIndexOf('.'));
  return ENTRY_BASENAMES.includes(stem.toLowerCase());
}

/**
 * 挑出"关键模块":links 引用的文件优先(信息密度最高,是裁判找接缝的弹药),
 * 其次补入口文件。总数封顶,避免对全仓逐个调 LLM。
 */
export function pickKeyModules(files: string[], linkedPaths: string[]): string[] {
  const linked = linkedPaths.filter((p) => files.includes(p));
  const picked = new Set(linked);

  for (const file of files) {
    if (picked.size >= MAX_MODULES_PER_REPO) break;
    if (isSourceFile(file) && isEntryFile(file)) picked.add(file);
  }
  return [...picked].slice(0, MAX_MODULES_PER_REPO);
}

const SYSTEM_PROMPT =
  '你是一个代码分析助手。读一个源码文件,用一句话(不超过 30 字)概括它在项目里的职责。' +
  '只输出这句话本身,不要引号、不要前缀、不要解释。';

async function generateRole(repoRoot: string, relPath: string): Promise<string> {
  const source = readFileSync(join(repoRoot, relPath), 'utf8').slice(0, MAX_SOURCE_CHARS);
  const { text } = await generateText({
    model: deepseek(MODEL),
    system: SYSTEM_PROMPT,
    prompt: `文件路径:${relPath}\n\n源码:\n${source}`,
  });
  return text.trim();
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * 为关键模块生成一句话职责。单个模块失败时降级为占位 + 告警,
 * 不中断整体流程 —— 预处理是一次性离线任务,局部失败不该让整场重跑。
 */
export async function buildModules(
  repoRoot: string,
  keyPaths: string[],
  warn: (msg: string) => void,
): Promise<Module[]> {
  return mapWithConcurrency(keyPaths, CONCURRENCY, async (path) => {
    try {
      const role = await generateRole(repoRoot, path);
      return { path, role: role || ROLE_PLACEHOLDER };
    } catch (err) {
      warn(`模块职责生成失败,已置占位:${path} —— ${(err as Error).message}`);
      return { path, role: ROLE_PLACEHOLDER };
    }
  });
}
