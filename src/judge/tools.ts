import { tool } from 'ai';
import { z } from 'zod';
import type { AskReader } from '../reader/online/ask.js';

/**
 * 裁判的下钻工具 —— 只有 ask_reader 一个,**不注册任何文件工具**(任务 2.1 / 2.4)。
 *
 * 信息与安全边界(design 决策 2):裁判手里没有源码路径,也够不到文件系统,下钻只能
 * 通过 `ask_reader(question)` 拿回自然语言结论。因此"限定仓根内、拒 `..` / 符号链接"
 * 这类路径安全校验归阅读者(上游 `src/reader/online/tools.ts` 已实现并验证),裁判侧
 * 不重做 —— 攻击面直接消失:被诱导的裁判也读不到任意本地文件,因为它根本没有文件工具。
 */

/** 一次裁判问答封装的产物:工具集 + 本轮问过的问题记录 */
export interface JudgeAskTools {
  /** 注册给裁判 agent 的工具集(只含 ask_reader) */
  tools: ReturnType<typeof buildAskReaderTool>['tools'];
  /**
   * 本轮向阅读者问过的问题原文,按提问顺序 —— 与 execute 内数组同引用,agent 跑完即填满。
   * 供裁判入口(任务 3.4)填充 `JudgeOutput.reader_queries`,并据其非空推出 `did_ask_reader`。
   */
  readonly queries: readonly string[];
}

/**
 * 把上游阅读者的 `ask_reader` 封成裁判可调用的 AI SDK 工具。
 *
 * - 失败不抛(任务 2.2):`ask_reader` 抛错时转成可读错误字符串返回给裁判,不中断整轮评分;
 * - 问了就记(任务 2.3):无论成败都把问题记入 `queries` —— "问过"是行为,不以是否答上来为准。
 */
export function makeJudgeAskTools(reader: AskReader): JudgeAskTools {
  const built = buildAskReaderTool(reader);
  return { tools: built.tools, queries: built.queries };
}

function buildAskReaderTool(reader: AskReader) {
  const queries: string[] = [];
  const tools = {
    ask_reader: tool({
      description:
        '就项目地图(GRILL.md / profile.json)答不了的实现细节,向通读过全部源码的阅读者提一个自然语言问题,拿回自然语言结论。你没有源码文件与路径,想核实实现只能经此;每次只问一个具体的点。',
      inputSchema: z.object({
        question: z.string().min(1).describe('要问阅读者的单个问题,自然语言,具体到一个点'),
      }),
      execute: async ({ question }: { question: string }) => {
        queries.push(question); // 2.3:问过即记,不以成败为准
        try {
          return await reader.ask_reader(question);
        } catch (err) {
          // 2.2:失败转可读错误返回,不抛出中断整轮
          return `阅读者暂时无法作答(${err instanceof Error ? err.message : String(err)});可换个问法,或据现有信息作出判断`;
        }
      },
    }),
  };
  return { tools, queries: queries as readonly string[] };
}
