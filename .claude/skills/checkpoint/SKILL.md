---
name: checkpoint
description: >-
  在清空上下文(/clear)前,把当前会话的工作状态总结并归档成文件,供清空后读回接续。
  触发时机:对话变长、需要在 /clear 或 /compact 前保存进度、或要把当前进展交接给下一个
  会话。用户可显式 /checkpoint 触发;你也可以在判断上下文已经很长时**主动提议**。
  **动手归档前必须先征得用户确认**,不得静默执行。不适用于:一次性问答、无需跨会话接续的
  短任务、以及纯粹只想省 token(那用内置 /compact 即可)。
metadata:
  category: workflow
---

# Checkpoint —— 会话状态总结与归档

你在帮用户把当前会话"存档",以便他随后手动 `/clear` 清空上下文,再由下一个会话读回这份存档无缝接续。这解决的是"上下文太长,想清空重开但不想丢掉已经理清的状态与决策"。

## 步骤

### 1. 先确认(硬性,不可跳过)

在做任何归档动作之前,**MUST 先向用户确认**——用 AskUserQuestion,或直接问一句:

- 现在做 checkpoint 吗?
- 有没有要特别保留/强调的,或要排除的内容?

用户明确同意后才继续。用户说"先别"就停下,**不归档、不写文件**。这条是用户明确要求的护栏:执行前先询问。

### 2. 总结当前工作状态

把这次会话到目前为止的**状态**(不是逐字流水账)提炼成结构化 markdown:

- **目标 / 背景**:这轮在做什么、为什么
- **已完成**:做了哪些,分别落在哪些文件(给仓库相对路径)
- **进行中 / 下一步**:当前进度、卡点、下一步该干什么
- **关键决策**:做过的重要取舍与理由——**避免下个会话重新纠结已定的事**
- **待办 / 悬空**:未决问题、需要用户拍板的点
- **接续入口**:接手时最该先看的文件、跑测试/构建/校验的命令
- **验证状态**:测试 / typecheck / 构建 现在是什么状态

取舍判据:**一个"冷启动"的新会话,读完这份就能无缝接着干,不用回头重问用户已经定过的事。**

### 3. 落盘(嵌 session_id 供精确读回)

写到 `.claude/checkpoints/<YYYY-MM-DD-HHmm>-<短横线标题>.md`(目录不存在则创建)。

文件**顶部放 YAML frontmatter**,记录来源会话与时间,供 `/clear` 后的读回 hook 精确匹配:

```
---
session_id: <读 $CLAUDE_CODE_SESSION_ID 得到,写文件前用一次 Bash 取值>
created_at: <绝对日期时间,ISO>
title: <短标题>
---

# Checkpoint: <短标题>(<绝对日期时间>)
```

`session_id` 用于 hook **先按会话精确匹配**;匹配不到再按文件新旧(时效)兜底。用绝对日期,不用"今天/刚才"。

### 4. 交接说明

写完告诉用户:

- 存档的路径与体积
- 现在可以手动 `/clear` 了
- 清空后如何读回:若已配 `SessionStart` 读回 hook,清空后会自动接上;否则在下个会话让我读这个文件即可

## 明确不做

- **不替用户执行 `/clear`** —— 它是 Claude Code 的内置命令,模型无法调用,必须由用户手动按。归档做完只提醒用户去按,别假装能自己清。
- **不把整段对话逐字抄进存档** —— 那违背"压缩"的初衷;只留能接续的状态与决策。
- **未经确认不写文件** —— 见步骤 1。

## (可选)清空后自动提示读回

本目录带了一个配套脚本 `session-start-checkpoint.ps1`(Windows PowerShell),用于在 `/clear` 后自动检测是否有本会话的 checkpoint 并提示读回。启用方式:在 `.claude/settings.local.json`(本地,不入库)加一个 `SessionStart` hook:

```json
{
  "hooks": {
    "SessionStart": [
      { "matcher": "clear", "hooks": [
        { "type": "command", "command": "powershell -NoProfile -File .claude/skills/checkpoint/session-start-checkpoint.ps1" }
      ] }
    ]
  }
}
```

脚本匹配优先级:先按 frontmatter 的 `session_id` 精确匹配"本会话"的存档;匹配不到再退回"最近 30 分钟内最新"的存档。命中则注入提示让模型询问用户是否读回;不命中则静默。**首次新建 settings 文件后,需在 Claude Code 里打开一次 `/hooks` 或重启,hook 才会被加载。**
