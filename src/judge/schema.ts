import { z } from 'zod';

/**
 * 裁判对一段回答的评分产出 —— 结构由 Zod 固定,格式永不漂移(design 决策 1)。
 *
 * 字段分两类,混在一个对象里但用途不同:
 * - 对外结论:`robustness` / `collapse_point` / `next_probe` —— 面试官与编排层据此推进;
 * - 内部过程:`did_ask_reader` / `reader_queries` / `reasoning` —— 裁判如何得出结论。
 *   内部过程不该原样递给面试官,收窄靠 `toInterviewerProbe` 的类型投影,而非调用方自觉
 *   (design 决策 3:靠函数边界,不靠"记得只挑一个字段")。
 */
export const JudgeOutputSchema = z
  .object({
    /** 回答的抗压程度:扎实 / 部分成立 / 崩塌 */
    robustness: z.enum(['solid', 'partial', 'collapsed']),
    /**
     * 接缝所在 —— 回答从哪里开始站不住。
     * solid 时没有崩溃点,必须为 null(见下方 refine);partial / collapsed 时描述接缝位置。
     */
    collapse_point: z.string().min(1).nullable(),
    /** 本轮是否向阅读者追问过 —— 与 `reader_queries` 是否为空严格一致(见下方 refine) */
    did_ask_reader: z.boolean(),
    /** 本轮向阅读者问过的问题原文,按提问顺序;裁判够不到源码,下钻只能经 ask_reader */
    reader_queries: z.array(z.string().min(1)),
    /**
     * 建议面试官对候选人发起的下一个追问;无需继续追问时为 null。
     * 这是唯一会被投影给面试官的字段,故不得含源码片段或文件路径(该约束在 Prompt 层加,见任务 3.3)。
     */
    next_probe: z.string().min(1).nullable(),
    /** 裁判的完整推理 —— 内部过程;回归脚本排查"判断错还是标注错"时要读它(design Risks) */
    reasoning: z.string().min(1),
  })
  .refine((o) => o.robustness !== 'solid' || o.collapse_point === null, {
    message: 'robustness 为 solid 时 collapse_point 必须为 null:回答扎实则不存在崩溃点',
    path: ['collapse_point'],
  })
  .refine((o) => o.did_ask_reader === (o.reader_queries.length > 0), {
    message: 'did_ask_reader 必须与 reader_queries 是否为空一致:问过则非空,没问过则为空',
    path: ['did_ask_reader'],
  });

export type JudgeOutput = z.infer<typeof JudgeOutputSchema>;

/**
 * 面试官视图投影 —— 由函数/类型边界保证面试官只拿得到 `next_probe`(design 决策 3)。
 *
 * 裁判的 `reasoning`、`reader_queries` 等内部过程到此为止,不随 JudgeOutput 一起外泄给面试官;
 * 下游要给面试官喂数据,只经此函数,而不是自己从 JudgeOutput 里手挑字段。
 */
export function toInterviewerProbe(o: JudgeOutput): string | null {
  return o.next_probe;
}
