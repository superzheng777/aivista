/**
 * SSE 事件类型定义
 * 与后端 Agent 工作流推送的事件对应
 */

/**
 * SSE 事件类型
 */
export type SSEEventType =
    | 'connection' // 连接确认
    | 'thought_log' // 思考日志
    | 'enhanced_prompt' // 增强 Prompt
    | 'gen_ui_component' // GenUI 组件
    | 'progress' // 进度更新
    | 'error' // 错误信息
    | 'stream_end' // 流结束
    | 'heartbeat' // 心跳事件
    | 'status-change' // 状态变化（内部事件）

/**
 * SSE 事件基础接口
 */
export interface SSEEvent {
    type: SSEEventType
    timestamp: number
    data: any //事件数据（具体类型由type决定）
}

/**
 * connection 事件数据
 */
export interface ConnectionEventData {
    status: 'connected' | 'disconnected'
    sessionId: string
}

/**
 * thought_log 事件数据
 */
export interface ThoughtLogEventData {
    node: 'planner' | 'rag' | 'executor' | 'critic' | 'genui' // 事件来源节点
    message: string // 节点生成的消息内容
    progress?: number // 节点执行进度（0-1）
    metadata?: {
        // 节点生成的元数据（可选）
        action?: string // 执行的操作（如：'think'、'execute'）
        confidence?: number // 执行操作的置信度（0-1）
        [key: string]: any
    }
}

/**
 * enhanced_prompt 事件数据
 */
export interface EnhancedPromptEventData {
    original: string // 原始 Prompt 内容
    retrieved: Array<{
        // 检索到的相关 Prompt 内容
        style: string // 检索到的 Prompt 样式（如：'bold'、'italic'）
        prompt: string // 检索到的 Prompt 内容
        similarity: number // 检索到的 Prompt 与原始 Prompt 的相似度
    }>
    final: string // 最终生成的 Prompt 内容
}

/**
 * gen_ui_component 事件数据
 * 使用 GenUI 类型系统，支持所有组件类型
 */
export interface GenUIComponentEventData {
    id?: string // 组件 ID（可选，用于更新现有组件）
    widgetType:
        | 'SmartCanvas' // 智能画布组件
        | 'ImageView' // 图片视图组件
        | 'AgentMessage' // AI消息组件
        | 'ActionPanel' // 操作面板组件
        | 'ThoughtLogItem' // 思考日志项组件
        | 'EnhancedPromptView' // 增强 Prompt 视图组件
    props: Record<string, any>
    updateMode?: 'append' | 'replace' | 'update'
    targetId?: string //目标组件 ID（可选，用于更新特定组件）
}

/**
 * progress 事件数据
 */
export interface ProgressEventData {
    node: string
    progress: number
    message?: string
}

/**
 * error 事件数据
 */
export interface ErrorEventData {
    code: string
    message: string
    details?: string
    node?: string
}

/**
 * stream_end 事件数据
 */
export interface StreamEndEventData {
    sessionId: string
    summary: string
}

/**
 * heartbeat 事件数据
 */
export interface HeartbeatEventData {
    timestamp: number
}

/**
 * 类型守卫函数
 */

export function isConnectionEvent(
    event: SSEEvent
): event is SSEEvent & { data: ConnectionEventData } {
    return event.type === 'connection'
}

export function isThoughtLogEvent(
    event: SSEEvent
): event is SSEEvent & { data: ThoughtLogEventData } {
    return event.type === 'thought_log'
}

export function isEnhancedPromptEvent(
    event: SSEEvent
): event is SSEEvent & { data: EnhancedPromptEventData } {
    return event.type === 'enhanced_prompt'
}

export function isGenUIComponentEvent(
    event: SSEEvent
): event is SSEEvent & { data: GenUIComponentEventData } {
    return event.type === 'gen_ui_component'
}

export function isErrorEvent(
    event: SSEEvent
): event is SSEEvent & { data: ErrorEventData } {
    return event.type === 'error'
}

export function isStreamEndEvent(
    event: SSEEvent
): event is SSEEvent & { data: StreamEndEventData } {
    return event.type === 'stream_end'
}

/**
 * thought_log 事件的完整事件类型
 */
export interface ThoughtLogEvent extends SSEEvent {
    type: 'thought_log'
    data: ThoughtLogEventData
}

/**
 * enhanced_prompt 事件的完整事件类型
 */
export interface EnhancedPromptEvent extends SSEEvent {
    type: 'enhanced_prompt'
    data: EnhancedPromptEventData
}

/**
 * gen_ui_component 事件的完整事件类型
 */
export interface GenUIComponentEvent extends SSEEvent {
    type: 'gen_ui_component'
    data: GenUIComponentEventData
}

/**
 * SSE 连接状态
 */
export type SSEConnectionStatus =
    | 'idle' // 未连接
    | 'connecting' // 连接中
    | 'connected' // 已连接
    | 'disconnected' // 已断开
    | 'error' // 错误

/**
 * SSE 配置选项
 */
export interface SSEOptions {
    /**
     * 连接 URL
     */
    url: string

    /**
     * 请求体（用于 POST 请求）
     */
    body?: any

    /**
     * 最大重连次数
     * @default 3
     */
    maxRetries?: number

    /**
     * 重连延迟基数（毫秒）
     * @default 1000
     */
    retryDelay?: number

    /**
     * 连接超时时间（毫秒）
     * @default 30000
     */
    timeout?: number

    /**
     * 心跳间隔（毫秒）
     * @default 30000
     */
    heartbeatInterval?: number
}

/**
 * SSE 事件处理器
 */
export type SSEEventHandler = (event: SSEEvent) => void

/**
 * SSE 状态
 */
export interface SSEState {
    status: SSEConnectionStatus
    sessionId: string | null
    error: Error | null
    lastEvent: SSEEvent | null
}
