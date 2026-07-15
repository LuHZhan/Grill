import { z } from 'zod';

/** 轻档案里的一个关键模块:路径 + 一句话职责 */
export const ModuleSchema = z.object({
  path: z.string().min(1),
  role: z.string(),
});

/** 一个被扫描的仓库 */
export const RepoSchema = z.object({
  name: z.string().min(1),
  path: z.string().min(1),
  tree: z.string(),
  modules: z.array(ModuleSchema),
});

/** 一条前后端功能链路 */
export const LinkSchema = z.object({
  desc: z.string().min(1),
  frontend: z.string().min(1),
  backend: z.string().min(1),
});

/** 轻档案 —— 预处理的最终产出,也是裁判 Agent 的直接输入 */
export const LightProfileSchema = z.object({
  project_name: z.string().min(1),
  repos: z.array(RepoSchema),
  links: z.array(LinkSchema),
});

/** 用户手写的链路配置文件格式 */
export const LinksConfigSchema = z.object({
  project_name: z.string().min(1),
  links: z.array(LinkSchema),
});

export type Module = z.infer<typeof ModuleSchema>;
export type Repo = z.infer<typeof RepoSchema>;
export type Link = z.infer<typeof LinkSchema>;
export type LightProfile = z.infer<typeof LightProfileSchema>;
export type LinksConfig = z.infer<typeof LinksConfigSchema>;
