# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 引用外部源码时的翻译规范

从 Claude Code 源码(`G:/AgentProjects/claude-code-tudou`)或其他英文项目引用做法时,凡是引用其**注释、Prompt 文本或文档原文**,必须**英文原文与中文翻译同时显示**,不得只给其中一方。

原文在上、译文在下,译文标注为「译:」。例如:

> Tested truncating instead of throwing for explicit-limit reads that exceed the byte cap. Reverted: tool error rate dropped but mean tokens rose.
>
> 译:试过把"超出字节上限就抛错"改成截断。已回滚——工具报错率是降了,但平均 token 消耗上升了。

理由:原文是判断依据,不能丢失;译文保证阅读效率。只给译文会让人无法核对我是否理解偏了。

代码标识符、命令、文件路径保持原样,不翻译。

## 提交规范

本项目的 commit message **用中文**——这是对全局规则「Commit message 用 Conventional Commits 英文」的项目级覆盖(本项目 openspec 文档、代码注释均为中文,提交同语言更连贯)。

仍遵循 Conventional Commits 结构:类型前缀(`feat`/`fix`/`chore`/`refactor`/`docs` 等)保留英文,冒号之后的描述与正文用中文。示例:

```
feat(reader): 实现分批精读与 notes 缓存

按目录聚类分批,超预算单文件独占一批不截断;每批笔记落盘到 notes/,
重跑汇总阶段直接复用,不重付精读成本。
```
