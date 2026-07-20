import { deepseek } from '@ai-sdk/deepseek';
import type { LanguageModel } from 'ai';

/**
 * LLM 的集中控制台 —— provider、默认模型、通用配置形状都收在这里。
 *
 * 这个项目的核心是 LLM 编排,"用哪个 provider、哪个模型"这类旋钮不该散落在
 * 各阶段模块里(否则换模型要改好几处,加缓存埋点/换 provider 更是处处同步)。
 * 各阶段(S2 精读、S3 汇总、在线问答)只在此基础上叠加自己的差异参数
 * (输出上限、并发、步数等)。
 */

/** 默认模型;`deepseek-chat` 上下文 100K token */
export const DEFAULT_MODEL = 'deepseek-chat';

/** 各阶段 LLM 配置的公共底座 */
export interface BaseLlmConfig {
  /** 模型 id */
  model: string;
  /** 采样温度 */
  temperature: number;
}

/** 构造语言模型句柄。集中在此,换模型/换 provider 只改这一处 */
export function readerModel(model: string = DEFAULT_MODEL): LanguageModel {
  return deepseek(model);
}
