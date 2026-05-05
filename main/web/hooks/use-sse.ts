/**
 * useSSE / useAgentChat hooks.
 */

'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { reportClientError } from '@/lib/monitoring/client-observability'
import { createEventHandler, EventHandlerStrategy } from '@/lib/sse/event-handler'
import { createSSEClient, SSEClient } from '@/lib/sse/sse-client'
import {
    EnhancedPromptEventData,
    ErrorEventData,
    GenUIComponentEventData,
    SSEConnectionStatus,
    SSEOptions,
    SSEStatusChangeData,
    ThoughtLogEventData,
} from '@/lib/types/sse'

interface UseSSEOptions extends Partial<SSEOptions> {
    autoConnect?: boolean
    strategy?: EventHandlerStrategy
    onStatusChange?: (payload: SSEStatusChangeData) => void
}

interface UseSSEReturn {
    status: SSEConnectionStatus
    sessionId: string | null
    error: Error | null
    connectionState: SSEStatusChangeData | null
    isConnected: boolean
    connect: () => Promise<void>
    disconnect: () => void
    send: (body: unknown) => void
    destroy: () => void
}

function toError(error: unknown): Error {
    if (error instanceof Error) {
        return error
    }
    return new Error(typeof error === 'string' ? error : 'Unknown SSE error')
}

export function useSSE(options: UseSSEOptions = {}): UseSSEReturn {
    const {
        url = '/api/agent/chat',
        body,
        autoConnect = true,
        strategy,
        onStatusChange,
        maxRetries = 3,
        retryDelay = 1000,
        timeout = 30000,
    } = options

    const [status, setStatus] = useState<SSEConnectionStatus>('idle')
    const [sessionId, setSessionId] = useState<string | null>(null)
    const [error, setError] = useState<Error | null>(null)
    const [connectionState, setConnectionState] =
        useState<SSEStatusChangeData | null>(null)

    const clientRef = useRef<SSEClient | null>(null)
    const unsubscribeRef = useRef<(() => void) | null>(null)

    const handleStatusChange = useCallback(
        (payload: SSEStatusChangeData) => {
            setStatus(payload.status)
            setSessionId(payload.sessionId)
            setConnectionState(payload)
            setError(payload.errorMessage ? new Error(payload.errorMessage) : null)
            onStatusChange?.(payload)
        },
        [onStatusChange]
    )

    const createClientHandler = useCallback(
        (eventStrategy?: EventHandlerStrategy) =>
            createEventHandler({
                ...eventStrategy,
                onStatusChange: (payload) => {
                    handleStatusChange(payload)
                    eventStrategy?.onStatusChange?.(payload)
                },
            }),
        [handleStatusChange]
    )

    useEffect(() => {
        const client = createSSEClient({
            url,
            body,
            maxRetries,
            retryDelay,
            timeout,
        })

        clientRef.current = client
        const handler = createClientHandler(strategy)
        const unsubscribe = client.on('*', handler)
        unsubscribeRef.current = unsubscribe

        if (autoConnect && body) {
            client.connect().catch((error) => {
                const normalizedError = toError(error)
                setError(normalizedError)
                reportClientError({
                    source: 'use-sse',
                    message: normalizedError.message,
                    sessionId: clientRef.current?.sessionId,
                    status: clientRef.current?.status,
                    eventType: 'status-change',
                    extra: {
                        action: 'auto-connect',
                    },
                })
            })
        }

        return () => {
            unsubscribe()
            client.destroy()
        }
    }, [
        autoConnect,
        body,
        createClientHandler,
        maxRetries,
        retryDelay,
        strategy,
        timeout,
        url,
    ])

    const connect = useCallback(async () => {
        if (!clientRef.current) {
            const error = new Error('SSE client not initialized')
            setError(error)
            reportClientError({
                source: 'use-sse',
                message: error.message,
                status,
                eventType: 'status-change',
                extra: {
                    action: 'connect',
                },
            })
            return
        }

        try {
            await clientRef.current.connect()
        } catch (error) {
            const normalizedError = toError(error)
            setError(normalizedError)
            reportClientError({
                source: 'use-sse',
                message: normalizedError.message,
                sessionId: clientRef.current.sessionId,
                status: clientRef.current.status,
                eventType: 'status-change',
                extra: {
                    action: 'connect',
                },
            })
            throw normalizedError
        }
    }, [status])

    const disconnect = useCallback(() => {
        if (!clientRef.current) {
            const error = new Error('SSE client not initialized')
            setError(error)
            reportClientError({
                source: 'use-sse',
                message: error.message,
                status,
                eventType: 'status-change',
                extra: {
                    action: 'disconnect',
                },
            })
            return
        }

        clientRef.current.disconnect()
    }, [status])

    const send = useCallback(
        (messageBody: unknown) => {
            if (unsubscribeRef.current) {
                unsubscribeRef.current()
                unsubscribeRef.current = null
            }

            const client = createSSEClient({
                url,
                body: messageBody,
                maxRetries,
                retryDelay,
                timeout,
            })

            clientRef.current = client
            const handler = createClientHandler(strategy)
            const unsubscribe = client.on('*', handler)
            unsubscribeRef.current = unsubscribe

            client.connect().catch((error) => {
                const normalizedError = toError(error)
                setError(normalizedError)
                reportClientError({
                    source: 'use-sse',
                    message: normalizedError.message,
                    sessionId: client.sessionId,
                    status: client.status,
                    eventType: 'status-change',
                    extra: {
                        action: 'send',
                    },
                })
            })
        },
        [createClientHandler, maxRetries, retryDelay, strategy, timeout, url]
    )

    const destroy = useCallback(() => {
        if (clientRef.current) {
            clientRef.current.destroy()
            clientRef.current = null
        }
    }, [])

    return {
        status,
        sessionId,
        error,
        connectionState,
        isConnected: status === 'connected',
        connect,
        disconnect,
        send,
        destroy,
    }
}

