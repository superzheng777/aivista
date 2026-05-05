import {
    SSEConnectionStatus,
    SSEStatusChangeReason,
} from '@/lib/types/sse'

export type ClientErrorSource =
    | 'sse-connect'
    | 'sse-read'
    | 'sse-parse'
    | 'sse-handler'
    | 'sse-business'
    | 'use-sse'
    | 'chat-ui'

export type ClientTelemetryEventName =
    | 'sse_status_change'
    | 'sse_reconnect_scheduled'
    | 'client_error_reported'

export interface ClientErrorReport {
    source: ClientErrorSource
    message: string
    sessionId?: string | null
    status?: SSEConnectionStatus
    eventType?: string
    reason?: SSEStatusChangeReason | string
    retryCount?: number
    timestamp: number
    extra?: Record<string, unknown>
}

export interface ClientTelemetryEvent {
    name: ClientTelemetryEventName
    sessionId?: string | null
    status?: SSEConnectionStatus
    eventType?: string
    reason?: SSEStatusChangeReason | string
    retryCount?: number
    source?: ClientErrorSource
    timestamp: number
    extra?: Record<string, unknown>
}

type ClientErrorSink = (report: ClientErrorReport) => void
type ClientTelemetrySink = (event: ClientTelemetryEvent) => void

const MAX_BUFFER_SIZE = 50
const errorBuffer: ClientErrorReport[] = []
const telemetryBuffer: ClientTelemetryEvent[] = []
const errorSinks = new Set<ClientErrorSink>()
const telemetrySinks = new Set<ClientTelemetrySink>()

function pushWithLimit<T>(buffer: T[], entry: T) {
    buffer.push(entry)
    if (buffer.length > MAX_BUFFER_SIZE) {
        buffer.shift()
    }
}

function normalizeErrorMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message
    }

    if (typeof error === 'string') {
        return error
    }

    try {
        return JSON.stringify(error)
    } catch {
        return 'Unknown client error'
    }
}

export function registerClientErrorSink(sink: ClientErrorSink): () => void {
    errorSinks.add(sink)
    return () => errorSinks.delete(sink)
}

export function registerClientTelemetrySink(
    sink: ClientTelemetrySink
): () => void {
    telemetrySinks.add(sink)
    return () => telemetrySinks.delete(sink)
}

export function getRecentClientErrors(): ClientErrorReport[] {
    return [...errorBuffer]
}

export function getRecentClientTelemetry(): ClientTelemetryEvent[] {
    return [...telemetryBuffer]
}

export function clearClientObservability(): void {
    errorBuffer.length = 0
    telemetryBuffer.length = 0
}

export function recordClientTelemetry(
    event: Omit<ClientTelemetryEvent, 'timestamp'>
): ClientTelemetryEvent {
    const fullEvent: ClientTelemetryEvent = {
        ...event,
        timestamp: Date.now(),
    }

    pushWithLimit(telemetryBuffer, fullEvent)
    console.info('[ClientTelemetry]', fullEvent)
    telemetrySinks.forEach((sink) => sink(fullEvent))

    return fullEvent
}

export function reportClientError(
    report: Omit<ClientErrorReport, 'timestamp'>
): ClientErrorReport {
    const fullReport: ClientErrorReport = {
        ...report,
        message: normalizeErrorMessage(report.message),
        timestamp: Date.now(),
    }

    pushWithLimit(errorBuffer, fullReport)
    console.error('[ClientError]', fullReport)
    errorSinks.forEach((sink) => sink(fullReport))

    recordClientTelemetry({
        name: 'client_error_reported',
        sessionId: fullReport.sessionId,
        status: fullReport.status,
        eventType: fullReport.eventType,
        reason: fullReport.reason,
        retryCount: fullReport.retryCount,
        source: fullReport.source,
        extra: fullReport.extra,
    })

    return fullReport
}
