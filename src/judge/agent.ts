import { generateText, generateObject, stepCountIs } from 'ai';
import { judgeModel, DEFAULT_MODEL, type BaseLlmConfig } from '../reader/llm.js';
import type { AskReader } from '../reader/online/ask.js';
import { JudgeOutputSchema, type JudgeOutput } from './schema.js';
import { makeJudgeAskTools } from './tools.js';

/**
 * 裁判 agent(在线)—— 对候选人一段回答产出 Zod 强制约束的抗压判断 `JudgeOutput`。
 *
 * 与上游阅读者同构:AI SDK 原生 tool-calling(`generateText` + `tools` + `stopWhen`),
 * 不引 Mastra(决策 1)。裁判是"输入 → 一个 `JudgeOutput`"的一次评分,用不上
 * workflow / memory。
 *
 * 边界(决策 2):裁判**不注册任何文件工具**,手里没有源码路径,也够不到文件系统;
 * 下钻只能经 `ask_reader(question): Promise<string>` 拿回自然语言结论。路径安全归
 * 阅读者(上游已实现并验证),裁判侧不重做——攻击面直接消失。
 *
 * 判断力全在 {@link JUDGE_SYSTEM_PROMPT}(决策 7 举证门槛 / 决策 8 按 JD 调尺度 /
 * 决策 2 节制下钻);结构与边界交给代码:格式由 schema 固定(`src/judge/schema.ts`),
 * 面试官视图由 `toInterviewerProbe` 投影(决策 3),`reader_queries` / `did_ask_reader`
 * 以工具实际记录为准、由 {@link reconcile} 回填(决策 9)。
 */

/**
 * 裁判系统 Prompt —— 只讲**怎么判、按什么尺度判**,不讲输出字段结构(结构交给 schema)。
 * 决策 7:扎实的举证门槛;决策 8:按 JD 调尺度;决策 2:节制下钻;任务 3.3:next_probe
 * 的内容约束(不得含源码片段或文件路径)。
 */
const JUDGE_SYSTEM_PROMPT = `你是这场技术面试的"裁判":给定项目事实与候选人的一段回答,你只做一件事——判断这段话到底站不站得住。你的判断是整场面试的**出题弹药**:面试官不自己找问题,而是把你在回答里找到的接缝(next_probe)包装成下一个追问。判错,这一轮面试就废了。

你手上的材料:
- 下方背景区的项目地图 GRILL.md 与结构化档案 profile.json —— 被测项目的事实底牌;
- 下方岗位 JD —— 用来定"扎实"的门槛;
- 工具 ask_reader(question):地图与档案都答不出的实现细节,可向通读过全部源码的全知阅读者提一个自然语言问题,拿回自然语言结论。你没有源码,也没有文件工具,想核实实现只能经此。

判"扎实"(solid)的门槛 —— 这是识别"有效包装"的关键:
- 只有当回答落到**本项目一个具体的、非通用的技术决策及其理由**,且经得起追问、能对应到项目里真实存在的决策点,才算扎实。
- 通用八股(张口就来的"缓存穿透/雪崩/幂等/加个索引"之类名词堆砌)**不构成**扎实证据——"有效包装"类回答的共同特征,正是只有通用概念、落不到本项目的具体决策。默认不轻易给 solid。
- 部分成立(partial):大方向对,但含糊、跳步,或只有通用说法没落到本项目。
- 崩塌(collapsed):关键处与代码矛盾,或一追即散。

按 JD 调尺度:依据下方 JD 的岗位级别调"扎实"门槛 —— 资深岗要追到权衡取舍与踩过的坑;初级岗能讲清"在本项目具体做了什么"即可。

下钻要节制(你不必、也不应穷尽细节):
- 只在"需要摸清某处的真实复杂度、以便设计出有杀伤力的追问,而 GRILL.md 与 profile.json 都答不出"时,才用 ask_reader。
- ask_reader 是用来摸清接缝、设计追问,不是拿来逐条核对候选人说得真不真。不为补背景、不穷尽细节、同一个点不反复追。

关于 next_probe(唯一会递给面试官的字段):
- 它面向候选人提问,必须用自然语言写成,**不得包含任何源码片段、代码块或文件路径**——面试官与候选人都不该看到项目的源码细节。
- 需要指位置时,用"某某机制 / 某某模块 / 某处校验"这类说法,绝不贴文件路径或函数源码。
- 若这段回答已经扎实、没有值得追的接缝,next_probe 留空。`;

/**
 * 结构化抽取 Prompt(两步法第二步)—— 把裁判的自由推理如实抽成 `JudgeOutput` 的字段,
 * 不改变判断结论。`did_ask_reader` / `reader_queries` 交给 {@link reconcile} 据工具记录
 * 回填,故这里让模型一律填一致的空值,避免违反 schema 的一致性 refine。
 */
const EXTRACT_SYSTEM_PROMPT = `把下面这段裁判的判断推理,如实整理成结构化结果,不得改变其判断结论:
- robustness:扎实填 solid,部分成立填 partial,崩塌填 collapsed;
- collapse_point:回答从哪里开始站不住;robustness 为 solid 时必须留空(null);
- next_probe:建议面试官对候选人发起的下一个追问,自然语言,不含源码片段或文件路径;无需再追问时留空(null);
- reasoning:裁判得出该判断的完整理由;
- did_ask_reader 一律填 false、reader_queries 一律填空数组 —— 这两个字段由系统据工具实际记录回填,你不要推断。`;

export interface JudgeAgentConfig extends BaseLlmConfig {
  /** tool-calling 循环的最大步数,防止无限下钻(决策 2:不设硬上限于提问,但防死循环) */
  maxSteps: number;
}

