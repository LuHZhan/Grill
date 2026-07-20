import { describe, expect, test } from 'vitest';
import {
  summarize,
  DEFAULT_SUMMARIZE_CONFIG,
  type MapFields,
  type SummarizeInput,
} from '../../../src/reader/offline/summarize.js';
import { ProfileSchema, type Link } from '../../../src/reader/schema.js';

function map(over: Partial<MapFields> = {}): MapFields {
  return {
    project_name: 'demo',
    overview: '一个演示项目',
    architecture: '前端调后端 SSE',
    key_decisions: 'sessionId 放全局',
    notable: '状态在内存,刷新即丢',
    entrypoints: ['frontend/src/main.ts'],
    open_questions: ['后端如何路由 /x'],
    inferred_links: [],
    ...over,
  };
}

function input(over: Partial<SummarizeInput> = {}): SummarizeInput {
  return {
    repos: [{ name: 'frontend', path: '/abs/frontend', tree: 'src/\n  main.ts' }],
    notes: [],
    conventions: [],
    readmes: [],
    manifests: [],
    contradictions: [],
    failedBatches: [],
    userLinks: [],
    ...over,
  };
}

describe('summarize —— S3 汇总', () => {
  test('地图正文含各分节标题', async () => {
    const { grillMarkdown } = await summarize(input(), DEFAULT_SUMMARIZE_CONFIG, async () => map());
    for (const h of ['# demo', '## 项目概述', '## 架构', '## 关键决策', '## 值得注意']) {
      expect(grillMarkdown).toContain(h);
    }
  });

  test('目录树原样附在末尾,内容逐字一致', async () => {
    const tree = 'src/\n  main.ts\n  lib/\n    api.ts';
    const { grillMarkdown } = await summarize(
      input({ repos: [{ name: 'frontend', path: '/x', tree }] }),
      DEFAULT_SUMMARIZE_CONFIG,
      async () => map(),
    );
    expect(grillMarkdown).toContain('## 目录树');
    expect(grillMarkdown).toContain(tree); // 逐字
  });

  test('failedBatches 非空时标注盲区', async () => {
    const { grillMarkdown, profile } = await summarize(
      input({ failedBatches: [{ batch: 'backend/api', paths: ['a.py', 'b.py'], reason: '超时' }] }),
      DEFAULT_SUMMARIZE_CONFIG,
      async () => map(),
    );
    expect(grillMarkdown).toContain('未分析区域');
    expect(grillMarkdown).toContain('backend/api');
    expect(grillMarkdown).toContain('超时');
    expect(profile.failed_batches).toHaveLength(1); // 也进 metadata
  });

  test('无失败批次时不出现盲区小节', async () => {
    const { grillMarkdown } = await summarize(input(), DEFAULT_SUMMARIZE_CONFIG, async () => map());
    expect(grillMarkdown).not.toContain('未分析区域');
  });

  test('用户 link 保留 user,LLM 推导的钉成 inferred', async () => {
    const userLink: Link = { relation: '主流程', repos: ['frontend:a', 'backend:b'], source: 'user' };
    const { profile } = await summarize(
      input({ userLinks: [userLink] }),
      DEFAULT_SUMMARIZE_CONFIG,
      // 模型即便自报 source 也不该被采信,这里给个 relation 试探
      async () => map({ inferred_links: [{ relation: '推导的', repos: ['frontend:c'] }] }),
    );
    const byRelation = Object.fromEntries(profile.links.map((l) => [l.relation, l.source]));
    expect(byRelation['主流程']).toBe('user');
    expect(byRelation['推导的']).toBe('inferred');
  });

  test('profile 机械字段透传:repos/contradictions/failed_batches 不经 LLM', async () => {
    const contradictions = [{ claim: '提及 Kafka', evidence: '无痕迹' }];
    const { profile } = await summarize(
      input({ contradictions }),
      DEFAULT_SUMMARIZE_CONFIG,
      async () => map(),
    );
    expect(profile.contradictions).toEqual(contradictions);
    expect(profile.repos[0]?.name).toBe('frontend');
    expect(ProfileSchema.safeParse(profile).success).toBe(true);
  });

  test('LLM 产出缺字段导致 profile 不合法时抛错(不静默落盘)', async () => {
    await expect(
      summarize(
        input(),
        DEFAULT_SUMMARIZE_CONFIG,
        async () => map({ project_name: '' }), // 空名违反 min(1)
      ),
    ).rejects.toThrow();
  });

  test('小目录树内联进 GRILL.md,不产生 sidecar', async () => {
    const { grillMarkdown, sidecars } = await summarize(
      input({ repos: [{ name: 'frontend', path: '/x', tree: 'src/\n  a.ts\n  b.ts' }] }),
      DEFAULT_SUMMARIZE_CONFIG,
      async () => map(),
    );
    expect(sidecars).toHaveLength(0);
    expect(grillMarkdown).toContain('src/\n  a.ts');
  });

  test('超大目录树外置到 sidecar,正文只放引用', async () => {
    const bigTree = Array.from({ length: 2000 }, (_, i) => `file${i}.ts`).join('\n'); // > 8KB
    const { grillMarkdown, sidecars } = await summarize(
      input({ repos: [{ name: 'huge', path: '/x', tree: bigTree }] }),
      DEFAULT_SUMMARIZE_CONFIG,
      async () => map(),
    );
    expect(sidecars).toHaveLength(1);
    expect(sidecars[0]?.path).toBe('trees/huge.txt');
    expect(sidecars[0]?.content).toBe(bigTree); // 逐字外置
    expect(grillMarkdown).not.toContain('file1999.ts'); // 正文不内联大树
    expect(grillMarkdown).toContain('trees/huge.txt'); // 正文放引用
    expect(grillMarkdown).toContain('已外置');
  });

  test('多仓混合:小的内联、大的外置', async () => {
    const bigTree = Array.from({ length: 2000 }, (_, i) => `f${i}.ts`).join('\n');
    const { grillMarkdown, sidecars } = await summarize(
      input({
        repos: [
          { name: 'small', path: '/a', tree: 'src/\n  x.ts' },
          { name: 'big', path: '/b', tree: bigTree },
        ],
      }),
      DEFAULT_SUMMARIZE_CONFIG,
      async () => map(),
    );
    expect(sidecars.map((s) => s.path)).toEqual(['trees/big.txt']);
    expect(grillMarkdown).toContain('src/\n  x.ts'); // small 内联
    expect(grillMarkdown).toContain('trees/big.txt'); // big 引用
  });
});
