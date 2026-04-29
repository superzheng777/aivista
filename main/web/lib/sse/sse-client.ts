/**
 * SSE 客户端
 * 支持 POST 请求的 Server-Sent Events 客户端实现
 */

import {
    SSEOptions,
    SSEEventHandler,
    SSEEvent,
    SSEConnectionStatus,
} from '@/lib/types/sse'

export class SSEClient {
    // 连接控制
    private controller: AbortController | null = null // 请求取消控制器
    private reader: ReadableStreamDefaultReader<Uint8Array> | null = null // 数据流读取器

    // 重试机制
    private retryCount = 0 // 当前重试次数
    private heartbeatTimer: NodeJS.Timeout | null = null // 心跳定时器
    private isManualClose = false // 是否手动关闭

    // 事件处理器  由于switch判断类型并执行，因此只需要装进<'*',Set<SSEEventHandler>>中即可
    private eventHandlers: Map<string, Set<SSEEventHandler>> = new Map() // 事件处理器映射

    // 配置
    private options: Required<SSEOptions>

    // 状态
    public status: SSEConnectionStatus = 'idle' // 当前连接状态
    public sessionId: string | null = null // 当前会话 ID
    public error: Error | null = null // 连接错误信息

    constructor(options: SSEOptions) {
        this.options = {
            url: options.url,
            body: options.body || {},
            maxRetries: options.maxRetries ?? 3,
            retryDelay: options.retryDelay ?? 1000,
            timeout: options.timeout ?? 30000,
            heartbeatInterval: options.heartbeatInterval ?? 30000,
        }
    }

    /**
     * 连接到 SSE 服务器
     */
    async connect(): Promise<void> {
        if (this.status === 'connecting' || this.status === 'connected') {
            console.warn('[SSE] Already connected or connecting')
            return
        }

        this.isManualClose = false
        this.status = 'connecting'
        this.notifyStatusChange()

        try {
            // 创建新的 AbortController
            this.controller = new AbortController()

            // 设置超时
            const timeoutId = setTimeout(() => {
                this.controller?.abort()
            }, this.options.timeout)

            // 发送 POST 请求
            const response = await fetch(this.options.url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Accept: 'text/event-stream',
                },
                body: JSON.stringify(this.options.body),
                signal: this.controller.signal,
            })

            clearTimeout(timeoutId)

            if (!response.ok) {
                throw new Error(
                    `HTTP ${response.status}: ${response.statusText}`
                )
            }

            if (!response.body) {
                throw new Error('Response body is null')
            }

            // 获取读取器
            this.reader = response.body.getReader()

            // 更新状态
            this.status = 'connected'
            this.notifyStatusChange()

