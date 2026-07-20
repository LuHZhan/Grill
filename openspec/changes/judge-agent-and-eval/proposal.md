## Why

裁判是整个面试模块价值的核心:它决定"用户这段话到底站不站得住"。面试官只是把裁判找到的接缝包装成问题问出来——裁判判错,整场面试就废了。因此方案明确要求**先让裁判单独可靠,再接面试官串流程**(第九节第 2-3 步)。

这个变更做两件事:实现裁判角色,以及给它配一套能脱离主观感觉的验证手段。没有评估集,"裁判准不准"只能靠拍脑袋;有了标注测试集与回归脚本,每次改 Prompt / 换模型都能看到一致率是涨是跌。这层能力也是投岗时证明"不只会搭多 Agent 系统,还会衡量和保证质量"的核心弹药。

前置变更 `preprocess-light-profile` 已实现,轻档案的结构已由 Zod schema 定死,裁判的输入契约是确定的。

## What Changes

- 新增**裁判 Agent**:输入轻档案 + 对话历史 + 用户最新回答,输出结构化判断。
- 注册 **`read_file` 工具**——裁判可按需读取单个源码文件下钻。MVP 无护栏、无预算、想读就读。
- 用 **Zod schema 强制约束 `JudgeOutput`**(robustness / collapse_point / did_drill / drilled_files / next_probe / reasoning),防格式漂移。
- 裁判 Prompt **只写判断力**:找接缝的标准、抗压判断的尺度。结构与边界交给代码,不靠 Prompt 自觉。
- 新增**标注测试集**:10–15 个 `{回答, 标注的正确 robustness}` 案例,覆盖扎实 / 虚 / 有效包装三类。**由用户手写**——他对被测项目烂熟于心,是最准的标注者。
- 新增**回归脚本**:把标注回答喂给裁判,对比其 `robustness` 判断与标注,输出一致率与逐条 diff。

## Capabilities

### New Capabilities

- `judge-agent`: 裁判角色本身——接收轻档案与对话上下文、通过 `read_file` 按需下钻源码、产出 Zod 强制约束的 `JudgeOutput` 抗压判断。
- `judge-eval`: 裁判判断质量的评估能力——标注测试集的格式与加载、回归脚本的执行与一致率报告。

### Modified Capabilities

<!-- 无。`light-profile` 的 spec 不变,本变更只消费它的产出,不改其需求。 -->

## Impact

- **新增代码**:裁判 Agent 定义与 Prompt、`JudgeOutput` 的 Zod schema、`read_file` 工具实现、标注测试集加载器、回归脚本。
- **新增依赖**:Mastra(角色与工具注册)。Vercel AI SDK + DeepSeek 已在预处理变更中引入,复用。
- **新增数据**:标注测试集文件(用户手写),需与被测项目对应。
- **消费契约**:直接读取 `preprocess-light-profile` 产出的 `LightProfile` JSON 与其导出的 TypeScript 类型;该结构须保持稳定。

> **⚠️ 上游契约已变更(`reader-agent-and-grill-profile` 定稿,本变更动工前须先修订)**
>
> 该上游变更已把预处理管道升格为"阅读者"角色,产出与工具边界随之改变。本变更的 design 与 tasks 中凡涉及以下两点的,都要改:
>
> 1. **输入契约:`LightProfile` JSON → `GRILL.md` + `profile.json`**。裁判整篇读入 `GRILL.md`(项目地图,含目录树附录),并按字段取用 `profile.json`(`project_name` / `repos` / `links` / `entrypoints` / `open_questions` / `contradictions` / `failed_batches`)。不再有 `LightProfile` 这个类型。
> 2. **下钻工具:`read_file` → `ask_reader`**。裁判**不再注册任何文件工具**,物理上够不到源码;地图答不了的问题改为调用阅读者的 `ask_reader(question): Promise<string>`,只拿回自然语言结论。理由见上游 design 决策 1(全知归阅读者不归裁判)与决策 2(返回值类型即边界)。据此,本变更 design 中"裁判注册 `read_file`"、`read_file` 路径安全校验等段落全部作废,由 `ask_reader` 取代。
- **产出契约**:`JudgeOutput` 的字段结构,是后续「面试官 + 编排」变更的直接输入(面试官读 `next_probe`,复盘读 `robustness` 与 `reasoning`)。
- **不含**:面试官角色、编排层流转、复盘双评分、面试存档——均属第三个变更。
- **外部依赖**:`read_file` 下钻需要被测项目源码在本地可读;评估需要 `DEEPSEEK_API_KEY`。
