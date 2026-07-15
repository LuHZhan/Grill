## ADDED Requirements

### Requirement: 轻档案生成命令

系统 SHALL 提供一个独立的命令行脚本,接收前端仓路径、后端仓路径,以及一个用户手写的功能链路配置文件路径,生成单个 JSON 轻档案并落盘。

#### Scenario: 提供合法输入时生成轻档案

- **WHEN** 用户以合法的前端仓路径、后端仓路径与链路配置文件运行预处理脚本
- **THEN** 系统扫描两个仓库,生成一份符合 schema 的 JSON 轻档案,并落盘到指定输出路径

#### Scenario: 仓库路径不存在时报错退出

- **WHEN** 传入的前端仓或后端仓路径在文件系统中不存在
- **THEN** 系统以非零退出码终止,并打印指明哪个路径无效的清晰错误信息,不生成任何输出文件

### Requirement: 精简目录树扫描

系统 SHALL 为每个仓库生成精简的目录树,MUST 忽略 `node_modules`、构建产物目录(如 `dist`、`build`)、`.git` 及其他噪声目录,以保证轻档案体积足够小。

#### Scenario: 扫描时忽略噪声目录

- **WHEN** 仓库中包含 `node_modules`、`dist` 或 `.git` 目录
- **THEN** 生成的目录树中不包含这些目录及其内容

### Requirement: 模块职责由 LLM 生成

系统 SHALL 为识别出的关键模块调用 LLM 生成一句话职责描述,写入该模块的 `role` 字段。

#### Scenario: 为模块生成一句话职责

- **WHEN** 扫描识别出一个关键源码模块(如 `src/stream/parser.ts`)
- **THEN** 系统调用 LLM 生成一句话职责,并作为该模块的 `role` 字段值写入轻档案

#### Scenario: LLM 调用失败时降级不中断

- **WHEN** 某个模块的 LLM 职责生成调用失败
- **THEN** 系统将该模块的 `role` 置为空或占位值并记录告警,继续处理其余模块,不使整个流程崩溃

### Requirement: 用户链路配置合并与校验

系统 SHALL 读取用户手写的功能链路配置(前端文件/函数 ↔ 后端接口的对应关系),校验其引用的路径存在于对应仓库中,并将其合并进轻档案的 `links` 字段。

#### Scenario: 合法链路配置合并成功

- **WHEN** 用户提供的链路配置中每条 link 的前端与后端路径都能在对应仓库中找到
- **THEN** 系统将这些 link 原样合并进轻档案的 `links` 数组

#### Scenario: 链路引用不存在的路径时报警

- **WHEN** 某条 link 引用的前端或后端路径在仓库中不存在
- **THEN** 系统打印指明该条 link 与缺失路径的告警信息,以便用户修正配置

### Requirement: 轻档案结构由 Zod schema 约束

系统 SHALL 使用 Zod schema 定义并校验轻档案结构,轻档案 MUST 包含 `project_name`、`repos`(每个含 `name`、`path`、`tree`、`modules`)与 `links` 字段;只有通过 schema 校验的轻档案才允许落盘。

#### Scenario: 结构合法时通过校验并落盘

- **WHEN** 生成的轻档案对象满足 Zod schema 定义的全部字段与类型约束
- **THEN** 系统通过校验并将其序列化为 JSON 写入输出文件

#### Scenario: 结构不合法时拒绝落盘

- **WHEN** 生成的轻档案对象缺少必填字段或字段类型不符
- **THEN** 系统以非零退出码终止并打印 schema 校验错误,不写出损坏的输出文件
