import { describe, expect, test } from 'vitest';
import { JudgeOutputSchema, toInterviewerProbe, type JudgeOutput } from '../../src/judge/schema.js';

/** 一个扎实回答的基线:没有崩溃点、没问过阅读者,但仍可换方向继续追问 */
const solid: JudgeOutput = {
  robustness: 'solid',
  collapse_point: null,
  did_ask_reader: false,
  reader_queries: [],
  next_probe: '继续追问他对并发写入下的一致性如何保证',
  reasoning: '事务边界与回滚路径都讲得清,追到实现细节仍自洽',
};

/** 一个崩塌回答的基线:定位到崩溃点、问过阅读者核验、崩了故不再追 */
const collapsed: JudgeOutput = {
  robustness: 'collapsed',
  collapse_point: '声称用 Redis 做分布式锁,却答不出锁续期与误删防护',
  did_ask_reader: true,
  reader_queries: ['代码里 Redis 锁的获取与释放在哪个文件'],
  next_probe: null,
  reasoning: '追问锁的正确性时逐层崩塌,ask_reader 确认源码无续期逻辑',
};

describe('JudgeOutputSchema —— 裁判评分结构', () => {
  test('扎实回答基线通过', () => {
    expect(JudgeOutputSchema.safeParse(solid).success).toBe(true);
  });

  test('崩塌回答基线通过', () => {
    expect(JudgeOutputSchema.safeParse(collapsed).success).toBe(true);
  });

  test('缺少 reasoning 时拒绝', () => {
    const { reasoning, ...missing } = solid;
    expect(JudgeOutputSchema.safeParse(missing).success).toBe(false);
  });

  test('robustness 为枚举外取值时拒绝', () => {
    expect(JudgeOutputSchema.safeParse({ ...solid, robustness: 'shaky' }).success).toBe(false);
  });

  test('collapse_point 为空串时拒绝(要么具体描述,要么 null)', () => {
    expect(JudgeOutputSchema.safeParse({ ...collapsed, collapse_point: '' }).success).toBe(false);
  });
});

describe('refine —— solid 时 collapse_point 必须为 null', () => {
  test('solid 却带崩溃点:拒绝', () => {
    const bad = { ...solid, collapse_point: '这里其实站不住' };
    expect(JudgeOutputSchema.safeParse(bad).success).toBe(false);
  });

  test('solid 且 collapse_point 为 null:通过', () => {
    expect(JudgeOutputSchema.safeParse(solid).success).toBe(true);
  });

  test('partial 带崩溃点:通过(约束只针对 solid)', () => {
    const partial = { ...collapsed, robustness: 'partial' as const };
    expect(JudgeOutputSchema.safeParse(partial).success).toBe(true);
  });
});

describe('refine —— did_ask_reader 与 reader_queries 一致', () => {
  test('说问过却没有问题记录:拒绝', () => {
    const bad = { ...solid, did_ask_reader: true, reader_queries: [] };
    expect(JudgeOutputSchema.safeParse(bad).success).toBe(false);
  });

  test('说没问却留下问题记录:拒绝', () => {
    const bad = { ...solid, did_ask_reader: false, reader_queries: ['问了但标记成没问'] };
    expect(JudgeOutputSchema.safeParse(bad).success).toBe(false);
  });

  test('问过且有记录:通过', () => {
    expect(JudgeOutputSchema.safeParse(collapsed).success).toBe(true);
  });

  test('没问且无记录:通过', () => {
    expect(JudgeOutputSchema.safeParse(solid).success).toBe(true);
  });
});

describe('toInterviewerProbe —— 只把 next_probe 投影给面试官', () => {
  test('返回 next_probe 的文本', () => {
    expect(toInterviewerProbe(solid)).toBe(solid.next_probe);
  });

  test('next_probe 为 null 时返回 null', () => {
    expect(toInterviewerProbe(collapsed)).toBeNull();
  });

  test('投影结果不等于裁判的内部推理(reasoning 不外泄)', () => {
    expect(toInterviewerProbe(solid)).not.toBe(solid.reasoning);
  });
});
