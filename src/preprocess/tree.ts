import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** 扫描时跳过的噪声目录 —— 保证轻档案体积足够小 */
export const IGNORED_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  'out',
  '.git',
  '.next',
  '.nuxt',
  '.turbo',
  '.cache',
  'coverage',
  '__pycache__',
  '.venv',
  'venv',
  '.pytest_cache',
  '.idea',
  '.vscode',
  'target',
  'vendor',
]);

const IGNORED_FILE_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.webp',
  '.woff', '.woff2', '.ttf', '.eot',
  '.lock', '.log', '.map',
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
    .filter((d) => (d.isDirectory() ? !IGNORED_DIRS.has(d.name) : !isIgnoredFile(d.name)))
    .map((d) => ({ name: d.name, isDir: d.isDirectory() }))
    .sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1));
}

function isIgnoredFile(name: string): boolean {
  if (name.startsWith('.')) return true;
  const dot = name.lastIndexOf('.');
  return dot > 0 && IGNORED_FILE_EXT.has(name.slice(dot));
}

/**
 * 扫描仓库,输出精简目录树与文件清单。
 * maxDepth 之外的层级折叠为 `.../`,避免深层目录把轻档案撑爆。
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

    for (const entry of entries) {
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
      if (!entry.isDir) {
        lines.push(`${indent}${entry.name}`);
        files.push(rel);
        continue;
      }
      lines.push(`${indent}${entry.name}/`);
      if (depth + 1 > maxDepth) {
        lines.push(`${indent}  .../`);
        continue;
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
