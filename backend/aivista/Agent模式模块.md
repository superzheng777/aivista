# Agent 模式模块

> 状态：核心架构已确认，按小步迭代实施
>
> 范围：一期图像创作 Agent，支持文生图与图生图
>
> 基线：Java Core + TypeScript AI Runtime + Pi-Agent + RabbitMQ + MySQL + OSS

## 1. 核心结论

Java 是浏览器唯一入口和业务事实拥有者；TS 负责 Pi Agent Loop、模型调用、图片下载与 OSS 转存。普通生成与 Agent 模式复用同一个生成领域。

一次 Creation 可以创建零到多个 Generation Task。Skill 规定常规调用顺序和次数；未命中 Skill 时由模型判断。Harness 只限制整个 Loop 的 Turn、时间、权限、并发与额度，不硬编码单个 Tool 的调用次数。

一次 Creation 对应一次 `session.prompt()` 和一个完整 Pi Loop，最多 10 Turn。模型可以零次或多次调用生成 Tool；未调用 Tool 而直接给出非空最终回答也属于正常成功。

Pi 使用 `SessionManager.inMemory()`，每个 Creation 创建一个短生命周期物理 Session，并在稳定结束后释放。MySQL 中的 Generation Session 才是跨轮对话的逻辑 Session 和事实来源；不生成或保存 Pi JSONL，不恢复到某个 Token，也不保存真实思维链。

不采用 LangGraph、MongoDB、Redis Checkpointer、通用工作流、通用 Tool 执行表或多 Agent。

## 2. 服务所有权

| 能力 | Java Core | TypeScript AI Runtime |
| --- | --- | --- |
| 认证、用户、权限、社区、发布 | 唯一负责 | 不负责 |
| 会话、消息、Creation | 唯一写入 | 读取安全快照，提交最终结果 |
| 额度、Generation Task、Image Asset | 唯一写入并原子提交 | 执行外部 I/O，不直接写业务表 |
| 浏览器 REST 与 SSE | 唯一入口 | 不直接暴露 |
| Pi Session、Skill、Tool Loop | 不执行 | 唯一负责 |
| 百炼、下载、OSS | 不执行 | 唯一负责 |
| Worker Ledger | 不写入 | 唯一写入 |

“谁执行外部工作”与“谁原子提交业务事实”不同。TS 完成百炼和 OSS；Java在一个事务中提交任务终态、资产、额度、消息和 Creation，避免两个服务共同写一个业务聚合。发布审核始终属于 Java。

## 3. 跨服务通道

```text
Browser --REST/SSE--> Java
Java --RabbitMQ command--> TS
TS --idempotent HTTP result--> Java
Java <---internal WebSocket---> TS
```

- RabbitMQ 只从 Java 向 TS 派发 `AGENT_EXECUTE` 和 `GENERATION_EXECUTE`。
- TS 通过幂等 HTTP 向 Java提交 Generation 与 Agent 最终结果；Java事务提交成功后返回权威快照，TS 才 ACK 原命令。
- WebSocket 是每个 TS Runtime 实例到 Java 的复用瞬时通道，只承载文本增量、Tool 进度、完成唤醒、取消和心跳。
- 浏览器只连接 Java SSE。实时事件允许丢失，REST 快照负责初始加载、断线恢复和最终对账。

## 4. 完整链路

