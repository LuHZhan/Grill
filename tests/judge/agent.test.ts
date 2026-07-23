import { describe, expect, test, vi } from 'vitest';
import {
  createJudgeAgent,
  reconcile,
  DEFAULT_JUDGE_AGENT_CONFIG,
  type JudgeInput,
} from '../../src/judge/agent.js';
import type { AskReader } from '../../src/reader/online/ask.js';
import type { JudgeOutput } from '../../src/judge/schema.js';

const reader: AskReader = { ask_reader: async (q) => `ans:${q}`, history: [] };

const sample: JudgeOutput = {
  robustness: 'solid',
  collapse_point: null,
  did_ask_reader: false,
  reader_queries: [],
  next_probe: '追问他并发写入下的一致性怎么保证',
  reasoning: '决策与取舍讲得清,追到细节仍自洽',
};

const input: JudgeInput = {
  grill: 'GRILL地图内容XYZ',
  profile: 'PROFILE档案ABC',
  jd: 'JD资深后端岗',
  history: 'HIST对话历史',
  answer: 'ANS候选人回答',
};

describe('createJudgeAgent', () => {
  test('判断标准+GRILL+profile+JD 进 system,历史+回答进 task,并委托 run', async () => {
    const run = vi.fn(async (_a: { system: string; prompt: string }) => sample);
    const agent = createJudgeAgent(reader, DEFAULT_JUDGE_AGENT_CONFIG, run);
    const out = await agent.judge(input);
    expect(out).toEqual(sample);
    expect(run).toHaveBeenCalledTimes(1);
    const arg = run.mock.calls[0]![0];
    expect(arg.system).toContain('出题弹药');
    expect(arg.system).toContain('GRILL地图内容XYZ');
    expect(arg.system).toContain('PROFILE档案ABC');
    expect(arg.system).toContain('JD资深后端岗');
    expect(arg.prompt).toContain('HIST对话历史');
    expect(arg.prompt).toContain('ANS候选人回答');
  });

  test('system 里写明 next_probe 不得泄露文件路径(3.3)', async () => {
    const run = vi.fn(async (_a: { system: string; prompt: string }) => sample);
    const agent = createJudgeAgent(reader, DEFAULT_JUDGE_AGENT_CONFIG, run);
    await agent.judge(input);
    expect(run.mock.calls[0]![0].system).toContain('文件路径');
  });
});

describe('reconcile —— did_ask_reader / reader_queries 以工具记录为准(决策 9)', () => {
  test('模型说没问、工具却记录问过:以工具为准', () => {
    const got = reconcile({ ...sample, did_ask_reader: false, reader_queries: [] }, ['其实问了A', '问了B']);
    expect(got.did_ask_reader).toBe(true);
    expect(got.reader_queries).toEqual(['其实问了A', '问了B']);
  });

  test('模型虚报问过、工具没记录:归零', () => {
    const got = reconcile({ ...sample, did_ask_reader: true, reader_queries: ['虚报'] }, []);
    expect(got.did_ask_reader).toBe(false);
    expect(got.reader_queries).toEqual([]);
  });

  test('覆盖后仍不合法则抛错(3.6:solid 带崩溃点)', () => {
    expect(() => reconcile({ ...sample, robustness: 'solid', collapse_point: '崩了' }, [])).toThrow();
  });
});
