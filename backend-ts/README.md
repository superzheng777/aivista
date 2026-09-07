# AiVista TypeScript AI Runtime

`backend-ts` 只运行 AI 与异步 I/O Worker，不提供浏览器 API。前端始终调用 Java Core；Java 保留认证、用户、社区、发布状态、通知、搜索、SSE、额度以及核心事务的所有权。

## 当前边界

- Java 使用事务 Outbox、Publisher Confirm 和持久 Quorum Queue 发布生成与转存命令。
- TS 调用百炼、下载生成图片、写 OSS，并返回带 `contractVersion` 的结果事件。
- Java 幂等消费结果，在自己的事务中更新任务、额度、图片资产与 SSE Outbox。
- `generation_worker_executions` 是 TS 唯一写入的生成执行账本；它避免 Worker 崩溃重投时重复调用百炼。DDL 仍由 Java Flyway 统一维护。
- 生成和转存命令只由 TS 消费；Java 中旧的百炼、OSS 转存消费者及运行切换开关已经删除。
- 排队超时、转存超时和资产清理由 Java 保留，因为它们会修改 Java 拥有的业务状态。
- 发布审核属于 Java 发布领域，由 Java 完成审核调用、状态、通知与失败恢复；TS 不参与。
- Agent Runtime 暂不实现。

共享线协议位于 `../contracts/generation-worker/v1`。

当前迁移已完成：Java、TS 和前端自动化测试与构建通过，并已使用本地服务连接现有 MySQL、RabbitMQ、百炼和 OSS 跑通真实文生图、参考图图生图及测试资产清理。

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

`AIVISTA_JAVA_LOCAL_YAML` 只读取 Java 本地配置；显式 TS 环境变量优先，代码不会复制或输出密钥。
