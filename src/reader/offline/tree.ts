import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 扫描时跳过的噪声目录(小写,匹配时大小写不敏感)—— 保证轻档案体积足够小。
 * 隐藏目录(`.` 开头)由 isIgnoredDir 统一跳过,无需在此逐个列举。
 */
export const IGNORED_DIRS = new Set([
  'node_modules',
  'dist',
  'dist-electron',
  'build',
  'out',
  'coverage',
  '__pycache__',
  'venv',
  'target',
  'vendor',
  // 对"给裁判找接缝的弹药"零价值的噪声:测试、文档、日志
  'tests',
  'test',
  '__tests__',
  'docs',
  'logs',
]);

const IGNORED_FILE_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.webp',
  '.woff', '.woff2', '.ttf', '.eot',
  '.lock', '.log', '.map',
  // 样式对"项目做了什么、怎么做的"零信息量 —— 用了什么 CSS 方案从依赖清单就能看出
  '.css', '.scss', '.sass', '.less',
]);

/**
 * 按**文件名**忽略的锁文件(小写匹配)。
 * `.lock` 后缀的(yarn.lock/Cargo.lock/poetry.lock)已由 IGNORED_FILE_EXT 覆盖,
 * 这里补的是后缀伪装成源码的那批 —— pnpm-lock.yaml 是 `.yaml`、
 * package-lock.json 是 `.json`,曾漏掉近 500 KB 纯噪声。
 */
const IGNORED_FILE_NAMES = new Set([
  'package-lock.json',
  'npm-shrinkwrap.json',
  'pnpm-lock.yaml',
  'bun.lockb',
  'go.sum',
]);

export interface ScanResult {
  /** 精简目录树,渲染为缩进文本 */
  tree: string;
  /** 仓内所有文件的相对路径(posix 分隔符),供链路校验与关键模块识别使用 */
  files: string[];
}

interface Entry {
  name: string;
  isDir: boolean;
}

function readEntries(dir: string): Entry[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => (d.isDirectory() ? !isIgnoredDir(d.name) : !isIgnoredFile(d.name)))
    .map((d) => ({ name: d.name, isDir: d.isDirectory() }))
    .sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1));
}

/** 隐藏目录(.git/.next/.vscode/.claude 等)一律跳过;其余按忽略清单大小写不敏感匹配 */
function isIgnoredDir(name: string): boolean {
  if (name.startsWith('.')) return true;
  return IGNORED_DIRS.has(name.toLowerCase());
}

function isIgnoredFile(name: string): boolean {
  if (name.startsWith('.')) return true;
  if (IGNORED_FILE_NAMES.has(name.toLowerCase())) return true;
  const dot = name.lastIndexOf('.');
  return dot > 0 && IGNORED_FILE_EXT.has(name.slice(dot).toLowerCase());
}

/**
 * 扫描仓库,输出精简目录树与文件清单。
 *
 * maxDepth 只影响**目录树的渲染**(超深层折叠为 `.../`,避免撑爆轻档案),
 * 不影响 `files` 的**采集** —— 全深度收集。两者必须分开:
 * files 是链路校验与关键模块识别的依据,少收一个文件会让用户手写的
 * 链路被误报"仓库中不存在",而那恰恰是裁判最该拿到的弹药。
 */
export function scanRepo(root: string, maxDepth = 6): ScanResult {
  const lines: string[] = [];
  const files: string[] = [];

  function walk(dir: string, relDir: string, depth: number, indent: string): void {
    let entries: Entry[];
    try {
      entries = readEntries(dir);
    } catch {
      return; // 读不动的目录(权限等)直接跳过,不阻断整体扫描
    }

    const rendering = depth <= maxDepth;

    for (const entry of entries) {
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
      if (!entry.isDir) {
        files.push(rel);
        if (rendering) lines.push(`${indent}${entry.name}`);
        continue;
      }
      if (rendering) {
        lines.push(`${indent}${entry.name}/`);
        // 子层已超出渲染深度:树里折叠成 `.../`,但仍继续递归采集 files
        if (depth + 1 > maxDepth) lines.push(`${indent}  .../`);
      }
      walk(join(dir, entry.name), rel, depth + 1, `${indent}  `);
    }
  }

  walk(root, '', 1, '');
  return { tree: lines.join('\n'), files };
}

/** 校验仓库路径存在且是目录;不满足时抛错,由 CLI 转成非零退出码 */
export function assertRepoDir(label: string, path: string): void {
  let stat;
  try {
    stat = statSync(path);
  } catch {
    throw new Error(`${label}路径不存在:${path}`);
  }
  if (!stat.isDirectory()) {
    throw new Error(`${label}路径不是目录:${path}`);
  }
}
