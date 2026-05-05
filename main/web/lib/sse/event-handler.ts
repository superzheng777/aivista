/**
 * SSE event handler utilities.
 */

import { reportClientError } from '@/lib/monitoring/client-observability'
import { SSEEvent, SSEStatusChangeData } from '@/lib/types/sse'

export interface EventHandlerStrategy {
    onEvent?(event: SSEEvent): void
    onThoughtLog?: (event: SSEEvent) => void
    onEnhancedPrompt?: (event: SSEEvent) => void
    onGenUIComponent?: (event: SSEEvent) => void
    onError?: (event: SSEEvent) => void
    onStreamEnd?: (event: SSEEvent) => void
    onStatusChange?: (payload: SSEStatusChangeData) => void
}

export function createEventHandler(
    strategy: EventHandlerStrategy
): (event: SSEEvent) => void {
    return (event: SSEEvent) => {
        strategy.onEvent?.(event)

        switch (event.type) {
            case 'thought_log':
                strategy.onThoughtLog?.(event)
                break
            case 'enhanced_prompt':
                strategy.onEnhancedPrompt?.(event)
                break
            case 'gen_ui_component':
                strategy.onGenUIComponent?.(event)
                break
            case 'error':
                if (strategy.onError) {
                    strategy.onError(event)
                } else {
                    reportClientError({
                        source: 'sse-business',
                        message:
                            event.data?.message ||
                            'Unhandled SSE error event received',
                        eventType: event.type,
                        extra: {
                            code: event.data?.code,
                            details: event.data?.details,
                            node: event.data?.node,
                        },
                    })
                }
                break
            case 'stream_end':
                strategy.onStreamEnd?.(event)
                break
            case 'status-change':
                strategy.onStatusChange?.(event.data as SSEStatusChangeData)
                break
            default:
                break
        }
    }
}

export function createDefaultEventHandler(): EventHandlerStrategy {
    return {
        onEvent: (event: SSEEvent) => {
            console.log(`[SSE] Event received: ${event.type}`, event)
        },
        onThoughtLog: (event: SSEEvent) => {
            const { node, message } = event.data
            console.log(`[SSE] ${node}: ${message}`)
        },
        onEnhancedPrompt: (event: SSEEvent) => {
            const { original, retrieved, final } = event.data
            console.log('[SSE] Enhanced Prompt:', {
                original,
                retrievedCount: retrieved.length,
                final: final.substring(0, 100) + '...',
            })
        },
        onGenUIComponent: (event: SSEEvent) => {
            const { widgetType } = event.data
            console.log(`[SSE] GenUI Component: ${widgetType}`)
        },
        onError: (event: SSEEvent) => {
            const { code, message, details } = event.data
            console.error(`[SSE] Error [${code}]: ${message}`, details || '')
        },
        onStreamEnd: (event: SSEEvent) => {
            const { summary } = event.data
            console.log(`[SSE] Stream End: ${summary}`)
        },
        onStatusChange: (payload: SSEStatusChangeData) => {
            console.log('[SSE] Status change:', payload)
        },
    }
}

export class EventAggregator {
    private handlers: Set<(event: SSEEvent) => void> = new Set()

    subscribe(handler: (event: SSEEvent) => void): () => void {
        this.handlers.add(handler)
        return () => {
            this.handlers.delete(handler)
        }
    }

    notify(event: SSEEvent): void {
        this.handlers.forEach((handler) => {
            try {
                handler(event)
            } catch (error) {
                reportClientError({
                    source: 'sse-handler',
                    message:
                        error instanceof Error
                            ? error.message
                            : 'Event aggregator handler failed',
                    eventType: event.type,
                    extra: {
                        scope: 'aggregator',
                    },
                })
            }
        })
    }

    clear(): void {
        this.handlers.clear()
    }
}

export function createEventFilter(
    predicate: (event: SSEEvent) => boolean,
    handler: (event: SSEEvent) => void
): (event: SSEEvent) => void {
    return (event: SSEEvent) => {
        if (predicate(event)) {
            handler(event)
        }
    }
}

export function createEventTransformer<T>(
    transformer: (event: SSEEvent) => T | null,
    handler: (transformed: T) => void
): (event: SSEEvent) => void {
    return (event: SSEEvent) => {
        const transformed = transformer(event)
        if (transformed !== null) {
            handler(transformed)
        }
    }
}

export function createEventLogger(prefix = '[SSE]'): EventHandlerStrategy {
    return {
        onEvent: (event: SSEEvent) => {
            console.log(`${prefix} Event:`, event.type, event.data)
        },
    }
}
