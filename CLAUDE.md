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