            // 开始读取事件流
            await this.readStream()
        } catch (err: any) {
            // 如果是手动关闭，不重连
            if (this.isManualClose) {
                console.log('[SSE] Connection closed manually')
                return
            }

            // 连接失败
            this.error = err
            this.status = 'error'
            this.notifyStatusChange()

            // 尝试重连
            if (this.retryCount < this.options.maxRetries) {
                this.retryCount++
                const delay =
                    this.options.retryDelay * Math.pow(2, this.retryCount - 1)
                console.log(
                    `[SSE] Connection failed, retrying in ${delay}ms (attempt ${this.retryCount}/${this.options.maxRetries})`
                )

                setTimeout(() => {
                    this.connect()
                }, delay)
            } else {
                console.error('[SSE] Max retries reached, giving up')
            }
        }
    }

    /**
     * 读取事件流
     */
    private async readStream(): Promise<void> {
        if (!this.reader) {
            throw new Error('Reader is not initialized')
        }

        const decoder = new TextDecoder()
        let buffer = ''
        let count = 0
        try {
            while (true) {
                count++
                const { done, value } = await this.reader.read()
                //服务器断连时，done为true
                if (done) {
                    console.log('[SSE] Stream ended')

                    // 流结束时，如果还有未分发的事件，分发它
                    // 后端可能不在最后一个事件后发送空行，但事件数据本身是完整的
                    if (this.currentEvent && this.currentData) {
                        console.log(
                            '[SSE] Dispatching last event before stream end:',
                            this.currentEvent
                        )
                        this.dispatchEvent(this.currentEvent, this.currentData)
                    }

                    // 清空当前状态
                    this.currentEvent = undefined
                    this.currentData = undefined

                    break
                }
                console.log('count =', count)
                console.log('[SSE] Received:', buffer)
                // 解码数据
                buffer += decoder.decode(value, { stream: true })

                console.log('[SSE] Received:', buffer)

                // 按行分割
                const lines = buffer.split(/\r\n|\n|\r/) //注意，若最后一个为\r\n|\n|\r，会多出一个空字符串
                buffer = lines.pop() || '' //拿出lines的最后一个句子（最后一个句子可能不完整）

                for (const line of lines) {
                    if (!line.trim()) continue

                    // 解析 SSE 事件
                    this.parseSSELine(line)
                }
            }
            count = 0
            // 流正常结束
            if (!this.isManualClose) {
                this.status = 'disconnected'
                this.notifyStatusChange()
            }
        } catch (err: any) {
            // 如果是手动关闭，不处理错误
            if (this.isManualClose) {
                console.log('[SSE] Connection closed manually')
                return
            }

            console.error('[SSE] Error reading stream:', err)
            throw err
        }
    }

    /**
     * 解析 SSE 事件行
     */
    private parseSSELine(line: string): void {
        // 格式: event: xxx
        if (line.startsWith('event:')) {
            // 如果遇到新的事件类型，且之前有未分发的事件数据，先分发它
            if (this.currentEvent && this.currentData) {
                this.dispatchEvent(this.currentEvent, this.currentData)
            }
            // 清空当前事件和数据，开始新事件
            this.currentEvent = line.substring(6).trim()
            this.currentData = ''
            return
        }

        // 格式: data: xxx
        if (line.startsWith('data:')) {
            const data = line.substring(5).trim()

            // 累积数据（支持多行 data）
            if (!this.currentData) {
                this.currentData = data
            } else {
                this.currentData += '\n' + data
            }
            return
        }

        // 空行表示事件结束
        if (line.trim() === '') {
            if (this.currentEvent && this.currentData) {
                // 分发事件
                this.dispatchEvent(this.currentEvent, this.currentData)
                // 清空当前事件和数据
                this.currentEvent = undefined
                this.currentData = undefined
            }
        }
    }

    private currentEvent: string | undefined
    private currentData: string | undefined

    /**
     * 分发事件
     */
    private dispatchEvent(eventType: string, data: string): void {
        try {
            // 后端发送的数据已经是完整的事件对象 {type, timestamp, data}
            const parsedData = JSON.parse(data)

            // 检查是否是嵌套的事件对象格式（包含 type, timestamp, data）
            const isNestedFormat =
                parsedData.type && parsedData.data !== undefined

            let event: SSEEvent
            console.log('[SSE] Dispatching event:', eventType, parsedData)
            if (isNestedFormat) {
                // 后端发送的是完整事件对象，直接使用内层数据
                event = {
                    type: eventType as any,
                    timestamp: parsedData.timestamp || Date.now(),
                    data: parsedData.data, // 提取内层的真实业务数据
                }
            } else {
                // 特殊事件（如 connection）直接使用 parsedData  !!!
                event = {
                    type: eventType as any,
                    timestamp: Date.now(),
                    data: parsedData,
                }
            }

            // 触发事件处理器
            this.emit(eventType, event)

            // 处理特殊事件  !!!
            if (eventType === 'connection') {
                this.sessionId = event.data.sessionId
                console.log('[SSE] Connected with session:', this.sessionId)
            }

            // stream_end 事件发出后再更新状态  !!!
            if (eventType === 'stream_end') {
                // 使用 setTimeout 确保事件处理器已经执行
                setTimeout(() => {
                    this.status = 'disconnected'
                    this.notifyStatusChange()
                }, 0)
            }
        } catch (err) {
            console.error('[SSE] Failed to parse event data:', err)
        }
    }

    /**
     * 触发事件处理器 !!! 通配符处理器？
     */
    private emit(eventType: string, event: SSEEvent): void {
        // 执行特定事件类型的处理器  !!!不执行
        const handlers = this.eventHandlers.get(eventType)
        //console.log('[SSE] Executing handlers for event:', eventType, handlers)
        if (handlers) {
            handlers.forEach((handler) => {
                try {
                    handler(event)
                } catch (err) {
                    console.error(
                        `[SSE] Error in event handler for ${eventType}:`,
                        err
                    )
                }
            })
        }

        // 执行通配符处理器 '*'（监听所有事件的处理器）
        const wildcardHandlers = this.eventHandlers.get('*')

        if (wildcardHandlers) {
            wildcardHandlers.forEach((handler, index) => {
                try {
                    handler(event)
                } catch (err) {
                    console.error(
                        `[SSE] Error in wildcard handler for ${eventType}:`,
                        err
                    )
                }
            })
        }
    }

    /**
     * 注册事件处理器
     */
    on(eventType: string, handler: SSEEventHandler): () => void {
        if (!this.eventHandlers.has(eventType)) {
            this.eventHandlers.set(eventType, new Set())
        }
        //非空断言符
        this.eventHandlers.get(eventType)!.add(handler)

        // 返回取消订阅函数
        return () => {
            this.off(eventType, handler)
        }
    }

    /**
     * 取消注册事件处理器
     */
    off(eventType: string, handler: SSEEventHandler): void {
        const handlers = this.eventHandlers.get(eventType)
        if (handlers) {
            handlers.delete(handler)
        }
    }

    /**
     * 通知状态变化
     */
    private notifyStatusChange(): void {
        this.emit('status-change', {
            type: 'status-change',
            timestamp: Date.now(),
            data: {
                status: this.status,
                sessionId: this.sessionId,
                error: this.error,
            },
        })
    }

    /**
     * 断开连接
     */
    disconnect(): void {
        this.isManualClose = true
        this.stopHeartbeat()

        // 取消请求
        if (this.controller) {
            this.controller.abort()
            this.controller = null
        }

        // 取消读取器
        if (this.reader) {
            this.reader.cancel()
            this.reader = null
        }

        // 更新状态
        this.status = 'idle'
        this.sessionId = null
        this.error = null
        this.retryCount = 0
        this.notifyStatusChange()
    }

    /**
     * 启动心跳
     */
    private startHeartbeat(): void {
        this.stopHeartbeat()

        this.heartbeatTimer = setInterval(() => {
            // 检查连接状态
            if (this.status === 'connected') {
                // 发送心跳事件
                this.emit('heartbeat', {
                    type: 'heartbeat',
                    timestamp: Date.now(),
                    data: {
                        timestamp: Date.now(),
                    },
                })
            }
        }, this.options.heartbeatInterval)
    }

    /**
     * 停止心跳  !!!为什么clearInterval后还要将定时器设为null？
     */
    private stopHeartbeat(): void {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer)
            this.heartbeatTimer = null
        }
    }

    /**
     * 清理资源
     */
    destroy(): void {
        this.disconnect()
        this.eventHandlers.clear()
    }
}

/**
 * 创建 SSE 客户端实例
 */
export function createSSEClient(options: SSEOptions): SSEClient {
    return new SSEClient(options)
}
