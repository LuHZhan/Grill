import { describe, expect, test } from 'vitest';
import { planBatches, estimateTokens, type FileEntry } from '../../../src/reader/offline/batch.js';

/** 便捷构造:按 token 数反推字节,让测试直接以 token 表达体量 */
function file(path: string, tokens: number): FileEntry {
  return { path, bytes: Math.round(tokens * 3.5) };
}

function totalTokens(files: FileEntry[]): number {
  return files.reduce((s, f) => s + estimateTokens(f.bytes), 0);
}

describe('planBatches —— 目录聚类分批', () => {
  test('整个项目装得下批预算时,合成一批(内聚最大)', () => {
    const files = [file('backend/a.py', 10), file('backend/b.py', 10), file('frontend/x.ts', 10)];
    const batches = planBatches(files, 100);
    expect(batches).toHaveLength(1);
    expect(batches[0]?.files).toHaveLength(3);
  });

  test('每批 token 不超过预算(超预算单文件除外)', () => {
    const files = [
      file('backend/api/a.py', 30),
      file('backend/api/b.py', 30),
      file('backend/runtime/c.py', 30),
      file('frontend/x.ts', 30),
    ];
    const budget = 50;
    const batches = planBatches(files, budget);
    for (const b of batches) {
      const single = b.files.length === 1;
      if (!single) expect(b.tokens).toBeLessThanOrEqual(budget);
    }
    // 所有文件都被分入且只分一次
    expect(batches.flatMap((b) => b.files.map((f) => f.path)).sort()).toEqual(
      files.map((f) => f.path).sort(),
    );
  });

  test('超预算的单个大文件单独成批,且不被截断', () => {
    const big = file('backend/runtime/game.py', 120); // 远超预算
    const files = [file('backend/api/a.py', 10), big];
    const batches = planBatches(files, 40);
    const bigBatch = batches.find((b) => b.files.some((f) => f.path === big.path));
    expect(bigBatch?.files).toHaveLength(1); // 独占
    expect(bigBatch?.files[0]?.bytes).toBe(big.bytes); // 原样,未截断
    expect(bigBatch!.tokens).toBeGreaterThan(40); // 允许超预算
  });

  test('同目录小文件优先合并到一批,不跨无关模块散切', () => {
    const files = [
      file('backend/api/a.py', 15),
      file('backend/api/b.py', 15),
      file('backend/runtime/c.py', 15),
      file('backend/runtime/d.py', 15),
    ];
    // 预算 40:api 两个(30)合一批,runtime 两个(30)合一批
    const batches = planBatches(files, 40);
    const paths = batches.map((b) => b.files.map((f) => f.path.split('/')[1]));
    // 同一批内的文件应来自同一子模块,不出现 api 与 runtime 混批
    for (const group of paths) {
      expect(new Set(group).size).toBe(1);
    }
  });

  test('超预算目录按子目录拆分', () => {
    const files = [
      file('backend/api/a.py', 30),
      file('backend/api/b.py', 30), // api 子树 60 > 预算
      file('backend/runtime/c.py', 30),
    ];
    const batches = planBatches(files, 50);
    // api 子树超预算,必须拆成多批
    expect(batches.length).toBeGreaterThanOrEqual(2);
    for (const b of batches) {
      if (b.files.length > 1) expect(b.tokens).toBeLessThanOrEqual(50);
    }
  });

  test('批标识取自公共目录', () => {
    const files = [file('backend/api/a.py', 10), file('backend/api/b.py', 10)];
    const [batch] = planBatches(files, 100);
    expect(batch?.id).toContain('backend');
  });

  test('没有文件时返回空数组', () => {
    expect(planBatches([], 100)).toEqual([]);
  });

  test('预算非正数时报错', () => {
    expect(() => planBatches([file('a.py', 1)], 0)).toThrow();
  });

  test('所有文件都被覆盖,无遗漏无重复', () => {
    const files = Array.from({ length: 20 }, (_, i) =>
      file(`repo/mod${i % 4}/file${i}.ts`, 12),
    );
    const batches = planBatches(files, 40);
    const got = batches.flatMap((b) => b.files.map((f) => f.path)).sort();
    expect(got).toEqual(files.map((f) => f.path).sort());
    expect(got.length).toBe(new Set(got).size); // 无重复
  });
});
