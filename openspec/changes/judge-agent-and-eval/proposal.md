## Why

裁判是整个面试模块价值的核心:它决定"用户这段话到底站不站得住"。面试官只是把裁判找到的接缝包装成问题问出来——裁判判错,整场面试就废了。因此方案明确要求**先让裁判单独可靠,再接面试官串流程**(第九节第 2-3 步)。

这个变更做两件事:实现裁判角色,以及给它配一套能脱离主观感觉的验证手段。没有评估集,"裁判准不准"只能靠拍脑袋;有了标注测试集与回归脚本,每次改 Prompt / 换模型都能看到一致率是涨是跌。这层能力也是投岗时证明"不只会搭多 Agent 系统,还会衡量和保证质量"的核心弹药。

上游变更 `reader-agent-and-grill-profile` 已定稿并归档:阅读者离线产出 `GRILL.md`(项目地图)+ `profile.json`(结构化 metadata),并提供在线问答接口 `ask_reader`。裁判的输入契约与下钻方式据此确定。

## What Changes

- 新增**裁判 Agent**:输入 `GRILL.md` + `profile.json` + 对话历史 + 用户最新回答,输出结构化判断。
- 注册 **`ask_reader` 工具**——地图答不了的细节,裁判向全知阅读者提问,只拿回自然语言结论。裁判**不注册任何文件工具**,物理上够不到源码。MVP 不限提问次数。
- 用 **Zod schema 强制约束 `JudgeOutput`**(robustness / collapse_point / did_ask_reader / reader_queries / next_probe / reasoning),防格式漂移。
- 裁判 Prompt **只写判断力**:找接缝的标准、抗压判断的尺度。结构与边界交给代码,不靠 Prompt 自觉。
- 新增**标注测试集**:10–15 个 `{回答, 标注的正确 robustness}` 案例,覆盖扎实 / 虚 / 有效包装三类。**由用户手写**——他对被测项目烂熟于心,是最准的标注者。
- 新增**回归脚本**:把标注回答喂给裁判,对比其 `robustness` 判断与标注,输出一致率与逐条 diff。

## Capabilities

### New Capabilities

- `judge-agent`: 裁判角色本身——接收 `GRILL.md` + `profile.json` 与对话上下文、通过 `ask_reader` 向全知阅读者追问地图未覆盖的细节、产出 Zod 强制约束的 `JudgeOutput` 抗压判断。
- `judge-eval`: 裁判判断质量的评估能力——标注测试集的格式与加载、回归脚本的执行与一致率报告。

### Modified Capabilities

<!-- 无。`light-profile` 的 spec 不变,本变更只消费它的产出,不改其需求。 -->

## Impact

- **新增代码**:裁判 Agent 定义与 Prompt、`JudgeOutput` 的 Zod schema、`ask_reader` 工具接线、标注测试集加载器、回归脚本。
- **新增依赖**:无。裁判用已有的 AI SDK(`ai@5`)原生 tool-calling 实现,不引 Mastra——与上游 `reader-agent-and-grill-profile` 保持一致(见 design 决策 1)。
- **新增数据**:标注测试集文件(用户手写),需与被测项目对应。
- **消费契约**:整篇读入上游 `reader-agent-and-grill-profile` 产出的 `GRILL.md`,并按字段取用 `profile.json`(`project_name` / `repos` / `links` / `entrypoints` / `open_questions` / `contradictions` / `failed_batches`);下钻走阅读者的 `ask_reader(question): Promise<string>`。裁判不再持有源码路径(阅读者是全知边界)。
- **产出契约**:`JudgeOutput` 的字段结构,是后续「面试官 + 编排」变更的直接输入(面试官读 `next_probe`,复盘读 `robustness` 与 `reasoning`)。
- **不含**:面试官角色、编排层流转、复盘双评分、面试存档——均属第三个变更。
- **外部依赖**:`ask_reader` 由阅读者提供,阅读者需被测项目源码在本地可读;评估需要 `DEEPSEEK_API_KEY`。
