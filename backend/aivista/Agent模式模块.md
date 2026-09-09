# Agent 模式模块

> 状态：核心架构已确认，按小步迭代实施
>
> 范围：一期图像创作 Agent，支持文生图与图生图
>
> 基线：Java Core + TypeScript AI Runtime + Pi-Agent + RabbitMQ + MySQL + OSS
>
> 实施进度：Pi Runtime、正式生成 Tool、Agent 创建与派发、独立 Agent Consumer、OSS 图片装配、最小 Agent Ledger、稳定 Activity 提前投影与最终兜底、首个海报 Skill、Pi 结果幂等提交，以及 Java–TS WebSocket→浏览器 SSE 实时投影均已实现。自动化测试与真实本地端到端联调均已通过；下一步在确认在途图片任务语义后实现用户取消。
>
> 真实 Provider 兼容性：已验证 `qwen3.8-flash` 文本流与单次 `agent_settled`、Tool Result 后续 Turn，以及 256×256 WebP `ImageContent`。2×2 极小测试图会被模型拒绝，不作为生产兼容性结论。

## 1. 核心结论

Java 是浏览器唯一入口和业务事实拥有者；TS 负责 Pi Agent Loop、模型调用、图片下载与 OSS 转存。普通生成与 Agent 模式复用同一个生成领域。首期 Java Core 与 TypeScript AI Runtime 均按单实例运行，不提前引入跨实例协调、分布式租约或共享等待器。

一次 Creation 可以创建零到多个 Generation Task。Skill 规定常规调用顺序和次数；未命中 Skill 时由模型判断。Harness 只限制整个 Loop 的 Turn、时间、权限、并发与额度，不硬编码单个 Tool 的调用次数。