```text
1. Java 原子创建 Creation(RUNNING)、USER Message 和 AGENT_EXECUTE Outbox。
2. TS Agent Worker 创建 in-memory Pi Session，注入文本、授权图片、Skill 元数据和 Tool 白名单。
3. Pi 理解输入，选择 Skill 或直接规划，调用 text_to_image / image_to_image。
4. Tool 经 TypeBox 与 Harness 校验后，幂等调用 Java 创建 Generation Task。
5. Java 原子写 Generation Task(QUEUED)、预占额度和 GENERATION_EXECUTE Outbox。
6. TS Generation Worker 连续完成百炼、下载和 OSS；中间不回 Java、不再派发 Transfer 命令。
7. TS 保存可重放结果并幂等 POST Java；Java原子提交任务终态、资产和额度。
8. 等待中的 Tool 取得 Java权威结果，返回真实 Tool Result 给 Pi。
9. Pi 进入下一 Turn；可以继续调用 Tool，也可以输出最终回答。
10. agent_settled 后 TS 生成最终用户可见投影并幂等 POST Java。
11. Java原子写 Activities、ASSISTANT Message 和 Creation 终态；TS ACK AGENT_EXECUTE。
```

Agent Worker 与 Generation Worker 必须使用独立消费者和并发池，防止所有 Agent 都在等待而无人执行图片任务。

## 5. Pi Runtime 与 Skill

- SDK 实施基线为 `@earendil-works/pi-coding-agent` 0.83.0。
- 覆盖默认 Coding Agent 系统提示词，禁用 bash、edit、write 等编码工具。
- 只从 `backend-ts/.pi/skills` 加载 Skill，并启用受信任内联 Extension。
- 使用 `SessionManager.inMemory()`；`try/finally` 中取消订阅并 `dispose()`。
- `agent_settled` 是一次 Prompt 在 retry、compaction 和队列处理后真正稳定结束的信号。
- Thinking 不发给浏览器、不写 Activity、不进入业务日志。

一期只建立一个 `poster-design` 骨架，先跑通加载、自动选择、Tool 调用和结果回传，具体创作提示由产品后续填写。`SKILL.md` frontmatter 是唯一元数据源，不维护数据库注册清单或运营后台。Pi 先看到候选 Skill 的 name 与 description，命中后调用受限 read 读取正文；未命中时使用同一个 Tool 集合自行判断。一次 Creation 最多激活一个 Skill，并持久化一条 `SKILL` Activity。

Skill 是提示词与步骤指导，不是权限来源。Skill 引用的 Tool 必须存在于统一 ToolRegistry；read 只能读取 Skill 根目录内获准文件。

### 5.1 Session 与历史上下文

- `generation_sessions` 表示用户可持续对话的逻辑 Session；`creation_tasks` 表示其中一次用户提问及其完整 Loop。
- TS 每次执行 Creation 时新建 in-memory `AgentSession`，从 Java 安全快照重建所需上下文，`agent_settled` 后立即 `dispose()`；不长期驻留，也不把 Pi JSONL 当业务数据库。
- 上下文只包含：较早历史的滚动摘要、最近最多 6 个 Creation 的用户文本与最终回答，以及必要的生成结果摘要。默认不注入 Activity、Thinking、Trace、原始 Tool 参数或历史图片字节。
- `generation_sessions` 预留 `context_summary` 与 `summary_through_creation_id`。一期可以先直接裁剪最近上下文，不为了摘要额外阻塞主链路；超过约 8k～12k Token 预算后异步更新滚动摘要。
- 历史图片默认只保留 Asset ID、提示词、宽高比和简短摘要。只有当前请求显式引用、前端“继续创作”携带引用、用户明确说“上一张/刚才那张/这张”，或当前 Loop 的 Tool Result 需要时，才读取真实 WebP 并注入多模态内容。
- 对“上一张”等明确指代，Harness 解析为当前用户最近一次成功生成的 Asset ID；不存在明确指代时，不猜测历史图片，按文本问答或新生成处理。
- 稳定记忆在 `before_agent_start` 中一次性注入系统上下文。`context` Hook 只保留给每次模型调用前确实会变化的信息，避免每 Turn 重复拼接和漂移。

Pi 提供 SessionManager、Compaction 和事件 Hook，但不提供适合本项目业务语义的开箱即用长期记忆。上述 MySQL 快照与上下文构建器是 AiVista 的外部记忆适配层；一期不引入 MongoDB、向量数据库或独立长期记忆表。

### 5.2 Loop 终止语义

