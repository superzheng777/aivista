/**
 * SSE client with POST support, structured status changes and local observability.
 */

import {
    SSEConnectionStatus,
    SSEEvent,
    SSEEventHandler,
    SSEOptions,
    SSEStatusChangeData,
    SSEStatusChangeReason,
} from '@/lib/types/sse'
import {
    recordClientTelemetry,
    reportClientError,
} from '@/lib/monitoring/client-observability'

export class SSEClient {
    private controller: AbortController | null = null
    private reader: ReadableStreamDefaultReader<Uint8Array> | null = null
    private retryCount = 0
    private heartbeatTimer: NodeJS.Timeout | null = null
    private isManualClose = false
    private eventHandlers: Map<string, Set<SSEEventHandler>> = new Map()
    private options: Required<SSEOptions>
    private currentEvent: string | undefined
    private currentData: string | undefined
    private hasReceivedStreamEnd = false

    public status: SSEConnectionStatus = 'idle'
    public sessionId: string | null = null
    public error: Error | null = null

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

    async connect(): Promise<void> {
        if (this.status === 'connecting' || this.status === 'connected') {
            console.warn('[SSE] Already connected or connecting')
            return
        }

        this.isManualClose = false
        this.hasReceivedStreamEnd = false
        this.error = null
        this.status = 'connecting'
        this.notifyStatusChange('connect-start')

        try {
            this.controller = new AbortController()
            const timeoutId = setTimeout(() => {
                this.controller?.abort()
            }, this.options.timeout)

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
                throw new Error(`HTTP ${response.status}: ${response.statusText}`)
            }

            if (!response.body) {
                throw new Error('Response body is null')
            }

            this.reader = response.body.getReader()
            this.status = 'connected'
            this.error = null
            this.retryCount = 0
            this.notifyStatusChange('connect-success')
            await this.readStream()
        } catch (error) {
            if (this.isManualClose) {
                console.log('[SSE] Connection closed manually')
                return
            }

            const reason = this.resolveConnectionErrorReason(error)
            const normalizedError = this.toError(error)
            this.error = normalizedError
            this.status = 'error'

            reportClientError({
                source: 'sse-connect',
                message: normalizedError.message,
                sessionId: this.sessionId,
                status: this.status,
                eventType: 'status-change',
                reason,
                retryCount: this.retryCount,
                extra: {
                    url: this.options.url,
                },
            })

            this.notifyStatusChange(reason)

            if (this.retryCount < this.options.maxRetries) {
                this.retryCount += 1
                const delay =
                    this.options.retryDelay * Math.pow(2, this.retryCount - 1)

                recordClientTelemetry({
                    name: 'sse_reconnect_scheduled',
                    sessionId: this.sessionId,
                    status: this.status,
                    reason,
                    retryCount: this.retryCount,
                    extra: {
                        delay,
                        url: this.options.url,
                    },
                })

                setTimeout(() => {
                    this.connect()
                }, delay)
            } else {
                this.notifyStatusChange('max-retries-reached')
                console.error('[SSE] Max retries reached, giving up')
            }
        }
    }

    private async readStream(): Promise<void> {
        if (!this.reader) {
            throw new Error('Reader is not initialized')
        }

        const decoder = new TextDecoder()
        let buffer = ''

        try {
            while (true) {
                const { done, value } = await this.reader.read()

                if (done) {
                    if (this.currentEvent && this.currentData) {
                        this.dispatchEvent(this.currentEvent, this.currentData)
                    }

                    this.currentEvent = undefined
                    this.currentData = undefined
                    break
                }

                buffer += decoder.decode(value, { stream: true })
                const lines = buffer.split(/\r\n|\n|\r/)
                buffer = lines.pop() || ''

                for (const line of lines) {
                    this.parseSSELine(line)
                }
            }

            if (
                !this.isManualClose &&
                this.status !== 'error' &&
                !this.hasReceivedStreamEnd
            ) {
                this.error = null
                this.status = 'disconnected'
                this.notifyStatusChange('stream-end')
            }
        } catch (error) {
            if (this.isManualClose) {
                console.log('[SSE] Connection closed manually')
                return
            }

            const normalizedError = this.toError(error)
            reportClientError({
                source: 'sse-read',
                message: normalizedError.message,
                sessionId: this.sessionId,
                status: this.status,
                eventType: this.currentEvent,
                reason: 'stream-error',
                retryCount: this.retryCount,
            })
            throw normalizedError
        }
    }

    private parseSSELine(line: string): void {
        if (line.startsWith('event:')) {
            if (this.currentEvent && this.currentData) {
                this.dispatchEvent(this.currentEvent, this.currentData)
            }
            this.currentEvent = line.substring(6).trim()
            this.currentData = ''
            return
        }

        if (line.startsWith('data:')) {
            const data = line.substring(5).trim()
            this.currentData = this.currentData ? `${this.currentData}
${data}` : data
            return
        }

        if (line.trim() === '' && this.currentEvent && this.currentData) {
            this.dispatchEvent(this.currentEvent, this.currentData)
            this.currentEvent = undefined
            this.currentData = undefined
        }
    }

    private dispatchEvent(eventType: string, data: string): void {
        try {
            const parsedData = JSON.parse(data)
            const isNestedFormat =
                parsedData.type && parsedData.data !== undefined

            const event: SSEEvent = isNestedFormat
                ? {
                      type: eventType as SSEEvent['type'],
                      timestamp: parsedData.timestamp || Date.now(),
                      data: parsedData.data,
                  }
                : {
                      type: eventType as SSEEvent['type'],
                      timestamp: Date.now(),
                      data: parsedData,
                  }

            this.emit(eventType, event)

            if (eventType === 'connection') {
                this.sessionId = event.data.sessionId
            }

            if (eventType === 'stream_end') {
                this.hasReceivedStreamEnd = true
                setTimeout(() => {
                    this.error = null
                    this.status = 'disconnected'
                    this.notifyStatusChange('stream-end')
                }, 0)
            }
        } catch (error) {
            const normalizedError = this.toError(error)
            reportClientError({
                source: 'sse-parse',
                message: normalizedError.message,
                sessionId: this.sessionId,
                status: this.status,
                eventType,
                reason: 'stream-error',
                retryCount: this.retryCount,
                extra: {
                    rawData: data,
                },
            })
        }
    }

    private emit(eventType: string, event: SSEEvent): void {
        const handlers = this.eventHandlers.get(eventType)
        if (handlers) {
            handlers.forEach((handler) => {
                try {
                    handler(event)
                } catch (error) {
                    const normalizedError = this.toError(error)
                    reportClientError({
                        source: 'sse-handler',
                        message: normalizedError.message,
                        sessionId: this.sessionId,
                        status: this.status,
                        eventType,
                        retryCount: this.retryCount,
                        extra: {
                            handlerScope: 'event',
                        },
                    })
                }
            })
        }

        const wildcardHandlers = this.eventHandlers.get('*')
        if (wildcardHandlers) {
            wildcardHandlers.forEach((handler) => {
                try {
                    handler(event)
                } catch (error) {
                    const normalizedError = this.toError(error)
                    reportClientError({
                        source: 'sse-handler',
                        message: normalizedError.message,
                        sessionId: this.sessionId,
                        status: this.status,
                        eventType,
                        retryCount: this.retryCount,
                        extra: {
                            handlerScope: 'wildcard',
                        },
                    })
                }
            })
        }
    }

    on(eventType: string, handler: SSEEventHandler): () => void {
        if (!this.eventHandlers.has(eventType)) {
            this.eventHandlers.set(eventType, new Set())
        }

        this.eventHandlers.get(eventType)!.add(handler)
        return () => {
            this.off(eventType, handler)
        }
    }

    off(eventType: string, handler: SSEEventHandler): void {
        this.eventHandlers.get(eventType)?.delete(handler)
    }

    private notifyStatusChange(reason: SSEStatusChangeReason): void {
        const payload: SSEStatusChangeData = {
            status: this.status,
            sessionId: this.sessionId,
            errorMessage: this.error?.message,
            reason,
            retryCount: this.retryCount,
        }

        recordClientTelemetry({
            name: 'sse_status_change',
            sessionId: payload.sessionId,
            status: payload.status,
            reason: payload.reason,
            retryCount: payload.retryCount,
        })

        this.emit('status-change', {
            type: 'status-change',
            timestamp: Date.now(),
            data: payload,
        })
    }

    disconnect(): void {
        this.isManualClose = true
        this.stopHeartbeat()

        if (this.controller) {
            this.controller.abort()
            this.controller = null
        }

        if (this.reader) {
            this.reader.cancel()
            this.reader = null
        }

        this.status = 'idle'
        this.error = null
        this.retryCount = 0
        this.hasReceivedStreamEnd = false
        this.notifyStatusChange('manual-close')
        this.sessionId = null
    }

    private startHeartbeat(): void {
        this.stopHeartbeat()
        this.heartbeatTimer = setInterval(() => {
            if (this.status === 'connected') {
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

    private stopHeartbeat(): void {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer)
            this.heartbeatTimer = null
        }
    }

    private resolveConnectionErrorReason(error: unknown): SSEStatusChangeReason {
        if (error instanceof DOMException && error.name === 'AbortError') {
            return 'timeout'
        }
        return 'network-error'
    }

    private toError(error: unknown): Error {
        if (error instanceof Error) {
            return error
        }
        return new Error(typeof error === 'string' ? error : 'Unknown SSE error')
    }

    destroy(): void {
        this.disconnect()
        this.eventHandlers.clear()
    }
}

export function createSSEClient(options: SSEOptions): SSEClient {
    return new SSEClient(options)
}