一次 Creation 对应一次 `session.prompt()` 和一个完整 Pi Loop，最多 20 Turn。模型可以零次或多次调用生成 Tool；未调用 Tool 而直接给出非空最终回答也属于正常成功。

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
- WebSocket 是 TS Runtime 与 Java 之间的复用瞬时通道，只承载 TS→Java 的文本增量、Tool 进度和心跳，以及 Java→TS 的用户取消；不承载 Generation 完成结果或可靠业务提交。
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
8. Generation Worker 将 Java Completion 响应交给同进程 `GenerationCompletionCoordinator`，直接唤醒等待中的 Tool；Tool 返回真实 Tool Result 给 Pi。
9. Pi 进入下一 Turn；可以继续调用 Tool，也可以输出最终回答。
10. agent_settled 后 TS 生成最终用户可见投影并幂等 POST Java。
11. Java原子补齐尚未提交的 Activities、写 ASSISTANT Message 和 Creation 终态；TS ACK AGENT_EXECUTE。
```

普通入口中的任务持久化已经抽取为 `GenerationTaskProvisioningService`：它统一负责并发与额度校验、Generation Task、任务输入资产以及执行/状态 Outbox。普通模式仍负责 Session、Creation、消息和请求幂等；后续 Agent 内部入口直接复用 Provisioning Service，不会复制任务创建规则或再创建一层普通 Creation。

浏览器 Agent 入口现已实现为 `POST /agent-creations`。它与普通入口共同复用 `CreationTaskStartService`，在单个 Java 事务中创建或锁定 Session、写 Creation 与 USER Message、保存本轮授权图片，并写入通用 `outbox_events`。Agent 不预建空 ASSISTANT Message；最终回复由 Agent Completion 写入。创建幂等继续复用项目级 `idempotency_records`，不在 `creation_tasks` 重复保存一份请求 ID 或指纹。

`AGENT_EXECUTE` 与 `GENERATION_TASK_EXECUTE` 共用一个 Direct Exchange 和一个 Outbox Dispatcher，但分别绑定独立 Quorum Queue；命令分别使用 `{ eventId, creationTaskId, revision }` 与 `{ eventId, taskId, taskVersion }` 最小契约。最终投递失败时，Agent Creation 收敛为 `AGENT_QUEUE_DELIVERY_FAILED`，不会误用 Generation 的额度返还逻辑。

Agent Tool 通过 `POST /internal/generation-worker/agent-creations/{creationTaskId}/generation-tasks` 创建任务，使用 Worker Token 与 UUID v4 `Idempotency-Key`。Java只接受已存在的 `AGENT` Creation，重新锁定其用户与 Creation，复用统一参数规范化和 Provisioning Service，并以 `creation_task_input_assets` 校验所有图生图资产确实由本轮授权。相同请求重试返回原任务，不重复预占额度或写 Outbox。

TS 对应适配器为 `src/agent/adapters/java-generation-client.ts`。它复用已有 Java Base URL、Worker Token 和请求超时配置，支持 Tool 的 `AbortSignal`，校验成功响应，并把 Java `{ code, message }` 业务错误规范化为 `JavaGenerationApiError`，供 Executor 转换为模型可见 Tool Result；不会把 HTML、代理错误页或内部响应正文泄露给模型。

Agent Worker 启动前通过 `GET /internal/generation-worker/agent-creations/{creationTaskId}/execution` 读取 contractVersion=1 的权威快照。首版最小快照只含 Creation ID/revision/status、Session ID、当前 USER prompt 与按请求顺序排列的授权输入图片；不包含用户凭据、历史会话、Activity 或签名 URL。生成资产返回 `display.webp` 对象键，上传资产返回原始 PNG/JPEG 对象键，TS 从 OSS 受控读取后构造 Pi `ImageContent`。

Agent Worker 与 Generation Worker 已使用独立消费者和并发池，防止所有 Agent 都在等待而无人执行图片任务。Agent Consumer 使用 `prefetch=1` 和独立并发配置；它读取快照、装配 OSS 图片、运行 Pi，并且只在 Agent Completion 被 Java事务确认后 ACK。

Agent Completion 已实现为幂等内部 HTTP：TS 先把确定性完成结果（含稳定 Activity）写入 Agent Ledger，再提交 Java；Java锁定 Creation，在同一事务内幂等写 Activity、最终 Assistant Message、Session 更新时间和 Creation 终态。HTTP 响应未知或 RabbitMQ 重投时，`COMPLETED.result_json` 可重放相同请求。

## 5. Pi Runtime 与 Skill

- SDK 实施基线为 `@earendil-works/pi-coding-agent` 0.83.0。
- Pi 主模型固定为百炼 `qwen3.8-flash`，负责文字与图片理解、Skill/Tool 选择和最终文字回答；`qwen-image-2.0` 只由生成 Pipeline 调用，不是 Agent 主模型。
- 通过共享 `ModelRuntime` 注册百炼 OpenAI-compatible Provider，服务端凭据只来自现有环境配置，不使用用户目录中的 `auth.json`；模型声明必须启用流式、图片输入和 Function Calling 能力。
- 中文系统提示词位于 `backend-ts/.pi/SYSTEM.md`，不硬编码在 Runtime；它覆盖默认 Coding Agent 人设，只声明图像创作助手角色、可用能力、不可伪造生成结果和不可泄露内部信息。是否调用 Tool 由模型的标准 Function Calling 输出决定，不另造规划状态机。
- `DefaultResourceLoader` 使用明确的 `backend-ts` cwd，关闭无关默认资源，只通过显式项目路径从 `backend-ts/.pi/skills` 加载 Skill，并启用受信任内联 Extension。
- active tools 白名单固定为受限 `read`、`text_to_image` 和 `image_to_image`；不启用 bash、edit、write、grep、find、ls。受限 `read` 只能读取规范化后仍位于 `.pi/skills` 根目录内的文件。
- 使用 `SessionManager.inMemory(explicitCwd)`；每个 Creation 在 `try/finally` 中取消订阅并 `await dispose()`，共享的 ModelRuntime 与静态 ResourceLoader 不随 Creation 重建。
- `agent_settled` 是一次 Prompt 在 retry、compaction 和队列处理后真正稳定结束的信号。
- Thinking 不发给浏览器、不写 Activity、不进入业务日志。

一期已加入 `backend-ts/.pi/skills/poster-design/SKILL.md`，不预建 `references` 或其他附属文件。当前正文仅提供可运行的最小海报流程和产品填写位置。`SKILL.md` frontmatter 是唯一元数据源，不维护数据库注册清单或运营后台。Pi 先看到候选 Skill 的 name、description 和 location，命中后调用受限 `read` 读取正文；该 Tool 使用 Pi 官方 Read Tool 定义，但文件操作被限制在规范化后的 `.pi/skills` 根目录内，不能读取 `.env` 或项目源码。未命中 Skill 时使用同一个生成 Tool 集合自行判断。成功读取 Skill 后持久化一条 `SKILL` Activity，不把 `read` 重复展示成普通 Tool。

Skill 是提示词与步骤指导，不是权限来源。Skill 引用的 Tool 必须存在于统一 ToolRegistry；read 只能读取 Skill 根目录内获准文件。

### 5.1 Session 与历史上下文

- `generation_sessions` 表示用户可持续对话的逻辑 Session；`creation_tasks` 表示其中一次用户提问及其完整 Loop。
- TS 每次执行 Creation 时新建 in-memory `AgentSession`，从 Java 安全快照重建所需上下文，`agent_settled` 后立即 `dispose()`；不长期驻留，也不把 Pi JSONL 当业务数据库。
- 上下文只包含：较早历史的滚动摘要、最近最多 6 个 Creation 的用户文本与最终回答，以及必要的生成结果摘要。默认不注入 Activity、Thinking、Trace、原始 Tool 参数或历史图片字节。
- 一期直接读取当前消息之前最近 12 条 `USER/ASSISTANT` 纯文本，并在总计 12,000 Unicode code point 内按原角色预装进本轮 `SessionManager.inMemory`；图片不会隐式进入历史，仍由当前请求的显式 Asset ID 决定。暂不创建摘要字段；只有真实上下文压力证明需要后，才引入异步滚动摘要。
- 历史图片默认只保留 Asset ID、提示词、宽高比和简短摘要。只有当前请求显式引用、前端“继续创作”携带引用、用户明确说“上一张/刚才那张/这张”，或当前 Loop 的 Tool Result 需要时，才读取真实 WebP 并注入多模态内容。
- 被选中的图片由 TS 按 Asset ID鉴权后从 OSS读取 `display.webp`，校验 MIME 与大小，再构造成 Pi `{ type: "image", data, mimeType: "image/webp" }`；Pi 的 OpenAI Provider Adapter 将其转换为 `data:image/webp;base64,...`。最多三张图片，按图片块在前、用户文本在后的顺序组成一次 user content，不持久化 Data URI或 OSS签名 URL。
- 对“上一张”等明确指代，Harness 解析为当前用户最近一次成功生成的 Asset ID；不存在明确指代时，不猜测历史图片，按文本问答或新生成处理。
- 稳定记忆在 `before_agent_start` 中一次性注入系统上下文。`context` Hook 只保留给每次模型调用前确实会变化的信息，避免每 Turn 重复拼接和漂移。

Pi 提供 SessionManager、Compaction 和事件 Hook，但不提供适合本项目业务语义的开箱即用长期记忆。上述 MySQL 快照与上下文构建器是 AiVista 的外部记忆适配层；一期不引入 MongoDB、向量数据库或独立长期记忆表。

### 5.2 Loop 终止语义

- Assistant Message 含 Tool Call：Pi 执行 Tool，将 `AgentToolResult.content` 加回上下文并自动进入下一 Turn；Assistant 同时没有文字也属于正常情况。
- Assistant Message 不含 Tool Call且存在非空文本：该文本就是最终回复，Creation 成功，即使本轮没有生成图片。
- 达到 20 Turn、上下文截断或模型错误：Creation 失败，并记录稳定、可展示的失败码。
- 用户取消或 `AbortSignal`：Creation 取消。
- 没有 Tool 调用且最终文本为空：以 `EMPTY_AGENT_RESPONSE` 失败，不能伪装为成功。

## 6. Tool 与 Harness

一期提供：

- `text_to_image(prompt, negativePrompt?, aspectRatio)`
- `image_to_image(prompt, negativePrompt?, aspectRatio, inputAssetIds)`

`promptExtend=true`、`imageCount=1` 由实现固定。`inputAssetIds` 最多三张且只能引用当前请求授权资产。前端不提供 Agent negativePrompt 输入，模型可按需填写。

Tool 使用 Pi 官方 `defineTool` 和 TypeBox。TypeBox 负责结构校验；`tool_call`/`execute()` 边界中的 Harness 只负责无法交给模型裁量的硬约束：active Tool 白名单、20 Turn预算、字段语义、Asset 授权、取消和截止时间，再由 Java校验用户、额度、并发与幂等。Harness 不判断“应该何时生图”。成功、可纠正参数错误、业务失败和规范化后的基础设施失败都必须形成 Pi 官方形态的 `{ content, details }` Tool Result；`content` 进入下一 Turn供模型判断，`details` 只供 Runtime/UI，不进入模型上下文。正常流程不自造 `terminate` 字段。

Tool 的 `execute()` 通过同进程 `GenerationCompletionCoordinator` 等待 Generation Task 终态。Generation Worker 只有在幂等 Completion HTTP 被 Java事务确认并取得权威响应后才 `resolve(taskId, result)`；结果早于 waiter 时暂存在有界内存 Map，Tool 取得后立即清理。不周期 GET Java，也不通过 WebSocket回传 Generation 完成结果。`AbortSignal` 或截止时间必须释放 waiter 和定时器。

该链路现已实现：`AgentGenerationToolExecutor` 使用 `creationTaskId + Pi toolCallId` 派生稳定 UUID v4 幂等键，创建任务后等待 Coordinator；Generation Pipeline 保存本地可重放 Completion、由 Java 原子提交后，将包含 `failureCode` 与权威 Asset ID 的响应交给 Coordinator。Coordinator支持完成先于 waiter 的竞态、有界早到结果以及 `AbortSignal` 清理；不会轮询 Java或建立第二条完成消息通道。

一个 Loop 最多完成 20 Turn。第 20 个 `turn_end` 完成工具结果后若仍需继续，Harness 调用 Pi 的 `abort()` 中止；第 21 个内部 `turn_start` 不向产品事件投影，也不会发生 Tool 执行或业务副作用。Pi Provider 适配器可能收到一次已取消信号，不将其计为完成的 Turn。每次生成独立校验额度和并发；恢复重投通过稳定幂等键返回原任务，不重复调用百炼或扣额度。

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

实时投影立即经 WebSocket 和 SSE 驱动 UI。`TEXT_DELTA` 按 40 ms 或 128 字符任一先到条件聚合，单帧上限 64 KiB。Java为同一 Creation Run 分配递增 `sequence` 供在线去重，但不为逐 Token 建立第二份重放存储；断线期间的瞬时文字允许丢失，前端重连时清空临时投影并读取 REST 快照，最终 Assistant Message 始终完整持久化。

`AgentEventNormalizer` 的首版纯 TS 实现已完成并通过测试：它消费 Runtime 对 Pi `message_update`、`tool_execution_*` 的直接观察，边界事件前先冲刷文字缓冲，并按 UTF-8 字符边界拆分超大增量。实时 Tool 事件只公开 `toolCallId`、Tool 名称和成功/失败，不泄漏 Prompt、输入图片、Provider 原始结果或内部错误。Normalizer 不持有 Creation、用户、sequence 或网络连接；这些 Envelope 字段由传输层与 Java 分配。

Java 的 `AgentRealtimeProjectionService` 已实现这一所有权边界：只接受白名单事件，重新读取并验证 `AGENT + RUNNING + revision`，从 Java 真相补齐 `userId/sessionId`，为同一 `creationTaskId + revision` 分配稳定 `streamId` 和递增 `sequence`，再发送 `agent.creation.event` SSE。TS 不能指定用户、会话、流或序号，也不能借实时通道改变业务状态。

内部端点固定为 `/internal/agent-runtime`。WebSocket 建立后的首帧必须是 `{type:"HELLO", contractVersion:1, token}`，Java 使用与 Worker HTTP 相同的共享密钥常量时间校验，成功后返回 `READY`；后续只接受 `{type:"EVENT", event}`。非法协议、未认证消息或超过 70 KiB 的帧直接关闭连接。该 Handler 只是传输适配器，事件仍必须经过上述 Projection Service。

TS 使用一个进程级 `JavaAgentRealtimeClient`：从 Java Base URL 推导 `ws/wss` 地址，不把 Token 放进 URL；收到 `READY` 前或断线期间直接丢弃瞬时事件，连接恢复采用 0.5～15 秒指数退避，15 秒发送一次应用层 `PING`。`AgentExecutionService` 将同一份 Runtime 观察同时送入 Activity Collector 与 Event Normalizer，再由该客户端发送；没有第二套 Pi 事件解释逻辑。

浏览器沿用唯一 `/events` SSE，通过 `agent.creation.event` 接收 Envelope。前端以 `creationTaskId` 投影实时 Run，以 `streamId + sequence` 去重和拒绝倒序事件，逐段追加文字并更新 Tool 生命周期；UI 不展示原始参数或结果。每次 SSE 建连/重连时清空瞬时投影并重新读取 REST 快照，防止旧流与已持久化最终结果叠加。

`RUN_FINISHED/RUN_FAILED` 不由 TS 发送。`AgentCompletionService` 的事务成功返回 Controller 后，Java 从已提交的 Creation 重新读取终态，由 Projection Service 沿同一 stream 发出终态事件并释放 stream 状态；浏览器收到后清除临时文字并重新读取该会话快照。纯文字回答与含图片回答因此使用同一收尾路径。

持久投影由同一个 Collector 从 Pi 原生事件生成。Tool 开始、Tool 结束和 Skill 激活等稳定边界通过串行幂等 HTTP 尽早提交；单次失败只降级为最终 Completion 兜底，不中断 Pi Loop。最终 Completion 仍把 Collector 全量快照与最终消息、Creation 终态原子提交，`activity_key` 保证已写步骤不重复。实时增量和进度只走 WebSocket/SSE，不把逐 Token 流复制进数据库。

文字归类采用“先暂存、后定性”：一段完整 Assistant 文本之后若发生 Tool 调用，它是阶段性 `NARRATION`；`agent_settled` 时最后一段非空文本是最终 Assistant Message，不再重复写为 NARRATION。

TS 在 `agent_settled` 后归纳剩余最终投影：

- `NARRATION`：Tool 前后完成的阶段说明。
- `SKILL`：实际激活的 Skill。
- `TOOL`：真正执行且影响结果的 Tool；已纠正的临时参数错误不单独保留，最终不可恢复失败保留安全摘要。
- 最后一条非空 Assistant 文本写入 `conversation_messages`，不重复作为 NARRATION。
- Generation 状态和图片由 `generation_tasks` 与 `image_assets` 表达，Activity 不复制完整参数或结果。

成功、失败和取消都生成最终投影。TS 通过幂等 Completion HTTP 提交尚未写入的 Activity、最终回答和 Creation 终态；Java在同一事务中完成这三项写入。已经按 `activity_key` 持久化的中间 Activity 不重复插入。不持久化 Pi JSONL、逐 Token、Thinking、Provider 原始事件或完整 Tool 参数。

## 9. 数据模型

### generation_sessions

一期不新增记忆或摘要字段。会话继续只保存业务元数据；上下文由已有 `conversation_messages` 按固定窗口读取。未来达到真实 Token 压力时，可增加可空的结构化滚动摘要和水位，但该设计不是当前数据库契约。

### creation_tasks

新增 `status`（`RUNNING/SUCCEEDED/FAILED/CANCELLED`）、`failure_code`、`revision`、`completed_at`。创建请求幂等复用现有 `idempotency_records`，不在 Creation 重复增加 `client_request_id` 或请求指纹；不增加 `agent_status`、`agent_status_changed_at`、`agent_version` 或当前 Runtime phase。普通 Creation 在 Generation Completion 的同一事务内同步终态；Agent Creation 只由 Agent Completion 收尾。

### creation_activities

Flyway `V24__add_creation_activities.sql` 已建立最小字段：`id`、`creation_task_id`、`sequence_no`、`activity_type`、`activity_key`、`state`、`content`、`tool_name`、可空 `generation_task_id`、`started_at`、`completed_at`。

- 类型为 `NARRATION/SKILL/TOOL`，状态为 `RUNNING/COMPLETED/FAILED`；只有长时间执行的 Tool 会先写 `RUNNING`，NARRATION 与 SKILL 直接写 `COMPLETED`。
- `(creation_task_id, sequence_no)` 与 `(creation_task_id, activity_key)` 唯一。
- Activity 在阶段完成时增量落库；最终 Completion 只补齐遗漏项，依靠 `activity_key` 幂等。
- 不保存 user、session、标题、完整参数、原始 Tool Result、Token、SSE Event 或 Trace Span。

### generation_tasks

一个 Creation 可关联多个 Generation Task。数据库迁移 `V21__allow_multiple_generation_tasks_per_creation.sql` 已删除 `UNIQUE(creation_task_id)`，并增加 `(creation_task_id, created_at, id)` 普通索引；普通模式的“一轮一任务”由其应用入口保证，Agent 模式不再受错误的全局基数约束。业务状态只表达 Java 可查询事实，简化为 `QUEUED/SUCCEEDED/PARTIALLY_SUCCEEDED/FAILED`；Provider、下载和转存中的阶段不重复写进 Java 业务表。

普通生成已删除 Provider 临时快照、Transfer 开始时间、独立 Transfer Outbox 和两阶段状态；Provider 与 OSS 检查点只存在于 TS Worker Ledger，Agent Tool 直接复用该单 Pipeline。

### Worker Ledger

Generation Ledger 保存外部调用检查点和可重放结果。Agent Ledger 已由 Flyway `V23__add_agent_worker_ledger.sql` 建立；每个 Creation 只保存 `creation_task_id` 主键、`state(RUNNING/COMPLETED/INTERRUPTED)`、`result_json`、`started_at`、`completed_at` 和 `updated_at`，不增加租约、尝试次数、当前 Turn 或通用步骤明细。

Ledger 不是业务查询来源。单实例 TS 启动时发现遗留 `RUNNING`，或收到消息时发现 Ledger 为 `RUNNING` 但当前进程不存在对应执行，说明上次 Pi Loop 已中断：更新为 `INTERRUPTED` 并把 Creation 收敛为 `AGENT_RUNTIME_INTERRUPTED`，不自动重跑非确定性的完整 Loop。`COMPLETED.result_json` 可重放相同最终 HTTP 提交。Creation 删除时 Ledger 级联删除，终态成功提交后保留 7 天再清理。

## 10. 可靠性与取消

### 内部提交契约

- `POST /internal/generation-worker/agent-creations/{creationTaskId}/activities`：请求包含 `contractVersion`、`creationTaskId`、`revision` 和 Activities；每项包含稳定 `activityKey`、`type`、`state`、安全 `content`、可空 `toolName`、可空 `generationTaskId`、`startedAt`、`completedAt`。`activityKey` 本身已足够提供幂等性，不再增加冗余 `submissionId`。TS 不提交 `sequenceNo`，Java锁定 Creation 后只为首次插入项按顺序分配；同一 key 只允许不存在→RUNNING/COMPLETED、RUNNING→COMPLETED/FAILED，并校验 Generation Task 确属当前 Creation。
- `POST /internal/generation-worker/agent-creations/{creationTaskId}/completion`：请求包含 `contractVersion`、确定性的 `completionId=agent-{creationTaskId}`、`outcome(SUCCEEDED/FAILED/CANCELLED)`、可空 `failureCode`、可空最终消息和稳定 `activities`。Java在同一事务中幂等写 Activity、最终消息并更新 Creation 终态与 revision；已经终态的相同请求返回权威快照，冲突终态拒绝。
- 不新增 Completion 表或 Agent SSE Outbox。Activity 与终态先提交数据库再尽力广播 SSE；广播丢失由 REST 快照恢复。Generation 结果仍走独立 Generation Completion，不混入 Agent Completion。

### 时间边界

| 边界 | 首期值 |
| --- | ---: |
| 单次文本模型调用 | 120 秒 |
| Generation Task | 10 分钟 |
| Tool 等待 | 11 分钟，已接入 Tool `AbortSignal` |
| 完整 Agent Loop | 20 分钟，已接入 Session `abort()` |
| Activity HTTP | 10 秒 |
| Completion HTTP 单次请求 | 15 秒 |
| COMPLETED Agent Ledger 保留 | 7 天 |

以上均为业务截止时间，不是租约。Tool 等待 Generation 时不消耗新的 Turn。

- RabbitMQ 为 at-least-once；消费者只在 Java幂等 Completion 成功后 ACK。
- TS 在外部副作用前保存检查点，结果先写 Ledger 再提交 Java。
- HTTP 结果未知时使用相同幂等键重试。
- 单实例下 RabbitMQ unacked 消息与进程内运行 Map 已足够表达执行所有权；Agent 不建立租约、续租任务或租约扫描器。
- 用户取消由 Java提交 Creation `CANCELLED` 并递增 revision，再经 WebSocket 通知 TS；TS 调用并等待 `session.abort()`，Tool 的 `AbortSignal` 负责释放等待器。WebSocket 重连时 Java补发当前运行 Map 中已取消的 Creation；后续 Activity、Generation 创建和 Agent Completion HTTP 也必须拒绝已取消 Creation。无需为取消增加周期快照轮询，`agent_settled` 负责最终收尾。
- Generation 已派发后不强制假装取消 Provider。Worker 仍可完成图片和资产提交，但已取消的 Agent 不把该图片写入最终回答；孤立资产按既有清理规则处理。
- 模型空闲超时、Generation 截止、Tool 等待截止和 Agent 总硬上限分别配置。Tool 正常等待图片不增加 Turn，也不能被模型空闲超时误杀。

## 11. 分步实施

1. 建立 Pi 原生事件到 AiVista 投影的纯类型边界与测试。
2. 将普通生成改为单命令：TS 连续完成 Provider、下载与 OSS，幂等 HTTP 提交 Java。
3. 删除旧 Transfer Command、结果 MQ、中间 Java状态与快照字段。
4. 增加 Creation、Activity、Agent Ledger DDL、增量 Activity API 和内部 Completion API。已由 V22～V24 及对应 Service 完成；最终 Completion 会原子补齐稳定 Activity。
5. 接入 Pi 0.83.0、in-memory Session、上下文构建器、两个 Tool 和 Harness。
6. 接入内部 WebSocket 与 Java SSE 瞬时投影；不保存或重放逐段文字，断线后以 REST 权威快照对账。已完成。
7. 建立 `poster-design` 内置 Skill 骨架、受限 `read` 与 Skill Activity 投影；已完成，具体创作内容由产品继续完善。
8. 用本地 Java、TS、前端及现有 MySQL、RabbitMQ、百炼、OSS 做端到端回归，不引入 Docker。已验证纯文本 Agent、海报 Skill→正式文生图 Tool→Generation Worker→OSS→最终 Completion，以及 TS→Java WebSocket→浏览器 SSE 全链路。

## 12. 验收

- 普通和 Agent 文生图、图生图复用同一 Generation Worker。
- Provider 到 OSS 中间没有 Java中转或第二条 MQ 命令。
- Tool 等到真实终态后把结果交回 Pi，模型继续下一 Turn。
- Generation 完成由同进程 Coordinator 唤醒 Tool，不依赖轮询或 Java→TS 完成通知。
- Skill、无 Skill、单次和多次生成均可验证。
- 逻辑 Session 会加载当前消息之前最近 12 条、总计不超过 12,000 Unicode code point 的纯文本消息；当前不建立滚动摘要。历史图片只在本次请求显式授权时加载真实内容。
- 在线过程流式显示；刷新后只恢复稳定 Activity、最终消息、任务和图片。
- 会话 REST 快照支持一个 Creation 的零到多个 Generation Task、可空 Assistant Message 和按序 Activity，不再沿用普通模式的一轮一任务假设。
- Thinking、Pi JSONL、Token delta、签名 URL和内部错误不持久化。
- 重投不重复调用百炼、创建资产或扣额度。
- TS 重启后遗留 RUNNING Agent 收敛为中断失败，不自动重跑 Pi Loop。
- Java、TS、前端自动化测试通过；真实本地联调已验证无 Tool 的最终回答、Skill/Tool/图片资产持久化、OSS WebP 可读，以及实时 SSE 事件顺序。