- `stopReason=toolUse`：继续下一 Turn。
- `stopReason=stop` 且存在非空最终文本：Creation 成功，即使本轮没有调用生成 Tool。
- 达到 10 Turn、上下文截断或模型错误：Creation 失败，并记录稳定、可展示的失败码。
- 用户取消或 `AbortSignal`：Creation 取消。
- 没有 Tool 调用且最终文本为空：以 `EMPTY_AGENT_RESPONSE` 失败，不能伪装为成功。

## 6. Tool 与 Harness

一期提供：

- `text_to_image(prompt, negativePrompt?, aspectRatio)`
- `image_to_image(prompt, negativePrompt?, aspectRatio, inputAssetIds)`

`promptExtend=true`、`imageCount=1` 由实现固定。`inputAssetIds` 最多三张且只能引用当前请求授权资产。前端不提供 Agent negativePrompt 输入，模型可按需填写。

Tool 使用 Pi 官方 `defineTool` 和 TypeBox。TypeBox 负责结构校验；`tool_call`/`execute()` 边界中的 Harness 负责 Tool 白名单、Loop 预算、字段语义、Asset 授权，再由 Java校验用户、额度、并发与幂等。成功、可纠正参数错误和业务失败都必须形成 Pi 官方形态的 `{ content, details }` Tool Result 并回到模型；基础设施异常由 Pi 转成错误 Tool Result。正常流程不自造 `terminate` 字段。

Tool 的 `execute()` 等待 Generation Task 进入终态。等待使用当前进程 Promise、WebSocket 低延迟唤醒与 Java快照对账；不依赖单条 WebSocket 保证正确性。`AbortSignal` 必须释放等待器、定时器和监听器。

一个 Loop 最多 10 Turn。每次生成独立校验额度和并发；恢复重投通过稳定幂等键返回原任务，不重复调用百炼或扣额度。

## 7. Pi 原生事件与 AiVista 事件

`RUN_STARTED`、`TEXT_DELTA` 等是 AiVista 产品事件，不是 Pi 原生调用点。唯一允许的映射为：

| AiVista 事件 | 真实来源 |
| --- | --- |
| `RUN_STARTED` | Runtime 调用 `session.prompt()` 前产生；不是 Pi `agent_start` |
| `TEXT_STARTED` | Pi `message_update.text_start` |
| `TEXT_DELTA` | Pi `message_update.text_delta` |
| `TEXT_FINISHED` | Pi `message_update.text_end` |
| `SKILL_SELECTED` | Harness 成功激活 Skill 后产生；Pi 没有同名事件 |
| `TOOL_STARTED` | Pi `tool_execution_start` |
| `TOOL_PROGRESS` | Pi `tool_execution_update` |
| `TOOL_FINISHED` | Pi `tool_execution_end`，必要时结合扩展层 `tool_result` |
| `RUN_FINISHED` | `agent_settled` 后且 Java最终事务提交成功 |
| `RUN_FAILED` | Runtime 确认最终失败且 Java提交失败终态；不是单一 Pi 事件 |

Pi `agent_start/agent_end` 在自动重试时可能出现多次，只用于 Trace，不能直接映射为用户 Run 的开始与结束。`turn_start/turn_end` 用于预算和 Trace，不直接形成 Activity。控制类 `tool_call/tool_result/context/before_agent_start` 走 Extension `pi.on`；只读观测类 message、tool_execution、turn 和 agent_settled 优先走 `session.subscribe`。

各 Pi 点位的职责固定如下：

