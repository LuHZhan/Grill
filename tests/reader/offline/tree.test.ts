import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanRepo } from '../../../src/reader/offline/tree.js';

/**
 * 忽略清单的回归确认(任务 2.1):dist-electron、后缀伪装的锁文件、样式文件
 * 三类噪声必须既不进目录树、也不进待精读的文件清单。
 */
describe('scanRepo —— 忽略清单回归', () => {
  let root: string;
  let scan: ReturnType<typeof scanRepo>;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'grill-tree-'));
    // 真实源码
    mkdirSync(join(root, 'src'));
    writeFileSync(join(root, 'src', 'index.ts'), 'export const x = 1;');
    // 构建产物目录:后缀不足以识别,靠目录名忽略
    mkdirSync(join(root, 'dist-electron'));
    writeFileSync(join(root, 'dist-electron', 'main.js'), '// built');
    mkdirSync(join(root, 'node_modules'));
    writeFileSync(join(root, 'node_modules', 'dep.js'), '// dep');
    // 后缀伪装成源码的锁文件
    writeFileSync(join(root, 'package-lock.json'), '{}');
    writeFileSync(join(root, 'pnpm-lock.yaml'), 'lockfileVersion: 9');
    writeFileSync(join(root, 'go.sum'), 'h1:abc');
    // 样式文件
    writeFileSync(join(root, 'app.css'), 'body{}');
    writeFileSync(join(root, 'theme.scss'), '$c: red;');
    // 大小写不敏感:后缀大写同样忽略
    writeFileSync(join(root, 'ICON.PNG'), 'x');

    scan = scanRepo(root);
  });

  afterAll(() => rmSync(root, { recursive: true, force: true }));

  test('真实源码进入文件清单', () => {
    expect(scan.files).toContain('src/index.ts');
  });

  test('dist-electron 与 node_modules 不进清单也不进树', () => {
    expect(scan.files.some((f) => f.startsWith('dist-electron/'))).toBe(false);
    expect(scan.files.some((f) => f.startsWith('node_modules/'))).toBe(false);
    expect(scan.tree).not.toContain('dist-electron');
    expect(scan.tree).not.toContain('node_modules');
  });

  test('后缀伪装的锁文件既不进清单也不进树', () => {
    for (const lock of ['package-lock.json', 'pnpm-lock.yaml', 'go.sum']) {
      expect(scan.files).not.toContain(lock);
      expect(scan.tree).not.toContain(lock);
    }
  });

  test('样式文件被忽略', () => {
    expect(scan.files).not.toContain('app.css');
    expect(scan.files).not.toContain('theme.scss');
  });

  test('后缀匹配大小写不敏感', () => {
    expect(scan.files).not.toContain('ICON.PNG');
  });
});
