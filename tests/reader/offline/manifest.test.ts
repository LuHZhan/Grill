import { afterEach, describe, expect, test } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractManifests } from '../../../src/reader/offline/manifest.js';

describe('extractManifests —— 只提取名称与依赖名', () => {
  let dirs: string[] = [];
  function repo(files: Record<string, string>): string {
    const root = mkdtempSync(join(tmpdir(), 'grill-mani-'));
    dirs.push(root);
    for (const [name, content] of Object.entries(files)) writeFileSync(join(root, name), content);
    return root;
  }

  afterEach(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
    dirs = [];
  });

  test('package.json:取 name 与 dependencies/devDependencies 的键', () => {
    const root = repo({
      'package.json': JSON.stringify({
        name: 'web',
        dependencies: { react: '^18', redis: '^4' },
        devDependencies: { vitest: '^4' },
      }),
    });
    const [m] = extractManifests(root, 'web');
    expect(m?.packageName).toBe('web');
    expect(m?.dependencies).toEqual(expect.arrayContaining(['react', 'redis', 'vitest']));
  });

  test('pyproject.toml:PEP 621 dependencies 数组', () => {
    const root = repo({
      'pyproject.toml': [
        '[project]',
        'name = "svc"',
        'dependencies = [',
        '  "fastapi>=0.1",',
        '  "psycopg[binary]==3.1",',
        ']',
      ].join('\n'),
    });
    const [m] = extractManifests(root, 'svc');
    expect(m?.packageName).toBe('svc');
    expect(m?.dependencies).toContain('fastapi');
    expect(m?.dependencies).toContain('psycopg');
  });

  test('pyproject.toml:poetry 依赖表,跳过 python 本身', () => {
    const root = repo({
      'pyproject.toml': [
        '[tool.poetry.dependencies]',
        'python = "^3.11"',
        'flask = "^3.0"',
        '',
        '[tool.poetry.group.dev.dependencies]',
        'pytest = "^8"',
      ].join('\n'),
    });
    const [m] = extractManifests(root, 'svc');
    expect(m?.dependencies).toContain('flask');
    expect(m?.dependencies).not.toContain('python');
  });

  test('go.mod:取 module 与 require 块的模块路径', () => {
    const root = repo({
      'go.mod': [
        'module github.com/me/app',
        '',
        'go 1.22',
        '',
        'require (',
        '\tgithub.com/gin-gonic/gin v1.9.1',
        '\tgithub.com/redis/go-redis/v9 v9.0.0',
        ')',
      ].join('\n'),
    });
    const [m] = extractManifests(root, 'app');
    expect(m?.packageName).toBe('github.com/me/app');
    expect(m?.dependencies).toContain('github.com/gin-gonic/gin');
    expect(m?.dependencies).toContain('github.com/redis/go-redis/v9');
  });

  test('损坏的 package.json 被跳过,不抛错', () => {
    const root = repo({ 'package.json': '{ not json' });
    expect(extractManifests(root, 'x')).toEqual([]);
  });

  test('无任何清单文件时返回空数组', () => {
    const root = repo({ 'main.py': 'print(1)' });
    expect(extractManifests(root, 'x')).toEqual([]);
  });
});