| Pi 点位 | Harness / 产品职责 | 是否持久化 |
| --- | --- | --- |
| `before_agent_start` | 注入安全约束、Skill 索引和历史上下文，检查开始前取消 | 否 |
| `agent_start/agent_end` | Trace 一次内部 Agent 尝试 | 否 |
| `turn_start/turn_end` | 统计 Turn、预算与停止原因 | 否 |
| `message_update.text_delta` | 生成实时文字增量 | 否 |
| `message_update.text_end` | 完成一段文字并暂存，等待判断是 NARRATION 还是最终回答 | 语义确定后才持久化 |
| `tool_call` | TypeBox 后执行语义、权限、额度与取消前置校验 | 否 |
| `tool_execution_start/end` | 实时显示 Tool 生命周期，并形成稳定 Tool Activity | 是，按语义边界幂等写入 |
| `tool_execution_update` | 实时进度 | 否 |
| `tool_result` | 把成功或失败结果交回模型，供下一 Turn 决策 | 不单独形成 Activity |
| `agent_settled` | 判定最终文本和终态，提交剩余投影并清理 Session | 是，最终事务 |

## 8. 实时投影与最终投影

两种投影必须来自同一个 `AgentEventNormalizer`。

实时投影立即经 WebSocket 和 SSE 驱动 UI。`TEXT_DELTA` 按 40 ms 或 128 字符任一先到条件聚合，单帧上限 64 KiB。Java按 Creation 保存有界内存重放缓冲并分配递增 sequence；缓冲丢失时前端回退到 REST 快照。

持久投影不等待整个 Loop 才首次落库。已完成且语义稳定的 `SKILL`、`NARRATION`、`TOOL` Activity，由 TS 在边界事件发生后通过幂等 HTTP 增量提交；实时增量和进度仍只走 WebSocket/SSE。这样刷新页面可以恢复必要过程，同时不会把逐 Token 流复制进数据库。

文字归类采用“先暂存、后定性”：一段完整 Assistant 文本之后若发生 Tool 调用，它是阶段性 `NARRATION`；`agent_settled` 时最后一段非空文本是最终 Assistant Message，不再重复写为 NARRATION。

TS 在 `agent_settled` 后归纳剩余最终投影：

- `NARRATION`：Tool 前后完成的阶段说明。
- `SKILL`：实际激活的 Skill。
- `TOOL`：真正执行且影响结果的 Tool；已纠正的临时参数错误不单独保留，最终不可恢复失败保留安全摘要。
- 最后一条非空 Assistant 文本写入 `conversation_messages`，不重复作为 NARRATION。
- Generation 状态和图片由 `generation_tasks` 与 `image_assets` 表达，Activity 不复制完整参数或结果。

成功、失败和取消都生成最终投影。TS 通过幂等 Completion HTTP 提交尚未写入的 Activity、最终回答和 Creation 终态；Java在同一事务中完成这三项写入。已经按 `activity_key` 持久化的中间 Activity 不重复插入。不持久化 Pi JSONL、逐 Token、Thinking、Provider 原始事件或完整 Tool 参数。

## 9. 数据模型

### creation_tasks

新增 `status`（`RUNNING/SUCCEEDED/FAILED/CANCELLED`）、`failure_code`、`revision`、`completed_at`。不增加 `agent_status`、`agent_status_changed_at`、`agent_version` 或当前 Runtime phase；用户重试创建新 Creation，技术重试由 Worker Ledger 管理。

### creation_activities

最小字段：`id`、`creation_task_id`、`sequence_no`、`activity_type`、`activity_key`、`state`、`content`、`tool_name`、可空 `generation_task_id`、`started_at`、`completed_at`。

- 类型为 `NARRATION/SKILL/TOOL`，状态为 `RUNNING/COMPLETED/FAILED`；只有长时间执行的 Tool 会先写 `RUNNING`，NARRATION 与 SKILL 直接写 `COMPLETED`。
- `(creation_task_id, sequence_no)` 与 `(creation_task_id, activity_key)` 唯一。
- Activity 在阶段完成时增量落库；最终 Completion 只补齐遗漏项，依靠 `activity_key` 幂等。
- 不保存 user、session、标题、完整参数、原始 Tool Result、Token、SSE Event 或 Trace Span。

### generation_tasks