export const DEFAULT_JUDGE_AGENT_CONFIG: JudgeAgentConfig = {
  model: DEFAULT_MODEL,
  // 判断任务要稳,取略低温;裁判判断的不稳定是 LLM 固有风险(design Risks),温度先压低。
  temperature: 0.2,
  // 下钻节制,步数比阅读者(12)略少——裁判摸接缝够用即可,不做穷尽检索。
  maxSteps: 8,
};

/**
 * 裁判评分的输入(决策 8:纳入 `jd`)。`grill` / `profile` 整篇读入,`jd` 定尺度,
 * `history` + `answer` 是被判的这一轮。简历暂不入裁判——裁判判的是对项目的理解深度,
 * 非人岗匹配。
 */
export interface JudgeInput {
  /** 项目地图 GRILL.md 全文 */
  grill: string;
  /** 结构化档案 profile.json(序列化文本) */
  profile: string;
  /** 岗位 JD —— 用于按级别调"扎实"门槛 */
  jd: string;
  /** 到本轮为止的对话历史 */
  history: string;
  /** 候选人最新一段回答(被判对象) */
  answer: string;
}

export interface JudgeAgent {
  /** 对一段回答产出抗压判断;`reader_queries` / `did_ask_reader` 已按工具记录校准 */
  judge(input: JudgeInput): Promise<JudgeOutput>;
}

/**
 * 生成一次评分的底层实现,可注入以便测试(默认走 DeepSeek + 工具循环 + 结构化抽取)。
 * 签名刻意只收 `{ system, prompt }`:tools 与 queries 是每次评分新建的 per-call 状态,
 * 由默认实现自己在内部持有,不进签名——测试注入的 mock 因此无需接触工具。
 */
export type RunFn = (args: { system: string; prompt: string }) => Promise<JudgeOutput>;

/**
 * 构造裁判 agent。`run` 默认走 DeepSeek 两步法;注入自定义 `run` 可脱离真实模型做单测。
 * `judge` 只负责把输入拼成 system(判断标准 + GRILL + profile + JD)与 task(历史 + 回答),
 * 具体怎么跑 LLM 交给 `run`(任务 3.4)。
 */
export function createJudgeAgent(
  reader: AskReader,
  config: JudgeAgentConfig = DEFAULT_JUDGE_AGENT_CONFIG,
  run: RunFn = makeDefaultRun(reader, config),
): JudgeAgent {
  return {
    judge: (input) => run({ system: buildSystem(input), prompt: buildPrompt(input) }),
  };
}

/**
 * 用 `ask_reader` 工具**实际记录**的 queries 覆盖模型自报的 `reader_queries` /
 * `did_ask_reader`,再过一次 schema 校验(决策 9 + 任务 3.6 / 3.7)。
 *
 * `did_ask_reader` 由 queries 是否非空推出,与 `reader_queries` 天然一致;覆盖后若整体
 * 仍违反 schema(如 solid 却带崩溃点),`parse` 抛带 path 的可定位错误,不静默放行。
 */
export function reconcile(raw: JudgeOutput, actualQueries: readonly string[]): JudgeOutput {
  return JudgeOutputSchema.parse({
    ...raw,
    did_ask_reader: actualQueries.length > 0,
    reader_queries: [...actualQueries],
  });
}

/** 判断标准 + 三份项目事实(GRILL / profile / JD)拼进系统 Prompt,构成裁判的固定底牌 */
function buildSystem(input: JudgeInput): string {
  return [
    JUDGE_SYSTEM_PROMPT,
    '# 项目地图 GRILL.md',
    input.grill,
    '# 结构化档案 profile.json',
    input.profile,
    '# 岗位 JD',
    input.jd,
  ].join('\n\n');
}

/** 对话历史 + 最新回答拼进任务 Prompt —— 这是"要判的这一轮" */
function buildPrompt(input: JudgeInput): string {
  return [
    '# 对话历史',
    input.history,
    '# 候选人最新回答',
    input.answer,
    '依据上面的项目事实与判断标准,评估这段最新回答的抗压程度,并在需要时给出面向候选人的下一个追问。',
  ].join('\n\n');
}

/**
 * 默认实现:DeepSeek + `ask_reader` 工具循环,再抽成结构化 `JudgeOutput`。
 *
 * 采两步法(决策 4 / 任务 3.5):先 `generateText` + `ask_reader` 跑工具循环拿裁判的自由
 * 推理,再 `generateObject` 抽成 `JudgeOutput`——这是 AI SDK 原生的标准姿势,规避"工具
 * 循环 + 强制结构化输出"一步法在 DeepSeek 上可能的不稳。一步法是否可行留待真机验证
 * (任务 3.5、需 DEEPSEEK_API_KEY);若可行,只需在此切换,不动对外契约。
 */
function makeDefaultRun(reader: AskReader, config: JudgeAgentConfig): RunFn {
  return async ({ system, prompt }) => {
    // tools 与 queries 每次评分新建:queries 与工具 execute 内数组同引用,跑完即填满(任务 3.7)
    const { tools, queries } = makeJudgeAskTools(reader);

    const { text } = await generateText({
      model: judgeModel(config.model),
      system,
      prompt,
      tools,
      stopWhen: stepCountIs(config.maxSteps),
      temperature: config.temperature,
    });

    const { object } = await generateObject({
      model: judgeModel(config.model),
      schema: JudgeOutputSchema,
      system: EXTRACT_SYSTEM_PROMPT,
      prompt: text,
      // 抽取要确定性:同一段推理每次抽出同一结构,不再引入随机
      temperature: 0,
    });

    // 决策 9:用工具真账覆盖模型自报,并过 schema 校验(不过即抛,任务 3.6)
    return reconcile(object, queries);
  };
}
