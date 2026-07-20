import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAskReader, fileRecorder, type QaRecord } from '../../../src/reader/online/ask.js';
import type { ReaderAgent } from '../../../src/reader/online/agent.js';

let root: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'grill-ask-'));
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src', 'app.ts'), 'export const app = 1;');
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

/** 假 agent:回答 = "回答:" + 问题,不触网 */
function fakeAgent(answer = '这是一段自然语言结论'): ReaderAgent {
  return { ask: vi.fn(async () => answer), scans: [] };
}

const input = { repos: [{ name: 'app', root }], resume: 'r', jd: 'j' };

describe('createAskReader —— 在线问答接口', () => {
  test('ask_reader 返回自然语言字符串', async () => {
    const reader = createAskReader(input, { agent: fakeAgent('对局状态放在进程内存') });
    const answer = await reader.ask_reader('对局状态存哪?');
    expect(typeof answer).toBe('string');
    expect(answer).toBe('对局状态放在进程内存');
  });

  test('每次问答记入历史(6.4),含问题、回答、时间戳', async () => {
    const reader = createAskReader(input, { agent: fakeAgent('答A') });
    await reader.ask_reader('问1');
    await reader.ask_reader('问2');
    expect(reader.history).toHaveLength(2);
    expect(reader.history[0]).toMatchObject({ question: '问1', answer: '答A' });
    expect(reader.history[0]?.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test('调用次数可从历史读出(地图密度的反向指标)', async () => {
    const reader = createAskReader(input, { agent: fakeAgent() });
    await reader.ask_reader('a');
    await reader.ask_reader('b');
    await reader.ask_reader('c');
    expect(reader.history.length).toBe(3);
  });

  test('注入的 recorder 被调用,可落盘', async () => {
    const records: QaRecord[] = [];
    const reader = createAskReader(input, { agent: fakeAgent('答'), recorder: (r) => records.push(r) });
    await reader.ask_reader('问');
    expect(records).toHaveLength(1);
    expect(records[0]?.question).toBe('问');
  });

  test('recorder 抛错不影响问答本身', async () => {
    const reader = createAskReader(input, {
      agent: fakeAgent('仍能作答'),
      recorder: () => {
        throw new Error('落盘失败');
      },
    });
    await expect(reader.ask_reader('问')).resolves.toBe('仍能作答');
    expect(reader.history).toHaveLength(1); // 内存历史照记
  });

  test('fileRecorder 追加 JSONL', async () => {
    const logPath = join(root, 'qa.jsonl');
    const reader = createAskReader(input, { agent: fakeAgent('答'), recorder: fileRecorder(logPath) });
    await reader.ask_reader('问1');
    await reader.ask_reader('问2');
    const lines = readFileSync(logPath, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!).question).toBe('问1');
  });

  test('接口只暴露 ask_reader 与 history,不含返回源码的分支', () => {
    const reader = createAskReader(input, { agent: fakeAgent() });
    // 契约层面:除了 ask_reader / history 没有别的取源码的入口
    expect(Object.keys(reader).sort()).toEqual(['ask_reader', 'history']);
  });
});
