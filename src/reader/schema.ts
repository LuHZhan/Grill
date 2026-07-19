import { z } from 'zod';

/**
 * 一条功能关系 —— 泛化为 n 元。
 *
 * 不再锁死"前端文件 ↔ 后端接口"的二元形态:单仓项目不该被迫编造链路,
 * 而三方以上的调用链(前端 → BFF → 核心服务)在二元结构里也无处安放。
 * `source` 区分用户手写与阅读者推导 —— 下游据此决定这条关系有多可信。
 */
export const LinkSchema = z.object({
  relation: z.string().min(1),
  repos: z.array(z.string().min(1)).min(1),
  source: z.enum(['user', 'inferred']),
  description: z.string().optional(),
});

/** 一个被扫描的仓库 —— 只保留机械可得的事实,语义交给 GRILL.md */
export const RepoSchema = z.object({
  name: z.string().min(1),
  path: z.string().min(1),
  tree: z.string(),
});

/**
 * 用户自述与代码证据的一处不一致。
 * 两侧都必须留存:只记结论会让下游无从判断是用户记错了还是扫描漏了。
 */
export const ContradictionSchema = z.object({
  claim: z.string().min(1),
  evidence: z.string().min(1),
  path: z.string().optional(),
});

/** 一个精读失败的批次 —— 地图上的空白必须可见,否则会被读作"那里不存在东西" */
export const FailedBatchSchema = z.object({
  batch: z.string().min(1),
  paths: z.array(z.string()),
  reason: z.string().min(1),
});

/** metadata —— 与 GRILL.md 并列的结构化产出,供编排层与下游角色按字段取用 */
export const ProfileSchema = z.object({
  project_name: z.string().min(1),
  repos: z.array(RepoSchema),
  links: z.array(LinkSchema),
  entrypoints: z.array(z.string()),
  open_questions: z.array(z.string()),
  contradictions: z.array(ContradictionSchema),
  failed_batches: z.array(FailedBatchSchema),
});

/**
 * 分批精读产出的笔记 —— S2 的中间产物,落盘到 notes/ 供汇总阶段复用。
 *
 * `contracts` 与 `decisions` 只记跨文件才能得出的结论;单读一个文件就能知道的
 * 事实不进这里 —— 下游有检索工具,复述反而挤占上下文。
 * `uncertain` 是分批的固有代价:一批看不全的东西必须显式留痕,否则汇总时
 * 会把"这批没看见"误当成"项目里没有"。
 */
export const BatchNoteSchema = z.object({
  batch: z.string().min(1),
  modules: z.array(
    z.object({
      path: z.string().min(1),
      role: z.string(),
      contracts: z.array(z.string()),
      decisions: z.array(z.string()),
    }),
  ),
  open_questions: z.array(z.string()),
  uncertain: z.array(z.string()),
});

/** 用户手写的关系配置文件格式 —— 整份可选 */
export const LinksConfigSchema = z.object({
  project_name: z.string().min(1),
  links: z.array(LinkSchema),
});

export type Repo = z.infer<typeof RepoSchema>;
export type Link = z.infer<typeof LinkSchema>;
export type Contradiction = z.infer<typeof ContradictionSchema>;
export type FailedBatch = z.infer<typeof FailedBatchSchema>;
export type Profile = z.infer<typeof ProfileSchema>;
export type BatchNote = z.infer<typeof BatchNoteSchema>;
export type LinksConfig = z.infer<typeof LinksConfigSchema>;
