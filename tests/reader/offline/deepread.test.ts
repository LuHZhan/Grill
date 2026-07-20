import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  deepReadBatches,
  DEFAULT_DEEPREAD_CONFIG,
  type DeepReadConfig,
} from '../../../src/reader/offline/deepread.js';
import type { Batch } from '../../../src/reader/offline/batch.js';
import type { BatchNote } from '../../../src/reader/schema.js';

function batch(id: string, paths: string[]): Batch {
  return { id, files: paths.map((p) => ({ path: p, bytes: 100 })), tokens: 30 };
}

/** 一份最小合法笔记(batch 字段由被测代码回填,这里给空串) */
function note(over: Partial<BatchNote> = {}): BatchNote {
  return {
    batch: '',
    modules: [{ path: 'a.ts', role: '入口', contracts: [], decisions: [] }],
    open_questions: [],
    uncertain: [],
    ...over,
  };
}

describe('deepReadBatches —— S2 编排', () => {
  let notesDir: string;
  let config: DeepReadConfig;
  const readContent = (p: string): string => `// content of ${p}`;

  beforeEach(() => {
    notesDir = mkdtempSync(join(tmpdir(), 'grill-notes-'));
    config = { ...DEFAULT_DEEPREAD_CONFIG, notesDir, concurrency: 2, maxRetries: 2 };
  });
  afterEach(() => rmSync(notesDir, { recursive: true, force: true }));

  test('成功精读:回填 batch 字段、笔记落盘、返回结果', async () => {
    const generate = vi.fn(async () => note());
    const { notes, failed } = await deepReadBatches([batch('backend/api', ['backend/api/a.ts'])], config, {
      readContent,
      generate,
    });
    expect(failed).toHaveLength(0);
    expect(notes[0]?.batch).toBe('backend/api'); // 回填
    const onDisk = JSON.parse(readFileSync(join(notesDir, 'backend__api.json'), 'utf8'));
    expect(onDisk.batch).toBe('backend/api'); // 落盘
    expect(generate).toHaveBeenCalledTimes(1);
  });

  test('缓存命中:已有合法笔记时不再调用 LLM', async () => {
    writeFileSync(join(notesDir, 'backend__api.json'), JSON.stringify(note({ batch: 'backend/api' })));
    const generate = vi.fn(async () => note());
    const { notes } = await deepReadBatches([batch('backend/api', ['backend/api/a.ts'])], config, {
      readContent,
      generate,
    });
    expect(generate).not.toHaveBeenCalled();
    expect(notes).toHaveLength(1);
  });

  test('损坏的缓存视为未命中,重新精读', async () => {
    writeFileSync(join(notesDir, 'backend__api.json'), '{ 坏 json');
    const generate = vi.fn(async () => note());
    await deepReadBatches([batch('backend/api', ['backend/api/a.ts'])], config, { readContent, generate });
    expect(generate).toHaveBeenCalledTimes(1);
  });

  test('失败后重试,最终成功', async () => {
    let calls = 0;
    const generate = vi.fn(async () => {
      calls++;
      if (calls === 1) throw new Error('第一次超时');
      return note();
    });
    const { notes, failed } = await deepReadBatches([batch('m', ['m/a.ts'])], config, {
      readContent,
      generate,
    });
    expect(generate).toHaveBeenCalledTimes(2);
    expect(notes).toHaveLength(1);
    expect(failed).toHaveLength(0);
  });

  test('重试耗尽:该批记入 failed 并保留原因,其余批不受影响', async () => {
    const generate = vi.fn(async (b: Batch) => {
      if (b.id === 'bad') throw new Error('模型持续报错');
      return note();
    });
    const { notes, failed } = await deepReadBatches(
      [batch('good', ['good/a.ts']), batch('bad', ['bad/x.ts', 'bad/y.ts'])],
      config,
      { readContent, generate },
    );
    expect(notes).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(failed[0]?.batch).toBe('bad');
    expect(failed[0]?.paths).toEqual(['bad/x.ts', 'bad/y.ts']);
    expect(failed[0]?.reason).toContain('模型持续报错');
    // bad 批尝试了 1 + maxRetries 次
    expect(generate.mock.calls.filter(([b]) => b.id === 'bad')).toHaveLength(1 + config.maxRetries);
  });

  test('全部批次失败:抛错,不静默产出空结果', async () => {
    const generate = vi.fn(async () => {
      throw new Error('全线崩');
    });
    await expect(
      deepReadBatches([batch('a', ['a/x.ts']), batch('b', ['b/y.ts'])], config, {
        readContent,
        generate,
      }),
    ).rejects.toThrow(/全部 2 个批次精读失败/);
  });

  test('并发不超过上限', async () => {
    let active = 0;
    let peak = 0;
    const generate = vi.fn(async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 10));
      active--;
      return note();
    });
    const batches = Array.from({ length: 6 }, (_, i) => batch(`m${i}`, [`m${i}/a.ts`]));
    await deepReadBatches(batches, { ...config, concurrency: 2 }, { readContent, generate });
    expect(peak).toBeLessThanOrEqual(2);
    expect(generate).toHaveBeenCalledTimes(6);
  });

  test('内容拼装把文件路径与源码都喂给 generate', async () => {
    const generate = vi.fn(async (_b: Batch, content: string) => {
      expect(content).toContain('backend/api/a.ts');
      expect(content).toContain('// content of backend/api/a.ts');
      return note();
    });
    await deepReadBatches([batch('backend/api', ['backend/api/a.ts'])], config, {
      readContent,
      generate,
    });
    expect(generate).toHaveBeenCalled();
  });
});
