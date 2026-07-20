import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseCliArgs, assertReadableFile } from '../../src/reader/cli.js';

const base = [
  '--repo', 'G:/x/frontend',
  '--repo', 'G:/x/backend',
  '--resume', 'G:/x/resume.md',
  '--jd', 'G:/x/jd.md',
];

describe('parseCliArgs —— 仓库列表 + 简历 + JD + 可选关系配置 + 输出目录', () => {
  test('接受多个 --repo', () => {
    expect(parseCliArgs(base).repos).toEqual(['G:/x/frontend', 'G:/x/backend']);
  });

  test('单仓也合法 —— 不再强制前后端成对', () => {
    const single = ['--repo', 'G:/x/mono', '--resume', 'r.md', '--jd', 'j.md'];
    expect(parseCliArgs(single).repos).toEqual(['G:/x/mono']);
  });

  test('关系配置可省略', () => {
    expect(parseCliArgs(base).links).toBeUndefined();
  });

  test('给出关系配置时读入', () => {
    expect(parseCliArgs([...base, '--links', 'L.json']).links).toBe('L.json');
  });

  test('输出目录有默认值', () => {
    expect(parseCliArgs(base).out).toBeTruthy();
  });

  test('输出目录可覆盖', () => {
    expect(parseCliArgs([...base, '--out', 'G:/out/whatif']).out).toBe('G:/out/whatif');
  });

  test('一个 --repo 都没有时报错', () => {
    expect(() => parseCliArgs(['--resume', 'r.md', '--jd', 'j.md'])).toThrow(/repo/);
  });

  test('缺少简历时报错并点名', () => {
    expect(() => parseCliArgs(['--repo', 'G:/x', '--jd', 'j.md'])).toThrow(/简历/);
  });

  test('缺少 JD 时报错并点名', () => {
    expect(() => parseCliArgs(['--repo', 'G:/x', '--resume', 'r.md'])).toThrow(/JD/);
  });
});

describe('assertReadableFile —— 简历/JD 文件存在性(7.5 / spec:文件不存在报错退出)', () => {
  let dir: string;
  let realFile: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'grill-cli-'));
    realFile = join(dir, 'resume.md');
    writeFileSync(realFile, '简历内容');
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  test('文件存在时通过', () => {
    expect(() => assertReadableFile('简历履历', realFile)).not.toThrow();
  });

  test('文件不存在时报错并点名是哪一份', () => {
    expect(() => assertReadableFile('简历履历', join(dir, 'nope.md'))).toThrow(/简历履历.*不存在/);
  });

  test('路径是目录而非文件时报错', () => {
    expect(() => assertReadableFile('岗位 JD', dir)).toThrow(/JD.*不是文件/);
  });
});