export interface UseAgentChatOptions {
    onChatStart?: () => void
    onThoughtLog?: (data: ThoughtLogEventData) => void
    onEnhancedPrompt?: (data: EnhancedPromptEventData) => void
    onGenUIComponent?: (data: GenUIComponentEventData) => void
    onError?: (data: ErrorEventData) => void
    onChatEnd?: () => void
    onStatusChange?: (payload: SSEStatusChangeData) => void
}

export interface SendMessageOptions {
    maskData?: { base64: string; imageUrl: string }
    previousPrompts?: string[]
}

interface UseAgentChatReturn extends UseSSEReturn {
    sendMessage: (text: string, options?: SendMessageOptions) => void
}

export function useAgentChat(
    options: UseAgentChatOptions = {}
): UseAgentChatReturn {
    const {
        onChatStart,
        onThoughtLog,
        onEnhancedPrompt,
        onGenUIComponent,
        onError,
        onChatEnd,
        onStatusChange,
    } = options

    const callbacksRef = useRef({
        onChatStart,
        onThoughtLog,
        onEnhancedPrompt,
        onGenUIComponent,
        onError,
        onChatEnd,
        onStatusChange,
    })

    useEffect(() => {
        callbacksRef.current = {
            onChatStart,
            onThoughtLog,
            onEnhancedPrompt,
            onGenUIComponent,
            onError,
            onChatEnd,
            onStatusChange,
        }
    }, [
        onChatStart,
        onThoughtLog,
        onEnhancedPrompt,
        onGenUIComponent,
        onError,
        onChatEnd,
        onStatusChange,
    ])

    const strategy = useMemo<EventHandlerStrategy>(
        () => ({
            onThoughtLog: (event) => {
                callbacksRef.current.onThoughtLog?.(
                    event.data as ThoughtLogEventData
                )
            },
            onEnhancedPrompt: (event) => {
                callbacksRef.current.onEnhancedPrompt?.(
                    event.data as EnhancedPromptEventData
                )
            },
            onGenUIComponent: (event) => {
                callbacksRef.current.onGenUIComponent?.(
                    event.data as GenUIComponentEventData
                )
            },
            onError: (event) => {
                callbacksRef.current.onError?.(event.data as ErrorEventData)
            },
            onStreamEnd: () => {
                callbacksRef.current.onChatEnd?.()
            },
        }),
        []
    )

    const sse = useSSE({
        url: 'http://localhost:3000/api/agent/chat',
        autoConnect: false,
        strategy,
        onStatusChange: (payload) => {
            callbacksRef.current.onStatusChange?.(payload)
        },
    })

    const sendMessage = useCallback(
        (text: string, options?: SendMessageOptions) => {
            const body = {
                text,
                ...(options?.maskData && { maskData: options.maskData }),
                ...(options?.previousPrompts &&
                    options.previousPrompts.length > 0 && {
                        previousPrompts: options.previousPrompts,
                    }),
            }

            callbacksRef.current.onChatStart?.()
            sse.send(body)
        },
        [sse]
    )

    return {
        ...sse,
        sendMessage,
    }
}
