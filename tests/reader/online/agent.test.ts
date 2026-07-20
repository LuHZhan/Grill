import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createReaderAgent, DEFAULT_READER_AGENT_CONFIG } from '../../../src/reader/online/agent.js';

let root: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'grill-agent-'));
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src', 'app.ts'), 'export const app = 1;');
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('createReaderAgent', () => {
  test('构造时扫描仓、把三份输入拼进 system,并委托 ask', async () => {
    const ask = vi.fn(async ({ system }: { system: string }) => system);
    const agent = createReaderAgent(
      { repos: [{ name: 'app', root }], resume: '我的简历XYZ', jd: '岗位要求ABC' },
      DEFAULT_READER_AGENT_CONFIG,
      ask,
    );

    expect(agent.scans).toHaveLength(1);
    expect(agent.scans[0]?.files).toContain('src/app.ts');

    const echoedSystem = await agent.ask('这个项目是干嘛的?');
    expect(ask).toHaveBeenCalledTimes(1);
    // system 里含仓库结构 + 简历 + JD
    expect(echoedSystem).toContain('仓库 app');
    expect(echoedSystem).toContain('我的简历XYZ');
    expect(echoedSystem).toContain('岗位要求ABC');
    // 只讲理解与取舍,不规定输出格式
    expect(echoedSystem).toContain('如何理解一个项目');
  });

  test('ask 把问题原样透传给注入的实现', async () => {
    const ask = vi.fn(async ({ question }: { question: string }) => `回答:${question}`);
    const agent = createReaderAgent(
      { repos: [{ name: 'app', root }], resume: 'r', jd: 'j' },
      DEFAULT_READER_AGENT_CONFIG,
      ask,
    );
    expect(await agent.ask('X 在哪实现?')).toBe('回答:X 在哪实现?');
  });
});
