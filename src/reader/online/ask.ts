import { appendFileSync } from 'node:fs';
import {
  createReaderAgent,
  DEFAULT_READER_AGENT_CONFIG,
  type ReaderAgent,
  type ReaderAgentConfig,
  type ReaderAgentInput,
} from './agent.js';

/**
 * 在线问答接口 `ask_reader` —— 裁判在面试中就地图未覆盖的问题提问的唯一入口。
 *
 * 信息边界由**返回值类型**保证(设计决策 2):`ask_reader(question): Promise<string>`,
 * 只出自然语言文本。接口上**不存在**任何返回源码原文、代码块或文件路径列表的参数
 * 或返回分支 —— 裁判想要代码也拿不到,因为这条路径不存在,而非靠模型"记得别贴"。
 *
 * 剩余风险(模型把源码逐字转述进自然语言)由 agent Prompt 的输出约束 + 这里的
 * 问答记录(供评估期人工抽查)兜底。
 */

/** 一次问答记录 —— 供评估期抽查回答质量,调用次数亦是地图密度的反向指标 */
export interface QaRecord {
  question: string;
  answer: string;
  /** ISO 时间戳 */
  at: string;
}

/** 问答记录回调(如落盘);抛错不应影响问答本身 */
export type QaRecorder = (record: QaRecord) => void;

export interface AskReader {
  /** 就一个问题作答,返回自然语言文本 —— 返回值类型即信息边界 */
  ask_reader(question: string): Promise<string>;
  /** 本会话的问答历史,供评估抽查与调用次数统计 */
  readonly history: readonly QaRecord[];
}

export interface AskReaderOptions {
  config?: ReaderAgentConfig;
  /** 注入已构造的 agent(测试用);不给则按 input 构造 */
  agent?: ReaderAgent;
  /** 额外的记录回调(如落盘 JSONL);历史始终在内存保留一份 */
  recorder?: QaRecorder;
}

/**
 * 构造 `ask_reader`。持有一个阅读者 agent(全知),把每次问答记入历史并可选落盘。
 */
export function createAskReader(input: ReaderAgentInput, options: AskReaderOptions = {}): AskReader {
  const agent = options.agent ?? createReaderAgent(input, options.config ?? DEFAULT_READER_AGENT_CONFIG);
  const history: QaRecord[] = [];

  return {
    history,
    async ask_reader(question: string): Promise<string> {
      const answer = await agent.ask(question);
      const record: QaRecord = { question, answer, at: new Date().toISOString() };
      history.push(record);
      try {
        options.recorder?.(record);
      } catch {
        // 记录落盘失败不应影响问答本身:记录是旁路,不是主流程
      }
      return answer;
    },
  };
}

/** 把问答按 JSONL 追加落盘的记录器 —— 供评估期离线抽查 */
export function fileRecorder(path: string): QaRecorder {
  return (record) => appendFileSync(path, `${JSON.stringify(record)}\n`, 'utf8');
}
