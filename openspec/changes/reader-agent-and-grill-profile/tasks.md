## 1. Schema 与 CLI 契约改造

- [x] 1.1 用 Zod 定义新的 metadata schema(project_name / repos / links / entrypoints / open_questions / contradictions / failed_batches)并导出类型
- [x] 1.2 把 `links` 从必填的前后端二元关系改为可选的 n 元关系(repos[] + relation + source: user|inferred),新增自由文本 description
- [x] 1.3 定义分批笔记的 Zod schema(modules / open_questions / uncertain)
- [x] 1.4 CLI 参数改造:仓库列表 + 简历文件 + JD 文件 + 可选关系配置 + `--out` 输出目录
- [x] 1.5 校验简历与 JD 文件存在,缺失时以非零退出码报错

## 2. 扫描与证据收集(S0 / S1)

- [x] 2.1 忽略清单已覆盖 dist-electron、后缀伪装的锁文件与样式文件,补齐回归确认
- [x] 2.2 实现约定文档收集:自每个被扫描目录向上遍历至文件系统根,逐层尝试读取 CLAUDE.md / AGENTS.md / README.md,按由根向下排序
- [x] 2.3 实现清单文件(package.json / pyproject.toml / go.mod 等)的关键字段提取,不读全文
- [x] 2.4 实现证据分级:用户输入 > 约定文档 > README > 清单文件 > 源码
- [x] 2.5 实现短路判据:约定文档信号充足时跳过分批精读,并在日志中说明跳过原因
- [x] 2.6 比对用户自述与代码证据,产出 contradictions,不修正用户说法
- [x] 2.7 约定文档类型扩展到各家 AI 工具规则文件(.cursorrules / .clinerules / .windsurfrules / CLAUDE.local.md,及嵌套的 .github/copilot-instructions.md 与 .cursor/rules/),参照 CC /init

## 3. 分批精读(S2)

- [x] 3.1 实现按目录聚类的分批算法:小目录合并至批预算,超预算目录按子目录拆
- [x] 3.2 超过批预算的单个文件单独成批且不截断;移除 MAX_SOURCE_CHARS 单文件截断
- [x] 3.3 写 S2 Prompt:只记跨文件才能得出的结论,单文件即可得到的一律不记
- [x] 3.4 显式设置 LLM 调用参数(temperature / max_tokens / response_format),不依赖 provider 默认值
- [x] 3.5 每批笔记落盘到 `notes/`,重跑汇总时直接复用不重新调用
- [x] 3.6 批次失败记入 failed_batches 并保留失败原因;全部批次失败时以非零退出码终止不落盘
- [x] 3.7 批次并发控制与重试次数配置

## 4. 汇总与产出(S3)

- [x] 4.1 写 S3 Prompt:取舍判据固定为"删掉这行下游会不会误判",含 Include / Exclude 清单
- [x] 4.2 生成 GRILL.md 正文(项目概述 / 架构 / 关键决策 / 值得注意)
- [x] 4.3 目录树原样附在 GRILL.md 末尾,不经 LLM 改写
- [x] 4.4 failed_batches 非空时在 GRILL.md 中显式标注未分析区域
- [x] 4.5 生成 profile.json 并通过 Zod 校验,不通过则报错且不落盘
- [x] 4.6 GRILL.md 作为独立 markdown 文件落盘,不作为 JSON 字符串字段
- [x] 4.7 打印各产物路径与体积
- [x] 4.8 目录树自适应内联/外置:阈值内内联进 GRILL.md,超阈值外置为 GRILL.md 引用的 sidecar(trees/<仓名>.txt),两种情形均逐字、不经 LLM(面向 UE 级大项目)

## 5. 阅读者 Agent 与工具集

- [x] 5.1 ~~添加 Mastra 依赖~~ → 改用 AI SDK 原生 tool-calling(`generateText` + `tools` + `stopWhen: stepCountIs`),零新依赖。理由:spec 是框架无关的,阅读者是无状态一问一答用不上 Mastra 的 workflow/memory,且 Mastra↔ai@5 兼容性有风险(见 design 决策 12)
- [x] 5.2 实现 `read_file(路径[, 行偏移, 行数])` 工具,支持范围读取
- [x] 5.3 read_file 超体积上限时抛出可读错误并提示改用范围读取,不返回截断内容
- [x] 5.4 实现 `glob(模式)` 工具,设结果条数上限
- [x] 5.5 实现 `grep(模式[, 路径])` 工具,设结果条数上限
- [x] 5.6 grep/glob 截断时告知并附下一步建议(缩小模式 / 用偏移量翻页);命中数恰好等于上限时不报告截断
- [x] 5.7 grep/glob 提供解除条数上限的显式入参(`all=true`),供穷尽检索使用
- [x] 5.8 三个工具统一的路径安全校验:解析为绝对路径后必须仍在已声明仓根内,拒绝 `..`、符号链接、仓外绝对路径
- [x] 5.9 工具遇到不存在的路径时返回可读错误,不抛出中断流程
- [x] 5.10 用 AI SDK 定义阅读者 agent,注册三个工具,输入含源码、简历、JD
- [x] 5.11 写阅读者 Prompt:只写如何理解项目与如何取舍,不写输出格式

## 6. 在线问答接口

- [x] 6.1 实现 `ask_reader(question): Promise<string>`,返回值类型只允许自然语言文本
- [x] 6.2 接口不提供任何返回源码原文、代码块或文件路径列表的参数与返回分支
- [x] 6.3 Prompt 中约束回答不得逐字转述源码
- [x] 6.4 记录每次调用的问题与回答,供评估期抽查

## 7. 验证

- [x] 7.1 对真实仓端到端跑通离线生成(WhatIf 双仓,产出见 examples/whatif),人工核对 GRILL.md 满足"删掉这行会不会误判"判据:无逐文件清单/构建命令,保留跨模块架构、关键决策、坑
- [~] 7.2 GRILL.md(5.2 KB)+ profile.json(5.6 KB)体积远在 100K 预算内已确认;**批预算校准待补**——WhatIf 短路未分批、Looping 资产噪声过大,尚缺一个"干净的大仓批量精读"来实测校准 40K 批预算(design Open Question)
- [x] 7.3 验证 notes/ 缓存生效:重跑显示 `[缓存命中]`、未重新调用精读
- [x] 7.4 人工抽查 ask_reader 回答:即便被要求"贴完整实现每一行",回答无代码块、不逐字转述,只给文件/符号名
- [x] 7.5 覆盖异常路径(均有测试):仓外/`..` 逃逸被拒、grep 超限告知截断、read_file 超体积抛错而非截断、恰好等于上限不误报截断、简历/JD 文件缺失报错、批次失败标注盲区、全批失败抛错不落盘
- [x] 7.6 单仓 + 无关系配置 + 无约定文档的降级链走通(scratchpad fixture 与 pipeline.test 用例 A 均验证 S2 精读路径)

## 8. 下游同步

- [x] 8.1 已在 judge-agent-and-eval/proposal.md 的 Impact 记下上游契约变更:输入契约 LightProfile JSON → GRILL.md + profile.json、下钻工具 read_file → ask_reader(裁判不再注册文件工具)
