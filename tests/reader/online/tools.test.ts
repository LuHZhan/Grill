import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  readFileRange,
  globFiles,
  grepFiles,
  makeReaderTools,
  MAX_READ_BYTES,
  type RepoScan,
} from '../../../src/reader/online/tools.js';
import { resolveRepoPath } from '../../../src/reader/repo.js';

let root: string;
let outside: string;
let repos: RepoScan[];

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'grill-tools-'));
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src', 'a.ts'), 'line one\nline two\nfoo bar\nlast');
  writeFileSync(join(root, 'src', 'b.ts'), 'export const b = 1;\nfoo again');
  mkdirSync(join(root, 'sub'));
  writeFileSync(join(root, 'sub', 'c.ts'), 'nothing here');
  writeFileSync(join(root, 'big.ts'), 'x'.repeat(MAX_READ_BYTES + 100));

  outside = mkdtempSync(join(tmpdir(), 'grill-outside-'));
  writeFileSync(join(outside, 'secret.txt'), 'SECRET');

  repos = [
    {
      name: 'repo',
      root,
      files: ['src/a.ts', 'src/b.ts', 'sub/c.ts', 'big.ts'],
    },
  ];
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

describe('resolveRepoPath —— 路径安全(不可信输入)', () => {
  test('仓内正常路径解析通过', () => {
    expect(() => resolveRepoPath('repo/src/a.ts', repos)).not.toThrow();
  });

  test('单仓时允许裸相对路径', () => {
    expect(() => resolveRepoPath('src/a.ts', repos)).not.toThrow();
  });

  test('.. 逃逸被拒', () => {
    expect(() => resolveRepoPath('repo/../../etc/passwd', repos)).toThrow(/逃逸|不在/);
  });

  test('仓外绝对路径被拒', () => {
    expect(() => resolveRepoPath(join(outside, 'secret.txt'), repos)).toThrow(/不在任何.*仓库/);
  });

  test('未知仓名前缀被拒(多仓时)', () => {
    const multi: RepoScan[] = [...repos, { name: 'other', root, files: [] }];
    expect(() => resolveRepoPath('nope/x.ts', multi)).toThrow(/缺少仓名前缀|仓库/);
  });

  test('经符号链接指向仓外被拒', () => {
    let linked = false;
    try {
      symlinkSync(outside, join(root, 'escape'), 'dir');
      linked = true;
    } catch {
      return; // 无权限建符号链接(Windows 常见),跳过
    }
    if (linked) {
      expect(() => resolveRepoPath('repo/escape/secret.txt', repos)).toThrow(/符号链接|逃逸/);
    }
  });
});

describe('readFileRange —— 读取与范围/超限(5.2/5.3/5.9)', () => {
  test('带行号读取整文件', () => {
    const out = readFileRange('repo/src/a.ts', {}, repos);
    expect(out).toContain('1\tline one');
    expect(out).toContain('3\tfoo bar');
  });

  test('范围读取:offset + limit', () => {
    const out = readFileRange('repo/src/a.ts', { offset: 1, limit: 2 }, repos);
    expect(out).toContain('2\tline two');
    expect(out).toContain('3\tfoo bar');
    expect(out).not.toContain('1\tline one');
    expect(out).toContain('共 4 行');
  });

  test('超体积文件全量读取时抛错并提示范围读取,不返回内容', () => {
    expect(() => readFileRange('repo/big.ts', {}, repos)).toThrow(/超过读取上限.*范围读取/s);
  });

  test('超体积文件用范围读取则放行', () => {
    const out = readFileRange('repo/big.ts', { offset: 0, limit: 1 }, repos);
    expect(out).toContain('1\t');
  });

  test('不存在的文件抛可读错误', () => {
    expect(() => readFileRange('repo/src/nope.ts', {}, repos)).toThrow(/不存在/);
  });

  test('目录被拒', () => {
    expect(() => readFileRange('repo/src', {}, repos)).toThrow(/是目录/);
  });
});

describe('globFiles —— 模式匹配与截断(5.4/5.6/5.7)', () => {
  test('** 跨目录匹配后缀', () => {
    const r = globFiles('repo/**/*.ts', {}, repos);
    expect(r.paths).toEqual(
      expect.arrayContaining(['repo/src/a.ts', 'repo/src/b.ts', 'repo/sub/c.ts', 'repo/big.ts']),
    );
  });

  test('段内 * 不跨目录', () => {
    const r = globFiles('repo/src/*.ts', {}, repos);
    expect(r.paths).toContain('repo/src/a.ts');
    expect(r.paths).not.toContain('repo/sub/c.ts');
  });

  test('超上限截断并标记', () => {
    const r = globFiles('repo/**/*.ts', { limit: 2 }, repos);
    expect(r.paths).toHaveLength(2);
    expect(r.truncated).toBe(true);
  });

  test('命中数恰好等于上限时不报截断', () => {
    const r = globFiles('repo/**/*.ts', { limit: 4 }, repos); // 恰好 4 个 .ts
    expect(r.truncated).toBe(false);
  });

  test('all=true 解除上限', () => {
    const r = globFiles('repo/**/*.ts', { limit: 1, all: true }, repos);
    expect(r.truncated).toBe(false);
    expect(r.paths.length).toBe(4);
  });

  test('offset 翻页', () => {
    const first = globFiles('repo/**/*.ts', { limit: 2 }, repos);
    const second = globFiles('repo/**/*.ts', { offset: 2, limit: 2 }, repos);
    expect(second.paths).not.toEqual(first.paths);
    expect(second.truncated).toBe(false); // 第二页取完
  });
});

describe('grepFiles —— 内容检索与截断(5.5/5.6/5.7)', () => {
  test('命中行带路径与行号', () => {
    const r = grepFiles('foo', {}, repos);
    expect(r.matches.some((m) => m.startsWith('repo/src/a.ts:3:'))).toBe(true);
    expect(r.matches.some((m) => m.startsWith('repo/src/b.ts:2:'))).toBe(true);
  });

  test('path 限定检索范围', () => {
    const r = grepFiles('foo', { path: 'repo/src/b.ts' }, repos);
    expect(r.matches.every((m) => m.startsWith('repo/src/b.ts'))).toBe(true);
  });

  test('超上限截断', () => {
    const r = grepFiles('foo', { limit: 1 }, repos);
    expect(r.matches).toHaveLength(1);
    expect(r.truncated).toBe(true);
  });

  test('命中数恰好等于上限时不报截断', () => {
    const r = grepFiles('foo', { limit: 2 }, repos); // 恰好 2 处 foo
    expect(r.truncated).toBe(false);
  });

  test('all=true 穷尽', () => {
    const r = grepFiles('foo', { limit: 1, all: true }, repos);
    expect(r.truncated).toBe(false);
    expect(r.matches.length).toBe(2);
  });
});

describe('makeReaderTools —— 工具封装把异常转成可读结果(5.9 不中断)', () => {
  test('read_file 读不存在文件返回错误字符串而非抛出', async () => {
    const tools = makeReaderTools(repos);
    const out = await tools.read_file.execute!(
      { path: 'repo/src/nope.ts' },
      { toolCallId: 't', messages: [] } as never,
    );
    expect(out).toMatch(/^错误:/);
    expect(out).toContain('不存在');
  });

  test('grep 非法正则返回错误字符串而非抛出', async () => {
    const tools = makeReaderTools(repos);
    const out = await tools.grep.execute!(
      { pattern: '(' },
      { toolCallId: 't', messages: [] } as never,
    );
    expect(out).toMatch(/^错误:/);
  });
});
