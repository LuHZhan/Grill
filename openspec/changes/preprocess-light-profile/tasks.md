## 1. 项目脚手架与依赖

- [x] 1.1 初始化 TypeScript 项目结构(预处理脚本所在目录、tsconfig、运行入口)
- [x] 1.2 添加依赖:zod、Vercel AI SDK 及所选 LLM provider
- [x] 1.3 定义 CLI 入口,解析参数:前端仓路径、后端仓路径、链路配置文件路径、输出文件路径

## 2. 轻档案 Schema 定义

- [x] 2.1 用 Zod 定义 `LightProfileSchema`(project_name、repos[name/path/tree/modules]、links)
- [x] 2.2 由 schema 导出 TypeScript 类型,供全流程复用
- [x] 2.3 定义链路配置文件的 Zod schema(links 输入格式)

## 3. 目录树扫描

- [x] 3.1 实现仓库目录树扫描,输出精简树结构
- [x] 3.2 实现忽略清单(node_modules、dist、build、.git、.next、coverage 等),扫描时跳过
- [x] 3.3 校验前端仓、后端仓路径存在,不存在时以非零退出码报错

## 4. 模块职责的 LLM 生成

- [x] 4.1 实现"关键模块"识别启发式(优先 links 引用的文件 + 少量入口文件)
- [x] 4.2 接入 Vercel AI SDK,为每个关键模块生成一句话 role
- [x] 4.3 实现单模块 LLM 失败的降级:置占位 + 告警,不中断整体流程

## 5. 链路配置合并与校验

- [x] 5.1 读取并解析用户手写的链路配置文件
- [x] 5.2 校验每条 link 的前端/后端路径存在于对应仓库,缺失时打印告警
- [x] 5.3 将合法 links 合并进轻档案的 links 字段

## 6. 组装、校验与落盘

- [x] 6.1 组装完整轻档案对象(project_name + repos + links)
- [x] 6.2 用 `LightProfileSchema.parse` 自校验,不通过则报错且不落盘
- [x] 6.3 序列化为 JSON 写入输出文件,并打印落盘路径与文件体积

## 7. 验证

- [ ] 7.1 用一个真实的前端仓 + 后端仓 + 手写链路配置端到端跑通,人工检查轻档案内容
- [ ] 7.2 确认轻档案体积足够小(能整体放进裁判上下文),必要时调整忽略清单或关键模块范围
- [x] 7.3 覆盖异常路径:仓库路径不存在、link 引用缺失、schema 校验失败,确认均给出清晰报错
