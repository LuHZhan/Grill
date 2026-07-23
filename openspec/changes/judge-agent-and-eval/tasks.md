## 1. JudgeOutput Schema(无新依赖,复用 ai@5)

- [x] 1.1 用 Zod 定义 `JudgeOutputSchema`(robustness / collapse_point / did_ask_reader / reader_queries / next_probe / reasoning)并导出类型
- [x] 1.2 在 schema 层加上"solid 时 collapse_point 必须为 null"的约束(refine)
- [x] 1.3 实现投影函数 `toInterviewerProbe(o: JudgeOutput): string | null`,只返回 next_probe;面试官可见数据由此函数产出,不由调用方手挑字段
- [x] 1.4 加 `did_ask_reader` 与 `reader_queries` 是否为空的一致性 refine(设计决策 9;支撑 agent 侧以工具记录覆盖模型自报)

## 2. ask_reader 工具接线

- [x] 2.1 把上游阅读者的 `ask_reader(question): Promise<string>` 封成裁判可调用的 AI SDK 工具(裁判不注册任何文件工具)
- [x] 2.2 `ask_reader` 调用失败时返回可读错误给裁判,不抛出中断整轮
- [x] 2.3 记录本轮向阅读者问过的问题,供 `did_ask_reader` / `reader_queries` 填充
- [x] 2.4 确认路径安全不在裁判侧重做——它由阅读者的 ask_reader/工具保证,裁判够不到文件系统

## 3. 裁判 Agent

- [x] 3.1 用 AI SDK 原生(`generateText` + `tools` + `stopWhen`)定义裁判 agent,注册 `ask_reader` 工具,不引 Mastra
- [x] 3.2 写裁判 Prompt(只写判断标准与抗压尺度,不写输出格式):判"扎实"须落到本项目具体决策+理由、拒通用八股(决策 7);按 JD 岗位级别调尺度(决策 8);节制下钻、不滥用 ask_reader(决策 2)
- [x] 3.3 在 Prompt 中明确 `next_probe` 不得含源码片段或文件路径
- [x] 3.4 实现裁判调用入口:输入 `GRILL.md` + `profile.json` + `JD` + 对话历史 + 最新回答(`JudgeInput` 含 `jd`,决策 8),输出 `JudgeOutput`
- [ ] 3.5 验证「工具循环 + 强制结构化输出」一步法是否可行;不可行则降级为两步法(先 `generateText` + `ask_reader`,再 `generateObject` 抽取)
- [x] 3.6 输出不通过 schema 校验时抛可定位的错误,不静默放行
- [x] 3.7 产出后用 ask_reader 工具实际记录的 queries 覆盖模型自报的 `reader_queries` / `did_ask_reader`,再过 schema 校验(决策 9)

## 4. 标注测试集

- [ ] 4.1 用 Zod 定义测试集格式(id / question / answer / expected[] / note)
- [ ] 4.2 实现测试集加载器,格式非法时非零退出码报错
- [ ] 4.3 交付一份带注释的测试集模板 + 2-3 条示例案例,说明三类回答各该怎么标
- [ ] 4.4 【需用户完成】手写 10-15 条真实案例,覆盖扎实 / 虚 / 有效包装三类

## 5. 回归脚本

- [ ] 5.1 实现回归脚本:逐个把测试集案例喂给裁判,收集其 `robustness`
- [ ] 5.2 比对判断与标注(命中 `expected[]` 任一即算一致),输出命中数 / 总数 / 一致率
- [ ] 5.3 对不一致的案例打印:标识、标注值、裁判判断、裁判 `reasoning`
- [ ] 5.4 单案例调用失败时记录并继续,报告中区分"判断不一致"与"调用失败"

## 6. 验证

- [ ] 6.1 【需用户参与】用真实 `GRILL.md` + `profile.json` + 手写测试集跑一遍回归脚本,读出一致率
- [ ] 6.2 人工抽查若干条 `next_probe`,确认没有泄露源码片段或文件路径
- [ ] 6.3 覆盖异常路径:`ask_reader` 调用失败不中断整轮、测试集格式非法报错
- [ ] 6.4 根据一致率决定是否需要调 Prompt 或换模型;记录基线一致率供后续回归对比
