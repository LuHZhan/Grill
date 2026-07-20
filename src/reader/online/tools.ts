import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tool } from 'ai';
import { z } from 'zod';
import { scanRepo } from '../offline/tree.js';
import { resolveRepoPath, type RepoRoot } from '../repo.js';

/**
 * 阅读者的检索/读取工具集:read_file / glob / grep。
 *
 * 三个工具的路径与模式参数均为**模型输出,属不可信输入**。所有文件访问先过
 * resolveWithinRepos 的路径安全校验:解析为绝对路径后必须仍在已声明仓根内,
 * 拒绝 `..` 逃逸、符号链接指向仓外、以及仓外绝对路径(spec:阅读者注册工具)。
 *
 * 超限响应按工具性质区分(设计决策 11,对齐 Claude Code FileReadTool 实测):
 * - read_file 超体积**抛错**并提示改用范围读取(错误结果约百字节,截断则占满上限)。
 * - glob/grep 超条数**截断**并告知(搜索本就预期多命中,抛错等于什么都没返回)。
 */

/** 一个已扫描的仓:在仓身份之上加仓内相对文件清单(posix 分隔) */
export interface RepoScan extends RepoRoot {
  files: string[];
}

/** read_file 全量读取的字节上限;超过则要求改用范围读取 */
export const MAX_READ_BYTES = 256 * 1024;
/** glob/grep 默认结果条数上限 */
export const MAX_RESULTS = 100;

/** 扫描各仓,得到工具检索所依据的文件清单(与轻档案扫描同一忽略规则) */
export function scanReposForTools(roots: RepoRoot[]): RepoScan[] {
  return roots.map((r) => ({ name: r.name, root: r.root, files: scanRepo(r.root).files }));
}

// ---------------------------------------------------------------------------
// read_file
// ---------------------------------------------------------------------------

export interface ReadRange {
  offset?: number; // 起始行,0 基
  limit?: number; // 读取行数
}

/**
 * 读取单个文件,可选按行范围。全量读取超体积上限时抛错并提示改用范围读取
 * (不返回截断内容);范围读取是逃生口,不受体积上限约束。返回带行号的文本。
 */
export function readFileRange(input: string, range: ReadRange, repos: RepoScan[]): string {
  const { abs } = resolveRepoPath(input, repos);

  let st;
  try {
    st = statSync(abs);
  } catch {
    throw new Error(`文件不存在:${input}`);
  }
  if (st.isDirectory()) throw new Error(`${input} 是目录,不是文件;用 glob 列目录内容`);

  const isRange = range.offset !== undefined || range.limit !== undefined;
  if (!isRange && st.size > MAX_READ_BYTES) {
    throw new Error(
      `文件 ${input}(${fmtBytes(st.size)})超过读取上限 ${fmtBytes(MAX_READ_BYTES)};` +
        `请改用范围读取(提供 offset 起始行与 limit 行数),或用 grep 检索具体内容,不要整文件读入`,
    );
  }

  const lines = readFileSync(abs, 'utf8').split('\n');
  const start = range.offset ?? 0;
  const end = range.limit !== undefined ? start + range.limit : lines.length;
  const slice = lines.slice(start, end);
  const numbered = slice.map((l, i) => `${start + i + 1}\t${l}`).join('\n');
  const footer =
    end < lines.length || start > 0
      ? `\n\n(第 ${start + 1}–${start + slice.length} 行,共 ${lines.length} 行)`
      : '';
  return numbered + footer;
}

// ---------------------------------------------------------------------------
// glob
// ---------------------------------------------------------------------------

export interface SearchOpts {
  offset?: number; // 跳过前 N 条,供翻页
  limit?: number; // 本页条数上限
  all?: boolean; // 解除上限,穷尽检索(供"证明不存在")
}

export interface GlobResult {
  paths: string[];
  truncated: boolean;
  total: number;
}

/** 按 glob 模式在各仓文件清单中匹配,返回仓前缀路径。结果条数受上限约束 */
export function globFiles(pattern: string, opts: SearchOpts, repos: RepoScan[]): GlobResult {
  const re = globToRegExp(pattern);
  const all: string[] = [];
  for (const repo of repos) {
    for (const rel of repo.files) {
      const full = `${repo.name}/${rel}`;
      if (re.test(full)) all.push(full);
    }
  }
  all.sort();

  const offset = opts.offset ?? 0;
  const end = opts.all ? all.length : offset + (opts.limit ?? MAX_RESULTS);
  const paths = all.slice(offset, end);
  // 真截断才报:end 严格小于总数时才有被丢弃的结果(恰好等于上限则不报)
  const truncated = !opts.all && end < all.length;
  return { paths, truncated, total: all.length };
}

// ---------------------------------------------------------------------------
// grep
// ---------------------------------------------------------------------------

export interface GrepResult {
  matches: string[]; // 形如 `仓名/路径:行号: 行内容`
  truncated: boolean;
}

