# 实现计划 —— Grill 问答仓库（Agent 面试题库 + 复习对答）

> 交付给实现 Agent 的开发计划。视觉与交互基准：`qa-repo.dc.html`（原型，判定为本地模拟）；风格一律遵循 `style-guide-grill.md`。
> 运行形态：纯前端项目，`localhost` 启动，无后端、无用户系统（浏览器即用户）。

## 1. 目标

个人面试题仓库：导入收集到的 Agent 工程师面试题（含/不含答案）→ 本地持久化 → 按薄弱优先复习 → 侧边 Agent 对答（LLM 判定回答质量、起草缺失答案、追问下钻）。

## 2. 技术选型

- Vite + React 18 + TypeScript（SPA，`npm run dev` 即可用；不需要 SSR/路由库，单页两栏）
- IndexedDB via **Dexie**（题库量级几百~几千条，localStorage 不够；键值配置仍可用 localStorage）
- **Zod** 校验 LLM 结构化输出
- LLM：OpenAI 兼容 `/chat/completions` 直连（默认 DeepSeek `https://api.deepseek.com`，支持浏览器直连 CORS）。baseUrl / apiKey / model 在设置面板配置，存 localStorage，永不上传
- 样式：与原型一致的内联风格或 CSS-in-JS 均可，色板/字体严格按 `style-guide-grill.md`（Manrope + Noto Sans SC / Noto Serif SC / JetBrains Mono）

## 3. 数据模型（Dexie tables）

```ts
Question {
  id: string            // nanoid
  question: string
  answerPoints: string[]        // 空数组 = 暂无答案
  answerDraft?: string[]        // Agent 起草、未采纳
  category: string
  tags: string[]
  source: string                // 如 "字节 · 二面" / "面经 · 牛客"
  createdAt: number
  normalized: string            // 去空白标点的小写题面，唯一索引，用于导入去重
}
Review {
  questionId: string    // 主键
  mastery: 'new' | 'partial' | 'collapsed' | 'solid'
  lastReviewedAt?: number
  dueAt: number
  history: { at: number; verdict: string; answer?: string }[]
}
Conversation {          // 每次对答一条，可回看
  id: string; questionId: string; startedAt: number
  turns: { role: 'agent'|'user'|'judge'; content: string; verdict?: JudgeOutput }[]
}
```

设置（localStorage）：`{ baseUrl, apiKey, model, temperature }`。

## 4. 导入（P0）

入口：顶栏「导入」按钮 → 弹层粘贴文本 / 拖入 .md 文件 → **解析预览（可勾选、可改分类）→ 确认入库**。

支持两种格式，自动识别：

**A. Markdown**
```md
## 问题题面写在二级标题
[分类] 标签1 · 标签2   ← 可选，紧跟标题的中括号行
- 答案要点 1
- 答案要点 2
（无列表项 = 无答案题）
```

**B. 纯文本 Q/A**
```
Q: 问题题面
A: 答案（可多行，空行或下一个 Q: 结束；无 A: = 无答案题）
```

规则：按 `normalized` 去重（重复项在预览中标灰）；无分类默认「未分类」；导入后 Review 记录初始化为 `new / dueAt=now`。

## 5. 复习调度（P1）

简化 SM-2，按判定写 `dueAt`：solid +7d、partial +1d、collapsed +4h、new 立即。
抽题：到期题中按薄弱加权随机（collapsed×4、new×3、partial×2、solid×1），与原型一致；排除刚做过的上一题。

## 6. LLM 层（P1–P2）

统一封装 `llm.ts`：fetch 流式 SSE、超时 60s、schema 校验失败把 zod 报错回喂重试 1 次，再失败降级为纯文本展示。三个任务：

**a) judge（判定回答）** — system prompt 采用 Grill 裁判口吻（找最脆弱的接缝，不是抓造假）。输入：题面 + 标准要点（可空）+ 用户回答。输出 `response_format: json_object`：
```ts
JudgeOutput = {
  verdict: 'solid' | 'partial' | 'collapsed'
  seam: string              // 最脆的接缝，引用用户原话中的脆弱短语
  vague_phrase?: string     // 用户回答中需高亮的原词（前端做琥珀 mark）
  missed_points: string[]   // 漏掉/该补的要点，≤3 条
  comment: string           // 教练一句话，短句、站在用户这边
  followup: string          // 追问，一句
}
```
判定结果写回 Review（mastery + dueAt + history），对话写 Conversation。

**b) draft_answer（起草缺失答案）** — 输入题面+分类，输出 `{ points: string[] } `（3-5 条，工程视角、含具体机制名词）。存入 `answerDraft`，UI 上「采纳草稿，存入题库」后转正为 `answerPoints`。

**c) followup（追问下钻）** — 判定后点「追问」进入多轮：携带本题对话历史继续，judge 同 schema，轮次沿用原型的对谈实录样式（问题衬线大字、回答引用块、`└─ 接缝` 注解）。

安全：LLM 输出是不可信输入——只渲染文本，不 `dangerouslySetInnerHTML`；`vague_phrase` 用字符串匹配高亮。

## 7. UI（以 `qa-repo.dc.html` 为准）

- 顶栏：品牌 GRILL//BANK、统计（总数/已掌握/待复习）、「导入」「设置」入口
- 筛选行：分类 chips（深底选中）+ 状态 chips（靛紫选中）+ 关键词搜索框
- 题目列表：薄弱优先排序，行内展开答案要点，手动标记三态；无答案题带琥珀「暂无答案」标
- 侧边 Agent 面板（380px，`#f6f4f0`）＝**对话主体**：顶部固定上下文 chip（当前载入的题）；中间对谈实录式转写流（AGENT 消息带标签/判定章、提问用衬线大字、用户消息为左竖线引用块、载入上下文用居中 mono 分隔行——禁 IM 气泡）；底部输入框（Enter 发送，Shift+Enter 换行）。不做快捷动作 chips
- 左侧每行有明确的「选中对答」按钮（选中态为靛紫实底「已选中」）：点击＝载入上下文 + Agent 立即出题开考；行点击仅展开要点。选中行左缘靛紫 3px 标识
- 对答流：选中 → Agent 出题 → 用户作答 → 判定（有基准答案时）；无基准答案的题作答后 Agent 起草要点并入库，不判定
- 判定中状态用琥珀脉冲点 +「裁判正在找接缝…」

## 8. 备份

设置面板：导出全库 JSON（Question+Review）/ 导入合并（按 normalized 去重）。清浏览器数据前的唯一兜底，P1 就做。

## 9. 里程碑

- **M1**：项目脚手架 + Dexie 数据层 + 导入解析（A/B 格式、预览、去重）+ 列表/筛选（迁移原型 12+1 条示例数据作种子）
- **M2**：复习调度 + 对答卡状态机（判定先用原型同款本地启发式占位）+ JSON 备份
- **M3**：LLM 接入（设置面板、judge / draft_answer / followup、流式、zod 重试）
- **M4**：追问多轮 UI、对答历史回看、打磨（快捷键：Space 抽题、Cmd+Enter 提交）

## 10. 验收

1. 粘贴 20 条混合格式题目 → 预览正确、无重复入库
2. 刷新 / 重启 dev server 后数据完好
3. 无答案题：对答后拿到草稿 → 采纳 → 列表可见要点
4. 填入 DeepSeek key 后判定为真实 LLM 输出且 schema 稳定；断网/无 key 时降级为本地占位并明确提示
5. 视觉与 `qa-repo.dc.html` 一致（色板、字体、判定章、接缝注解样式）
