import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateGrill } from '../../src/reader/pipeline.js';
import type { BatchNote } from '../../src/reader/schema.js';
import type { MapFields } from '../../src/reader/offline/summarize.js';

/** 假 S2:每批产一条最小合法笔记 */
const fakeBatch = vi.fn(
  async (): Promise<BatchNote> => ({
    batch: '',
    modules: [{ path: 'x', role: '入口', contracts: ['A 调 B'], decisions: [] }],
    open_questions: [],
    uncertain: [],
  }),
);

/** 假 S3:回填一份地图字段,并把它见到的 notes 数量塞进 overview 以便断言 */
const fakeMap = vi.fn(
  async (input): Promise<MapFields> => ({
    project_name: 'FIXTURE',
    overview: `notes=${input.notes.length};contradictions=${input.contradictions.length}`,
    architecture: 'A→B',
    key_decisions: 'x',
    notable: 'y',
    entrypoints: ['app/src/a.ts'],
    open_questions: [],
    inferred_links: [],
  }),
);

let outDir: string;

function makeRepo(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'grill-pipe-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, content);
  }
  return root;
}

beforeAll(() => {
  outDir = mkdtempSync(join(tmpdir(), 'grill-pipe-out-'));
});
afterAll(() => rmSync(outDir, { recursive: true, force: true }));

describe('generateGrill —— 离线管道端到端(注入假 LLM)', () => {
  test('无约定文档:S2 精读运行,notes 流入 S3,产出 GRILL.md + profile', async () => {
    fakeBatch.mockClear();
    fakeMap.mockClear();
    const root = makeRepo({
      'src/a.ts': 'import { b } from "./b";\nexport const a = () => b();',
      'src/b.ts': 'export const b = () => 1;',
      'package.json': JSON.stringify({ name: 'app', dependencies: { react: '^18' } }),
    });

    const art = await generateGrill(
      { repoRoots: [root], resume: '我用过 Kafka 消息队列', jd: 'JD', outDir },
      { batchGenerate: fakeBatch, mapGenerate: fakeMap, log: () => {}, warn: () => {} },
    );

    expect(fakeBatch).toHaveBeenCalled(); // S2 真的跑了
    expect(art.notes.length).toBeGreaterThan(0);
    // S3 见到了 notes 与 contradiction(简历吹 Kafka、代码无痕迹)
    expect(art.profile.project_name).toBe('FIXTURE');
    expect(art.grillMarkdown).toContain('notes=');
    expect(art.profile.contradictions.some((c) => c.claim.includes('Kafka'))).toBe(true);
    // 目录树逐字进 GRILL.md
    expect(art.grillMarkdown).toContain('a.ts');
    rmSync(root, { recursive: true, force: true });
  });

  test('约定文档信号充足:短路跳过 S2,不调用精读', async () => {
    fakeBatch.mockClear();
    fakeMap.mockClear();
    const root = makeRepo({
      'src/a.ts': 'export const a = 1;',
      'CLAUDE.md': `# 约定\n${'详尽的架构说明与跨模块契约。'.repeat(120)}`, // > 1500 字符
    });

    const art = await generateGrill(
      { repoRoots: [root], resume: 'r', jd: 'j', outDir },
      { batchGenerate: fakeBatch, mapGenerate: fakeMap, log: () => {}, warn: () => {} },
    );

    expect(fakeBatch).not.toHaveBeenCalled(); // 短路:S2 没跑
    expect(art.notes).toHaveLength(0);
    expect(fakeMap).toHaveBeenCalled(); // S3 仍产图
    expect(art.grillMarkdown).toContain('notes=0');
    rmSync(root, { recursive: true, force: true });
  });

  test('用户关系按扫描结果校验:不存在的路径被剔除并告警', async () => {
    fakeBatch.mockClear();
    fakeMap.mockClear();
    const warn = vi.fn();
    const root = makeRepo({ 'src/a.ts': 'export const a = 1;', 'CLAUDE.md': 'x'.repeat(2000) });
    const name = root.split(/[\\/]/).pop()!;

    await generateGrill(
      {
        repoRoots: [root],
        resume: 'r',
        jd: 'j',
        outDir,
        rawLinks: [
          { relation: '真', repos: [`${name}:src/a.ts`], source: 'user' },
          { relation: '假', repos: [`${name}:src/nope.ts`], source: 'user' },
        ],
      },
      { batchGenerate: fakeBatch, mapGenerate: fakeMap, log: () => {}, warn },
    );
    expect(warn).toHaveBeenCalledTimes(1); // 只有"假"那条被剔除告警
    expect(warn.mock.calls[0]?.[0]).toContain('nope.ts');
    rmSync(root, { recursive: true, force: true });
  });
});
