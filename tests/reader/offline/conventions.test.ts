import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectConventions } from '../../../src/reader/offline/conventions.js';

/**
 * 目录结构:
 *   <root>/CLAUDE.md          ← monorepo 根约定
 *   <root>/README.md          ← 根 README
 *   <root>/frontend/AGENTS.md ← 子仓约定
 *   <root>/frontend/src/      ← 被扫描目录
 */
describe('collectConventions —— 向上收集与由根向下排序', () => {
  let root: string;
  let scanDir: string;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'grill-conv-'));
    writeFileSync(join(root, 'CLAUDE.md'), '# 根约定');
    writeFileSync(join(root, 'README.md'), '# 根 README');
    mkdirSync(join(root, 'frontend', 'src'), { recursive: true });
    writeFileSync(join(root, 'frontend', 'AGENTS.md'), '# 前端约定');
  });

  afterAll(() => rmSync(root, { recursive: true, force: true }));

  test('自被扫描目录向上收集到 monorepo 根的约定文档', () => {
    scanDir = join(root, 'frontend', 'src');
    const docs = collectConventions([scanDir]);
    const names = docs.map((d) => d.path.replace(root, '').replace(/\\/g, '/'));
    expect(names).toContain('/CLAUDE.md');
    expect(names).toContain('/frontend/AGENTS.md');
  });

  test('README 与约定文档分档', () => {
    const docs = collectConventions([join(root, 'frontend', 'src')]);
    const claude = docs.find((d) => d.path.endsWith('CLAUDE.md'));
    const readme = docs.find((d) => d.path.endsWith('README.md'));
    expect(claude?.kind).toBe('convention');
    expect(readme?.kind).toBe('readme');
  });

  test('由根向下排序:根 CLAUDE.md 排在子仓 AGENTS.md 之前', () => {
    const docs = collectConventions([join(root, 'frontend', 'src')]);
    const iRoot = docs.findIndex((d) => d.path === join(root, 'CLAUDE.md'));
    const iSub = docs.findIndex((d) => d.path === join(root, 'frontend', 'AGENTS.md'));
    expect(iRoot).toBeGreaterThanOrEqual(0);
    expect(iRoot).toBeLessThan(iSub);
  });

  test('多个被扫描目录共享祖先时,同一份文档只收一次', () => {
    mkdirSync(join(root, 'backend'), { recursive: true });
    const docs = collectConventions([join(root, 'frontend', 'src'), join(root, 'backend')]);
    const rootClaudes = docs.filter((d) => d.path === join(root, 'CLAUDE.md'));
    expect(rootClaudes).toHaveLength(1);
  });

  test('无任何约定文档时返回空数组,不抛错', () => {
    const empty = mkdtempSync(join(tmpdir(), 'grill-conv-empty-'));
    // 注意:向上遍历会读到祖先链(如用户主目录)上的约定文档,故只断言不抛错
    expect(() => collectConventions([empty])).not.toThrow();
    rmSync(empty, { recursive: true, force: true });
  });
});

describe('collectConventions —— 各家 AI 工具规则文件', () => {
  let root: string;
  const pathsOf = (dir: string): string[] =>
    collectConventions([dir]).map((d) => d.path.replace(root, '').replace(/\\/g, '/'));

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'grill-conv-rules-'));
    writeFileSync(join(root, '.cursorrules'), 'cursor 旧版规则');
    writeFileSync(join(root, '.windsurfrules'), 'windsurf 规则');
    writeFileSync(join(root, 'CLAUDE.local.md'), '个人约定');
    mkdirSync(join(root, '.github'), { recursive: true });
    writeFileSync(join(root, '.github', 'copilot-instructions.md'), 'copilot 指令');
    mkdirSync(join(root, '.cursor', 'rules'), { recursive: true });
    writeFileSync(join(root, '.cursor', 'rules', 'style.mdc'), 'cursor 新版规则');
    writeFileSync(join(root, '.cursor', 'rules', 'notes.txt'), '不是规则文件,应忽略');
    mkdirSync(join(root, 'app'), { recursive: true });
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  test('扁平规则文件 .cursorrules / .windsurfrules / CLAUDE.local.md 被收', () => {
    const names = pathsOf(join(root, 'app'));
    expect(names).toContain('/.cursorrules');
    expect(names).toContain('/.windsurfrules');
    expect(names).toContain('/CLAUDE.local.md');
  });

  test('嵌套的 copilot-instructions.md 被收', () => {
    expect(pathsOf(join(root, 'app'))).toContain('/.github/copilot-instructions.md');
  });

  test('.cursor/rules 下的 .md/.mdc 被收,非规则后缀被忽略', () => {
    const names = pathsOf(join(root, 'app'));
    expect(names).toContain('/.cursor/rules/style.mdc');
    expect(names).not.toContain('/.cursor/rules/notes.txt');
  });

  test('这些规则文件都归 convention 档', () => {
    const docs = collectConventions([join(root, 'app')]).filter((d) => d.path.startsWith(root));
    for (const d of docs) expect(d.kind).toBe('convention');
  });
});
