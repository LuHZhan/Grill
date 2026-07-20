import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';

/**
 * 约定文档的两档可信度。
 *
 * `convention`(CLAUDE.md / AGENTS.md / 各家 AI 编码工具的规则文件)是"人专门
 * 写给读者的项目约定",可信度高于 `readme` —— README 常年失修、混杂安装步骤与
 * 营销话术。证据分级里两者分属相邻但不同的档位,故在收集阶段就打上标签。
 */
export type ConventionKind = 'convention' | 'readme';

export interface ConventionDoc {
  /** 文档的绝对路径 —— 兼作跨仓去重的键 */
  path: string;
  kind: ConventionKind;
  content: string;
}

/**
 * 按文件名(小写)判档的**扁平**约定文件;不在表内的不收集。
 *
 * 除 CLAUDE.md / AGENTS.md 外,还覆盖各家 AI 编码工具的规则文件 —— 它们同样是
 * "人手写的高信号约定",是证据分级第二档该抓的东西。参照 Claude Code `/init`
 * 命令 survey 的规则文件清单(`.cursorrules` / `.clinerules` /
 * `.windsurfrules` / copilot-instructions 等)。嵌套位置的规则见 collectLevel。
 */
const CONVENTION_KIND: ReadonlyMap<string, ConventionKind> = new Map([
  ['claude.md', 'convention'],
  ['claude.local.md', 'convention'],
  ['agents.md', 'convention'],
  ['.cursorrules', 'convention'],
  ['.clinerules', 'convention'],
  ['.windsurfrules', 'convention'],
  ['readme.md', 'readme'],
]);

/**
 * 自每个被扫描目录向上逐层遍历至文件系统根,逐层收集约定文档。
 *
 * 为什么向上而不是只看仓根:约定文档常写在 monorepo 根上而非子仓内 ——
 * 扫描 `WhatIf/frontend` 时,`WhatIf/CLAUDE.md` 必须能被看见(设计决策 5)。
 *
 * 去重与排序:
 * - 多个被扫描目录共享同一祖先时,祖先上的同一份文档只收一次(按绝对路径去重)。
 * - 结果按**由根向下**排序,让更靠近被扫描目录的约定排在更后面 —— 下游按顺序
 *   注入时,越具体的约定越晚出现、越能覆盖泛化约定。
 *
 * 读不到的层(权限、不存在)一律静默跳过:一次 readdir/read 失败无成本,
 * 不该因为祖先链上某个系统目录不可读就中断整场收集。
 */
export function collectConventions(scanDirs: string[]): ConventionDoc[] {
  const byPath = new Map<string, ConventionDoc>();

  for (const start of scanDirs) {
    let dir = resolve(start);
    // 向上遍历:parent === dir 时已到文件系统根(如 `C:\` 或 `/`),停止
    for (;;) {
      collectLevel(dir, byPath);
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }

  return [...byPath.values()].sort(
    (a, b) => depth(a.path) - depth(b.path) || a.path.localeCompare(b.path),
  );
}

/** 读取单层目录中命中的约定文档,写入去重表 */
function collectLevel(dir: string, byPath: Map<string, ConventionDoc>): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return; // 该层读不动(权限/不存在),跳过
  }

  // 本层的扁平约定文件
  for (const name of entries) {
    const kind = CONVENTION_KIND.get(name.toLowerCase());
    if (kind) tryStore(join(dir, name), kind, byPath);
  }

  // 嵌套位置的规则文件 —— 不在本层根下,而在固定子路径里(参照 CC /init 清单)
  tryStore(join(dir, '.github', 'copilot-instructions.md'), 'convention', byPath);
  collectCursorRules(join(dir, '.cursor', 'rules'), byPath);
}

/** 读取 `.cursor/rules/` 目录下的规则文件(新版 Cursor 用 .md / .mdc) */
function collectCursorRules(rulesDir: string, byPath: Map<string, ConventionDoc>): void {
  let entries: string[];
  try {
    entries = readdirSync(rulesDir);
  } catch {
    return;
  }
  for (const name of entries) {
    const lower = name.toLowerCase();
    if (lower.endsWith('.md') || lower.endsWith('.mdc')) {
      tryStore(join(rulesDir, name), 'convention', byPath);
    }
  }
}

/** 读一个约定文件写入去重表;已收过或读不出(不存在/是目录)一律跳过 */
function tryStore(path: string, kind: ConventionKind, byPath: Map<string, ConventionDoc>): void {
  if (byPath.has(path)) return;
  let content: string;
  try {
    content = readFileSync(path, 'utf8');
  } catch {
    return;
  }
  byPath.set(path, { path, kind, content });
}

/** 路径深度 = 路径分段数;越靠近文件系统根越小,用于"由根向下"排序 */
function depth(path: string): number {
  return path.split(sep).filter(Boolean).length;
}