一个 Creation 可关联多个 Generation Task，删除 `UNIQUE(creation_task_id)` 并保留普通索引。业务状态只表达 Java 可查询事实，简化为 `QUEUED/SUCCEEDED/PARTIALLY_SUCCEEDED/FAILED`；Provider、下载和转存中的阶段不重复写进 Java 业务表。

普通生成已删除 Provider 临时快照、Transfer 开始时间、独立 Transfer Outbox 和两阶段状态；Provider 与 OSS 检查点只存在于 TS Worker Ledger，Agent Tool 直接复用该单 Pipeline。

### Worker Ledger

Generation Ledger 保存外部调用检查点和可重放结果。Agent Ledger 每个 Creation 只保存 `creation_task_id` 主键、`state(READY/RUNNING/COMPLETED)`、`lease_owner`、`lease_expires_at`、`result_json`、`created_at` 和 `updated_at`，不增加尝试次数或通用步骤明细。

Ledger 不是业务查询来源。过期的 `RUNNING` Agent 不自动重跑非确定性的完整 Pi Loop，而是把 Creation 收敛为可识别的中断失败；`COMPLETED` 可重放相同最终 HTTP 提交。Creation 删除时 Ledger 级联删除，终态成功提交后保留 7 天再清理。

## 10. 可靠性与取消

- RabbitMQ 为 at-least-once；消费者只在 Java幂等 Completion 成功后 ACK。
- TS 在外部副作用前保存检查点，结果先写 Ledger 再提交 Java。
- HTTP 结果未知时使用相同幂等键重试。
- 用户取消由 Java提交 Creation `CANCELLED` 并递增 revision，再经 WebSocket 通知持有执行权的 TS；TS 调用并等待 `session.abort()`，Tool 的 `AbortSignal` 负责释放等待器。WebSocket 丢失时，开始前、`tool_call` 前和 Tool 等待期间通过 Java快照发现取消，`agent_settled` 负责最终收尾。
- Generation 已派发后不强制假装取消 Provider。Worker 仍可完成图片和资产提交，但已取消的 Agent 不把该图片写入最终回答；孤立资产按既有清理规则处理。
- 模型空闲超时、Generation 截止、Tool 等待截止和 Agent 总硬上限分别配置。Tool 正常等待图片不增加 Turn，也不能被模型空闲超时误杀。

## 11. 分步实施

1. 建立 Pi 原生事件到 AiVista 投影的纯类型边界与测试。
2. 将普通生成改为单命令：TS 连续完成 Provider、下载与 OSS，幂等 HTTP 提交 Java。
3. 删除旧 Transfer Command、结果 MQ、中间 Java状态与快照字段。
4. 增加 Creation、Activity、Agent Ledger DDL、增量 Activity API 和内部 Completion API。
5. 接入 Pi 0.83.0、in-memory Session、上下文构建器、两个 Tool 和 Harness。
6. 接入内部 WebSocket、Java SSE 投影与有限重放。
7. 建立 `poster-design` 内置 Skill 骨架并跑通自动选择；内容由产品继续完善。
8. 用本地 Java、TS、前端及现有 MySQL、RabbitMQ、百炼、OSS 做端到端回归，不引入 Docker。

## 12. 验收

- 普通和 Agent 文生图、图生图复用同一 Generation Worker。
- Provider 到 OSS 中间没有 Java中转或第二条 MQ 命令。
- Tool 等到真实终态后把结果交回 Pi，模型继续下一 Turn。
- Skill、无 Skill、单次和多次生成均可验证。
- 逻辑 Session 能恢复滚动摘要与最近 6 个 Creation；历史图片只在明确引用时加载真实内容。
- 在线过程流式显示；刷新后只恢复稳定 Activity、最终消息、任务和图片。
- Thinking、Pi JSONL、Token delta、签名 URL和内部错误不持久化。
- 重投不重复调用百炼、创建资产或扣额度。
- Java、TS、前端自动化测试与真实本地联调通过。
