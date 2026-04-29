# AiVista

AiVista 是一个 Agent 驱动的 AI 图像生成与编辑项目。当前仓库主要包含基于 NestJS + LangGraph 的后端服务，以及基于 Next.js 的 Web 前端，用于完成意图识别、RAG 风格增强、图像任务执行和流式 UI 反馈。

## 当前实现

- 文生图对话式生成流程
- 基于知识库的风格检索与 Prompt 增强
- 基于 SSE 的 Agent 流式事件推送
- GenUI 动态组件渲染
- 局部重绘基础链路

## 技术栈

### 后端

- NestJS
- LangGraph
- LangChain
- LanceDB
- TypeScript

### 前端

- Next.js 14
- React 18
- TypeScript
- Tailwind CSS
- Zustand

## 目录结构

```text
main/
|- server/   # NestJS + LangGraph 后端
|  `- src/
|     |- agent/
|     |- image/
|     |- knowledge/
|     `- llm/
`- web/      # Next.js Web 前端
   |- app/
   |- components/
   |- genui/
   |- hooks/
   `- lib/
```

## 本地启动

### 后端

```bash
cd main/server
pnpm install
cp .env.example .env
pnpm run start:dev
```

默认地址：`http://localhost:3000`

### 前端

```bash
cd main/web
pnpm install
cp .env.example .env.local
pnpm run dev
```

默认地址：`http://localhost:3001`

建议前端环境变量：

```bash
NEXT_PUBLIC_API_URL=http://localhost:3000
```

## 关键流程

后端 Agent 工作流包含四个主要阶段：

1. Planner：识别用户意图
2. RAG：检索风格知识并增强 Prompt
3. Executor：执行图像生成或编辑任务
4. Critic：对结果做质量审查与重试决策

前端通过 SSE 接收 `thought_log`、`enhanced_prompt`、`gen_ui_component`、`stream_end` 等事件，并将它们渲染为流式界面。

## 说明

- 根目录中的复盘类 Markdown 会被 Git 永久忽略，不进入公开仓库
- 运行后端前需要自行配置对应的模型或图像服务 API Key
- 更多设计说明可参考 `docs/` 与 `main/server/docs/`

## License

项目采用 MIT License，见 [LICENSE](LICENSE)。