/** 在各仓源码中按正则检索,返回命中行。可选 path 把范围限定到某仓前缀子树 */
export function grepFiles(
  pattern: string,
  opts: SearchOpts & { path?: string },
  repos: RepoScan[],
): GrepResult {
  const re = new RegExp(pattern); // 模型给的正则;非法则由调用方 catch
  const offset = opts.offset ?? 0;
  const limit = opts.all ? Infinity : opts.limit ?? MAX_RESULTS;
  const scope = opts.path?.replace(/\\/g, '/');

  const hits: string[] = [];
  const ceiling = Number.isFinite(limit) ? offset + (limit as number) : Infinity;
  let truncated = false;

  outer: for (const repo of repos) {
    for (const rel of repo.files) {
      const full = `${repo.name}/${rel}`;
      if (scope && !full.startsWith(scope)) continue;
      let content: string;
      try {
        content = readFileSync(join(repo.root, rel), 'utf8');
      } catch {
        continue;
      }
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (!re.test(lines[i]!)) continue;
        if (hits.length >= ceiling) {
          truncated = true; // 还有命中却已到本页上限 → 真截断
          break outer;
        }
        hits.push(`${full}:${i + 1}: ${lines[i]!.trim()}`);
      }
    }
  }
  return { matches: hits.slice(offset), truncated };
}

// ---------------------------------------------------------------------------
// AI SDK 工具封装
// ---------------------------------------------------------------------------

/** 注册给阅读者 agent 的三个工具。核心函数抛错,这里 catch 成字符串返回给模型 —— 不中断流程 */
export function makeReaderTools(repos: RepoScan[]) {
  return {
    read_file: tool({
      description:
        '读取仓库内单个文件的内容。路径用「仓名/仓内相对路径」。文件过大时会报错,改用 offset(起始行)+ limit(行数)范围读取。',
      inputSchema: z.object({
        path: z.string().describe('仓名/相对路径,如 backend/api/game.py'),
        offset: z.number().int().nonnegative().optional().describe('起始行(0 基),仅在文件过大需分段时提供'),
        limit: z.number().int().positive().optional().describe('读取行数,仅在文件过大需分段时提供'),
      }),
      execute: async ({ path, offset, limit }) =>
        guard(() => readFileRange(path, { offset, limit }, repos)),
    }),

    glob: tool({
      description:
        '按 glob 模式(支持 ** / * / ?)列出匹配的文件路径。结果过多会截断,可用 offset 翻页,或 all=true 穷尽检索。',
      inputSchema: z.object({
        pattern: z.string().describe('glob 模式,如 backend/**/*.py'),
        offset: z.number().int().nonnegative().optional().describe('跳过前 N 条,用于翻页'),
        all: z.boolean().optional().describe('解除条数上限,穷尽检索(用于判定某类文件是否存在)'),
      }),
      execute: async ({ pattern, offset, all }) =>
        guard(() => formatGlob(globFiles(pattern, { offset, all }, repos))),
    }),

    grep: tool({
      description:
        '按正则在源码中检索命中行,可选 path 限定到某仓前缀子树。结果过多会截断,可用 offset 翻页,或 all=true 穷尽检索。',
      inputSchema: z.object({
        pattern: z.string().describe('正则表达式'),
        path: z.string().optional().describe('限定检索范围的仓前缀,如 backend/runtime'),
        offset: z.number().int().nonnegative().optional().describe('跳过前 N 条,用于翻页'),
        all: z.boolean().optional().describe('解除条数上限,穷尽检索'),
      }),
      execute: async ({ pattern, path, offset, all }) =>
        guard(() => formatGrep(grepFiles(pattern, { path, offset, all }, repos))),
    }),
  };
}

/** 把核心函数的异常转成可读字符串返回给模型,不让工具异常中断 agent 循环 */
function guard(fn: () => string): string {
  try {
    return fn();
  } catch (err) {
    return `错误:${err instanceof Error ? err.message : String(err)}`;
  }
}

function formatGlob(r: GlobResult): string {
  if (r.paths.length === 0) return '无匹配文件。';
  let out = r.paths.join('\n');
  if (r.truncated) {
    out += `\n\n(结果已截断,共约 ${r.total} 条;缩小模式、用 offset 翻页,或 all=true 穷尽检索)`;
  }
  return out;
}

function formatGrep(r: GrepResult): string {
  if (r.matches.length === 0) return '无命中。';
  let out = r.matches.join('\n');
  if (r.truncated) {
    out += `\n\n(结果已截断;缩小模式或用 path 限定范围、用 offset 翻页,或 all=true 穷尽检索)`;
  }
  return out;
}

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

/** glob 模式转正则:** → 跨目录,* → 段内任意,? → 段内单字符 */
function globToRegExp(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === '*') {
      if (glob[i + 1] === '*') {
        re += '.*';
        i++;
        if (glob[i + 1] === '/') i++; // 吸收 **/ 后的斜杠,让 **/x 也匹配顶层 x
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else if ('.+^${}()|[]\\'.includes(c)) {
      re += `\\${c}`;
    } else {
      re += c;
    }
  }
  return new RegExp(`^${re}$`);
}

function fmtBytes(n: number): string {
  return n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`;
}
