import { describe, expect, test } from 'vitest';
import { makeJudgeAskTools } from '../../src/judge/tools.js';
import type { AskReader } from '../../src/reader/online/ask.js';

/** AI SDK 工具 execute 的第二参在这些单测里无关紧要 */
const opts = { toolCallId: 't', messages: [] } as never;

/** 造一个只实现 ask_reader 的假阅读者;history 上游接口要求,给空 */
const fakeReader = (impl: (q: string) => Promise<string>): AskReader => ({
  ask_reader: impl,
  history: [],
});

describe('makeJudgeAskTools —— 裁判的 ask_reader 工具', () => {
  test('只注册 ask_reader,不含任何文件工具(2.1 / 2.4)', () => {
    const { tools } = makeJudgeAskTools(fakeReader(async (q) => q));
    expect(Object.keys(tools)).toEqual(['ask_reader']);
  });

  test('转发问题、返回阅读者答案,并记录问过的问题(2.3)', async () => {
    const { tools, queries } = makeJudgeAskTools(fakeReader(async (q) => `阅读者:${q}`));
    const ans = await tools.ask_reader.execute!({ question: 'Redis 锁在哪释放' }, opts);
    expect(ans).toBe('阅读者:Redis 锁在哪释放');
    expect(queries).toEqual(['Redis 锁在哪释放']);
  });

  test('上游抛错时返回可读错误、不抛出,且问题仍计入(2.2 / 2.3)', async () => {
    const { tools, queries } = makeJudgeAskTools(
      fakeReader(async () => {
        throw new Error('reader 超时');
      }),
    );
    const ans = await tools.ask_reader.execute!({ question: '有没有事务保护' }, opts);
    expect(ans).toContain('无法作答');
    expect(ans).toContain('reader 超时');
    expect(queries).toEqual(['有没有事务保护']);
  });

  test('多次提问按序累积到 queries(供 did_ask_reader / reader_queries)', async () => {
    const { tools, queries } = makeJudgeAskTools(fakeReader(async (q) => q));
    await tools.ask_reader.execute!({ question: 'Q1' }, opts);
    await tools.ask_reader.execute!({ question: 'Q2' }, opts);
    expect(queries).toEqual(['Q1', 'Q2']);
  });
});
