# AiVista TypeScript AI Runtime

`backend-ts` 只运行 AI 与异步 I/O Worker，不提供浏览器 API。前端始终调用 Java Core；Java 保留认证、用户、社区、发布状态、通知、搜索、SSE、额度以及核心事务的所有权。

## 当前边界

- Java 使用事务 Outbox、Publisher Confirm 和持久 Quorum Queue 发布生成命令。
- TS Pipeline 连续完成百炼、下载和 OSS，再通过带 `contractVersion` 与确定性 `completionId` 的幂等 HTTP 向 Java 提交一次最终结果。
- TS 通过 `generation_worker_executions` 的条件更新取得执行权；Java 只在 completion 事务中更新任务终态、额度、图片资产与 SSE Outbox。
- `generation_worker_executions` 是 TS 唯一写入的生成执行账本；它避免 Worker 崩溃重投时重复调用百炼。DDL 仍由 Java Flyway 统一维护。
- TS 只消费一个生成命令；旧 Transfer Queue、Worker Result Queue、分段消费者和运行切换开关均已删除。
- 排队超时和资产清理由 Java 保留，因为它们会修改 Java 拥有的业务状态。
- 发布审核属于 Java 发布领域，由 Java 完成审核调用、状态、通知与失败恢复；TS 不参与。
- Agent Runtime 按小步迭代实施。一次 Creation 创建一个短生命周期、`SessionManager.inMemory()` 的 Pi Session 和最多 10 Turn 的 Loop；Generation Session 是 MySQL 中的跨轮逻辑会话。Runtime 在 `before_agent_start` 注入滚动摘要、最近最多 6 轮文本与明确引用的历史图片，不保存 Pi JSONL、Thinking 或逐 Token。Tool 等待复用的 Generation Worker 完成真实图片任务，再把成功或失败 Tool Result 交回 Pi。Java 只经 RabbitMQ 派发命令，TS 连续完成百炼、下载与 OSS 后通过幂等 HTTP 提交 Java；内部 WebSocket只传实时文字、Tool 进度、完成唤醒、取消和心跳。稳定 Skill、NARRATION、Tool Activity 按语义边界幂等落库，`agent_settled` 原子提交剩余 Activity、最终消息和 Creation 终态。一期只建立 `poster-design` Skill 骨架。详见 `../backend/aivista/Agent模式模块.md`。

共享线协议位于 `../contracts/generation-worker/v1`。

单命令 Pipeline 已完成切换：TS 幂等检查点、Java completion 接口、真实文生图和图生图均已验证；旧 Transfer/Result MQ 代码以及 `generation_tasks` 的 Provider 快照、Transfer 时间字段由 Flyway V19 清理。Worker 执行中状态只存在 TS Ledger，不重复写入 Java 业务任务。

## 本地运行

不需要 Docker。先以 `local` Profile 启动 Java，让 Flyway 创建或升级表，再启动对应 TS Worker：

```powershell
$env:AIVISTA_JAVA_LOCAL_YAML = (Resolve-Path '..\backend\aivista\src\main\resources\application-local.yaml').Path
pnpm install
pnpm typecheck
pnpm test
pnpm build
pnpm worker
```

`AIVISTA_JAVA_LOCAL_YAML` 只读取 Java 本地配置（包括内部 Worker Token）；显式 TS 环境变量优先，代码不会复制或输出密钥。
