import { generateText, stepCountIs } from 'ai';
import { readerModel, DEFAULT_MODEL, type BaseLlmConfig } from '../llm.js';
import type { RepoRoot } from '../repo.js';
import { scanReposForTools, makeReaderTools, type RepoScan } from './tools.js';

/**
 * 阅读者 agent(在线):持有源码 + 简历 + JD,注册 glob/grep/read_file 三工具,
 * 现场检索源码回答问题。用 AI SDK 原生 tool-calling 循环(generateText + stopWhen),
 * 不引额外 agent 框架 —— 阅读者是无状态一问一答,用不上 workflow/memory。
 *
 * 本文件只负责"agent 定义 + 如何理解项目"。信息边界(不外泄源码)由 ask_reader
 * 的返回值类型保证,那层的 Prompt 约束在 ask_reader 侧补(见在线问答接口)。
 */

/**
 * 阅读者系统 Prompt —— 只讲**如何理解项目、如何取舍**,不讲输出格式
 * (reader-agent spec:Prompt 只承载理解力)。
 */
const READER_SYSTEM_PROMPT = `你是这个项目的"全知阅读者":你同时持有项目源码、候选人简历与岗位 JD,是唯一三者都看过的人。

你手上有三个工具,可随时检索与读取源码:
- glob(pattern):按文件名模式找文件
- grep(pattern[, path]):在源码里搜内容
- read_file(path[, offset, limit]):读某个文件,文件过大时用行范围读

如何理解一个项目:
- 先从入口和目录结构建立骨架,再顺着调用关系深入。
- 遇到拿不准的实现,用 grep / read_file 现场查证,不要凭印象猜。
- 要判断"某个东西是否存在",用 all=true 做穷尽检索 —— 默认条数上限之下,无法排除被丢弃的结果里仍有命中,"不存在"的判断就不成立。

如何取舍:
- 直指对方问的点,给结论和依据,不铺陈无关背景。
- 分清"代码里确实这么实现的"与"你的推断",后者要标明是推断。
- 简历与 JD 是你的额外视角;涉及项目事实时,一律以代码为准。

输出约束(重要):
- 用自然语言给结论,**不要粘贴源码**:不要输出代码块,不要逐字转述源码原文。
- 可以描述某段代码"做了什么、怎么做的",但不要一行行把它抄出来;需要指位置时,说清文件与符号名(类/函数名)即可,不贴实现。`;

export interface ReaderAgentConfig extends BaseLlmConfig {
  /** tool-calling 循环的最大步数,防止无限检索 */
  maxSteps: number;
}

export const DEFAULT_READER_AGENT_CONFIG: ReaderAgentConfig = {
  model: DEFAULT_MODEL,
  temperature: 0.2,
  maxSteps: 12,
};

export interface ReaderAgentInput {
  /** 被测仓库(名字 + 绝对根) */
  repos: RepoRoot[];
  resume: string;
  jd: string;
}

export interface ReaderAgent {
  /** 就一个问题现场检索源码并作答,返回自然语言文本 */
  ask(question: string): Promise<string>;
  /** 已扫描的仓(供上层复用/自检) */
  readonly scans: RepoScan[];
}

/** 生成一次问答的底层实现,可注入以便测试(默认走 DeepSeek + 工具循环) */
export type AskFn = (args: {
  system: string;
  question: string;
  scans: RepoScan[];
  config: ReaderAgentConfig;
}) => Promise<string>;

/**
 * 构造阅读者 agent。构造时扫描一次各仓,glob/grep 据此检索(避免每问一次重扫)。
 */
export function createReaderAgent(
  input: ReaderAgentInput,
  config: ReaderAgentConfig = DEFAULT_READER_AGENT_CONFIG,
  ask: AskFn = deepseekAsk,
): ReaderAgent {
  const scans = scanReposForTools(input.repos);
  const system = buildSystem(input, scans);
  return {
    scans,
    ask: (question) => ask({ system, question, scans, config }),
  };
}

/** 把三份输入拼进系统 Prompt:仓库结构 + 简历 + JD */
function buildSystem(input: ReaderAgentInput, scans: RepoScan[]): string {
  const repoBlock = scans
    .map((s) => `## 仓库 ${s.name}(${s.files.length} 文件)\n根:${s.root}`)
    .join('\n');
  return [
    READER_SYSTEM_PROMPT,
    '# 被测项目',
    repoBlock,
    '# 候选人简历',
    input.resume,
    '# 岗位 JD',
    input.jd,
  ].join('\n\n');
}

/** 默认实现:DeepSeek + 三工具的原生 tool-calling 循环 */
const deepseekAsk: AskFn = async ({ system, question, scans, config }) => {
  const { text } = await generateText({
    model: readerModel(config.model),
    system,
    prompt: question,
    tools: makeReaderTools(scans),
    stopWhen: stepCountIs(config.maxSteps),
    temperature: config.temperature,
  });
  return text;
};
