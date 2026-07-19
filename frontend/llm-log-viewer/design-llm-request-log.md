# 设计说明 —— LLM 请求日志（开发内部工具）

> 实现：`llm-request-log.dc.html`。视觉沿用 `style-guide-grill.md`，但更"开发者向"：mono 密度更高、信息更密。

## 定位
仅开发环境使用的 LLM 调用观测台。观测对象：面试官出题、裁判判定（含 read_file 下钻 + Zod 校验）、预处理模块职责生成（DeepSeek）。

## 概念对应
- **场次（session）** = 一场面试的存档（`sessions/session_NNN_日期.json`），一场 ≈ 17 次调用；`preprocess` 单独一组。
- **左侧列表** = 每次 LLM 请求：角色徽章（面=靛紫 / 判=琥珀 / 预=灰）、标题+轮次、时间、耗时、tokens、⚒ 工具次数、状态（ok/solid 绿、partial 琥珀、✗ schema 红）。
- 选中行：白底 + 左侧 3px 靛紫条。

## 布局
1. 顶栏：GRILL//DEV 品牌字 + 统计（调用数 / 总 tok / 成本 / 失败数 / live 脉冲点）。
2. 过滤行：场次 chips + AGENT chips（全部/面试官/裁判/仅失败）+ 右侧模型参数。
3. 左 400px 请求列表（可点选）+ 右详情。

## 详情区
- 头部：req_id · 轮次 · 角色，判定徽章（PARTIAL 琥珀实底）、`✓ zod 通过` 绿描边徽章、模型+时间戳。
- **耗时分解条**：排队灰 / TTFT 靛紫 / 生成浅靛紫 / 工具段琥珀，下方 mono 指标（总耗时、TTFT、工具次数、in/out tok、成本）。
- **三标签页**：
  - **请求 Request**：POST 端点参数行 → MESSAGES 逐条（SYSTEM 折叠、对话历史折叠、本轮 USER——脆弱短语琥珀 mark）→ 请求体 RAW（黑底 #17161a、键名靛紫）。
  - **响应 Response**：状态行（200 OK 绿 / 耗时 / usage）→ 解析字段三卡（robustness 衬线大字、did_drill、schema）→ ASSISTANT 消息体 JudgeOutput JSON（黑底语法高亮：键靛紫、字符串灰、布尔绿、枚举琥珀）。
  - **工具往返 Trace**：`← tool_call`（琥珀）/ `→ tool_result`（绿）成对展示，含耗时与摘要；底注"路径限制在两仓根内"。

## 交互
标签切换为组件内 state；激活标签 = 墨色文字 + 2px 靛紫下边线。
