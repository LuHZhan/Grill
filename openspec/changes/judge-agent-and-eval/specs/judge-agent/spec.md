## ADDED Requirements

### Requirement: 裁判产出结构化抗压判断

裁判 SHALL 接收 `GRILL.md` + `profile.json`、岗位 JD、对话历史与用户最新回答,产出一个 `JudgeOutput` 对象。该对象 MUST 由 Zod schema 强制约束,包含 `robustness`(`solid` | `partial` | `collapsed`)、`collapse_point`、`did_ask_reader`、`reader_queries`、`next_probe`、`reasoning` 六个字段。

#### Scenario: 对一段回答产出合法判断

- **WHEN** 裁判收到 `GRILL.md` + `profile.json`、岗位 JD、对话历史与用户的最新回答
- **THEN** 裁判返回一个通过 Zod schema 校验的 `JudgeOutput`,其 `robustness` 取值必为 solid / partial / collapsed 三者之一

#### Scenario: 模型输出不符 schema 时不静默放行

- **WHEN** 模型返回的结构不满足 `JudgeOutput` schema
- **THEN** 系统抛出可定位的校验错误,不返回一个字段缺失或类型错误的判断对象

### Requirement: 判断为 solid 时无崩溃点

`collapse_point` SHALL 描述回答崩在哪里;当 `robustness` 为 `solid` 时,`collapse_point` MUST 为 null。

#### Scenario: 扎实回答不编造崩溃点

- **WHEN** 裁判判定某段回答为 `solid`
- **THEN** 该次 `JudgeOutput` 的 `collapse_point` 为 null

#### Scenario: 回答崩了必须指明崩在哪

- **WHEN** 裁判判定某段回答为 `partial` 或 `collapsed`
- **THEN** `collapse_point` 为非空字符串,指明具体是哪个说法站不住

### Requirement: 按需向阅读者追问

裁判 SHALL 注册 `ask_reader(问题)` 工具,可就 `GRILL.md` 未覆盖的细节向全知阅读者提问,拿回自然语言结论。裁判 MUST NOT 注册任何文件读取工具——它物理上够不到源码。MVP 阶段不设提问预算与护栏。追问的用途是**出题弹药**——用于定位用户说法里最脆弱的接缝,而非核对事实真伪。

#### Scenario: 追问后如实记录问了哪些问题

- **WHEN** 裁判在本轮调用了 `ask_reader` 提出一个或多个问题
- **THEN** `did_ask_reader` 为 true,且 `reader_queries` 包含本轮实际提出的全部问题

#### Scenario: 未追问时如实记录

- **WHEN** 裁判本轮未调用 `ask_reader`
- **THEN** `did_ask_reader` 为 false,且 `reader_queries` 为空数组

#### Scenario: 追问失败不中断判断

- **WHEN** 裁判的某次 `ask_reader` 调用失败
- **THEN** 工具返回可读的错误信息给裁判,裁判据此调整并仍产出合法的 `JudgeOutput`,整轮不崩溃

### Requirement: 递给面试官的追问点

`next_probe` SHALL 是裁判递给面试官的下一个追问点;当裁判认为本轮无值得追问的接缝时 MUST 为 null。`next_probe` MUST 只描述追问方向,不得泄露源码内容或文件路径——面试官被物理隔离于源码,不应从追问点里间接获得。

#### Scenario: 找到接缝时递出追问点

- **WHEN** 裁判在回答中定位到一个值得追问的脆弱点
- **THEN** `next_probe` 为非空字符串,描述该追问方向,且不含源码片段或具体文件路径

#### Scenario: 无接缝可追时递出 null

- **WHEN** 裁判认为本轮回答没有值得继续追问的接缝
- **THEN** `next_probe` 为 null

### Requirement: 判断理由仅供复盘

`reasoning` SHALL 记录裁判做出该判断的理由,用于复盘与评估。

#### Scenario: 每次判断都留下理由

- **WHEN** 裁判产出任一 `JudgeOutput`
- **THEN** `reasoning` 为非空字符串,说明判断依据

### Requirement: 面试官视图由类型边界强制

裁判的完整产出 MUST NOT 整体递给面试官。系统 SHALL 提供一个显式的投影函数,把 `JudgeOutput` 收窄为面试官可见的部分,且该部分 MUST 仅包含 `next_probe`。`reasoning`(裁判的完整推理)与 `reader_queries`(裁判向阅读者问过的问题)MUST NOT 出现在面试官可见的数据里——它们是裁判的内部过程,面试官应从 `next_probe` 自然发问,而非窥得裁判的推理与追问轨迹。

这条约束 MUST 由类型/函数边界保证,MUST NOT 依赖调用方"记得只挑 next_probe"。

#### Scenario: 投影后只剩追问点

- **WHEN** 编排层用投影函数处理一个含非空 `reasoning` 与 `reader_queries` 的 `JudgeOutput`
- **THEN** 得到的结果只含 `next_probe` 的内容,不含 `reasoning`、`reader_queries`、`collapse_point` 或 `robustness`

#### Scenario: 完整产出仍可用于存档与复盘

- **WHEN** 编排层需要落盘存档或做复盘评分
- **THEN** 完整的 `JudgeOutput`(含 `reasoning` 与 `reader_queries`)可被直接使用,不受投影函数限制

### Requirement: 裁判 Prompt 只承载判断力

裁判的 Prompt SHALL 只描述判断标准与找接缝的尺度。输出结构 MUST 由 Zod schema 约束而非 Prompt 描述;信息边界 MUST 由工具注册决定而非 Prompt 约定。

#### Scenario: 结构约束不依赖 Prompt 措辞

- **WHEN** 裁判 Prompt 中关于输出格式的描述被移除
- **THEN** `JudgeOutput` 的结构仍由 Zod schema 强制保证,判断结果仍通过校验
