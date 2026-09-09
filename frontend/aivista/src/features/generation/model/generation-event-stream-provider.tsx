"use client";

import { type InfiniteData, useQueryClient } from "@tanstack/react-query";
import { createContext, type ReactNode, use, useCallback, useEffect, useRef, useState } from "react";

import { generationQueryKeys } from "@/features/generation/api/generation-api";
import { useAuthStore } from "@/features/auth/model/auth-store";
import {
  applyGenerationTaskUpdateToTurns,
  type GenerationTurnPage,
} from "@/features/generation/model/generation-turn-cache";
import {
  consumeSseStream,
  isTerminalStatus,
  reconnectDelayMs,
  type GenerationSessionIndicator,
  type GenerationStreamStatus,
  type GenerationTaskUpdateEvent,
  applyAgentRealtimeEvent,
  type AgentLiveRun,
  type AgentRealtimeEvent,
} from "@/features/generation/model/generation-event-stream-parsing";

export type { GenerationSessionIndicator } from "@/features/generation/model/generation-event-stream-parsing";

type GenerationEventStreamContextValue = {
  status: GenerationStreamStatus;
  reconnectAttempt: number;
  ensureReady: () => Promise<boolean>;
  retryNow: () => Promise<boolean>;
  /** 当前页面会话内由终态 SSE 事件产生的临时提示。 */
  sessionIndicators: Record<string, GenerationSessionIndicator>;
  hasCompletedResults: boolean;
  hasAttention: boolean;
  /** 每次 SSE 首次连接或重连完成时递增，供生成页重新读取 REST 快照。 */
  syncVersion: number;
  /** 发布相关的刷新信号：收到 publication.updated 时自增。 */
  publicationRefreshVersion: number;
  notificationRefreshVersion: number;
  agentRuns: Record<string, AgentLiveRun>;
  acknowledgeSession: (sessionId: string) => void;
  acknowledgeCompletedResults: () => void;
};

const READY_TIMEOUT_MS = 5_000;
/** 提交路径等待实时连接就绪的上限，避免后端不可用时提交无限挂起。 */
const READY_WAIT_MS = 10_000;
const SYNC_POLL_MS = 25;

const GenerationEventStreamContext = createContext<GenerationEventStreamContextValue | null>(null);

function wait(delay: number, signal: AbortSignal): Promise<void> {
  if (!delay) return Promise.resolve();
  return new Promise((resolve) => {
    const onAbort = () => {
      window.clearTimeout(timeout);
      resolve();
    };
    const timeout = window.setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, delay);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export function GenerationEventStreamProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const authStatus = useAuthStore((state) => state.status);
  const [status, setStatus] = useState<GenerationStreamStatus>("DISCONNECTED");
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const [completedSessionIds, setCompletedSessionIds] = useState<Set<string>>(() => new Set());
  const [attentionSessionIds, setAttentionSessionIds] = useState<Set<string>>(() => new Set());
  const [syncVersion, setSyncVersion] = useState(0);
  const [publicationRefreshVersion, setPublicationRefreshVersion] = useState(0);
  const [notificationRefreshVersion, setNotificationRefreshVersion] = useState(0);
  const [agentRuns, setAgentRuns] = useState<Record<string, AgentLiveRun>>({});
  const readyRef = useRef(false);
  const everReadyRef = useRef(false);
  const lifecycleControllerRef = useRef<AbortController | null>(null);
  const streamControllerRef = useRef<AbortController | null>(null);
  const connectionSequenceRef = useRef(0);
  const batchRef = useRef<Promise<boolean> | null>(null);
  const inFlightRef = useRef(false);
  const startBatchRef = useRef<() => Promise<boolean>>(() => Promise.resolve(false));
  const applyTaskUpdate = useCallback((event: GenerationTaskUpdateEvent) => {
    if (event.status === "SUCCEEDED" || event.status === "PARTIALLY_SUCCEEDED") {
      setCompletedSessionIds((current) => current.has(event.sessionId) ? current : new Set(current).add(event.sessionId));
    }
    if (event.status === "FAILED") {
      setAttentionSessionIds((current) => current.has(event.sessionId) ? current : new Set(current).add(event.sessionId));
    }
    void (async () => {
      await queryClient.cancelQueries({ queryKey: generationQueryKeys.turns(event.sessionId) });
      queryClient.setQueryData<InfiniteData<GenerationTurnPage>>(generationQueryKeys.turns(event.sessionId), (current) =>
        applyGenerationTaskUpdateToTurns(current, event));
      await Promise.all([
        queryClient.refetchQueries({ queryKey: generationQueryKeys.sessions(), type: "active" }),
        queryClient.refetchQueries({ queryKey: generationQueryKeys.turns(event.sessionId), type: "active" }),
      ]);
      if (isTerminalStatus(event.status)) {
        if (event.status === "SUCCEEDED" || event.status === "PARTIALLY_SUCCEEDED") {
          await queryClient.invalidateQueries({ queryKey: ["assets"] });
        }
      }
    })();
  }, [queryClient]);

  const applyPublicationUpdate = useCallback(() => {
    // The SSE event carries no unread count or message body; consumers refresh their own queries.
    setPublicationRefreshVersion((current) => current + 1);
  }, []);
  const applyAgentEvent = useCallback((event: AgentRealtimeEvent) => {
    if (event.eventType === "RUN_FINISHED" || event.eventType === "RUN_FAILED") {
      setAgentRuns((current) => {
        if (!(event.creationTaskId in current)) return current;
        const next = { ...current };
        delete next[event.creationTaskId];
        return next;
      });
      void Promise.all([
        queryClient.refetchQueries({ queryKey: generationQueryKeys.sessions(), type: "active" }),
        queryClient.refetchQueries({ queryKey: generationQueryKeys.turns(event.sessionId), type: "active" }),
      ]);
      return;
    }
    setAgentRuns((current) => {
      const next = applyAgentRealtimeEvent(current[event.creationTaskId], event);
      return next === current[event.creationTaskId] ? current : { ...current, [event.creationTaskId]: next };
    });
  }, [queryClient]);

  const startBatch = useCallback((): Promise<boolean> => {
    if (readyRef.current) return Promise.resolve(true);
    if (batchRef.current) return batchRef.current;

    const lifecycleController = lifecycleControllerRef.current;
    if (!lifecycleController || lifecycleController.signal.aborted) return Promise.resolve(false);

    const batch = (async () => {
      inFlightRef.current = true;
      for (let attempt = 1; ; attempt += 1) {
        await wait(reconnectDelayMs(attempt - 1), lifecycleController.signal);
        if (lifecycleController.signal.aborted || useAuthStore.getState().status !== "authenticated") {
          return false;
        }

        setReconnectAttempt(attempt);
        setStatus(everReadyRef.current ? "RECONNECTING" : "CONNECTING");
        const streamController = new AbortController();
        streamControllerRef.current?.abort();
        streamControllerRef.current = streamController;
        const sequence = ++connectionSequenceRef.current;

        try {
          let token = useAuthStore.getState().accessToken;
          if (!token) token = await useAuthStore.getState().refreshAccessToken();
          let response = await fetch("/api/events", {
            headers: { Authorization: `Bearer ${token}` },
            credentials: "include",
            signal: streamController.signal,
          });
          if (response.status === 401) {
            token = await useAuthStore.getState().refreshAccessToken();
            response = await fetch("/api/events", {
              headers: { Authorization: `Bearer ${token}` },
              credentials: "include",
              signal: streamController.signal,
            });
          }
          if (!response.ok) throw new Error(`Unable to open event stream: ${response.status}`);

          let serverReady = false;
          let connectionAccepted = false;
          const streamDone = consumeSseStream(response, () => { serverReady = true; setAgentRuns({}); },
            applyTaskUpdate, applyPublicationUpdate,
            () => setNotificationRefreshVersion((current) => current + 1), applyAgentEvent)
            .catch(() => undefined)
            .finally(() => {
              if (connectionSequenceRef.current !== sequence || lifecycleController.signal.aborted) return;
              streamController.abort();
              readyRef.current = false;
              if (connectionAccepted) {
                setStatus("RECONNECTING");
                window.setTimeout(() => { void startBatchRef.current(); }, 0);
              }
            });
          const readyDeadline = window.setTimeout(() => streamController.abort(), READY_TIMEOUT_MS);
          while (!serverReady && !streamController.signal.aborted) await wait(SYNC_POLL_MS, streamController.signal);
          window.clearTimeout(readyDeadline);
          if (!serverReady) throw new Error("Event stream did not become ready.");

          if (streamController.signal.aborted || connectionSequenceRef.current !== sequence) {
            throw new Error("Event stream closed before becoming ready.");
          }
          readyRef.current = true;
          everReadyRef.current = true;
          connectionAccepted = true;
          setReconnectAttempt(0);
          setSyncVersion((current) => current + 1);
          setStatus("READY");
          void streamDone;
          return true;
        } catch {
          if (lifecycleController.signal.aborted) return false;
          streamController.abort();
        }
      }
    })().finally(() => {
      if (batchRef.current === batch) batchRef.current = null;
      inFlightRef.current = false;
    });

    batchRef.current = batch;
    return batch;
  }, [applyAgentEvent, applyPublicationUpdate, applyTaskUpdate]);

  const ensureReady = useCallback(async (): Promise<boolean> => {
    if (readyRef.current) return true;
    const batch = startBatch();
    if (!batch) return false;
    let timer = 0;
    const timeout = new Promise<boolean>((resolve) => {
      timer = window.setTimeout(() => resolve(false), READY_WAIT_MS);
    });
    const result = await Promise.race([batch, timeout]);
    window.clearTimeout(timer);
    return result;
  }, [startBatch]);

  const retryNow = useCallback(async (): Promise<boolean> => {
    if (readyRef.current || inFlightRef.current) return batchRef.current ?? Promise.resolve(true);
    setReconnectAttempt(0);
    setStatus("DISCONNECTED");
    return startBatch();
  }, [startBatch]);

  useEffect(() => {
    startBatchRef.current = startBatch;
  }, [startBatch]);

  useEffect(() => {
    if (authStatus !== "authenticated") {
      lifecycleControllerRef.current?.abort();
      streamControllerRef.current?.abort();
      lifecycleControllerRef.current = null;
      readyRef.current = false;
      everReadyRef.current = false;
      queueMicrotask(() => {
        setCompletedSessionIds(new Set());
        setAttentionSessionIds(new Set());
        setAgentRuns({});
      });
      return;
    }

    const lifecycleController = new AbortController();
    lifecycleControllerRef.current = lifecycleController;
    queueMicrotask(() => {
      if (lifecycleController.signal.aborted) return;
      setReconnectAttempt(0);
      setStatus("DISCONNECTED");
    });
    void startBatch();
    return () => {
      lifecycleController.abort();
      streamControllerRef.current?.abort();
      connectionSequenceRef.current += 1;
      readyRef.current = false;
    };
  }, [authStatus, startBatch]);

  const acknowledgeSession = useCallback((sessionId: string) => {
    setCompletedSessionIds((current) => {
      if (!current.has(sessionId)) return current;
      const next = new Set(current);
      next.delete(sessionId);
      return next;
    });
    setAttentionSessionIds((current) => {
      if (!current.has(sessionId)) return current;
      const next = new Set(current);
      next.delete(sessionId);
      return next;
    });
  }, []);

  const acknowledgeCompletedResults = useCallback(() => setCompletedSessionIds(new Set()), []);

  const sessionIndicators: Record<string, GenerationSessionIndicator> = {};
  for (const sessionId of completedSessionIds) sessionIndicators[sessionId] = "COMPLETED";
  for (const sessionId of attentionSessionIds) sessionIndicators[sessionId] = "ATTENTION";

  return (
    <GenerationEventStreamContext value={{ status: authStatus === "authenticated" ? status : "DISCONNECTED",
      reconnectAttempt: authStatus === "authenticated" ? reconnectAttempt : 0,
      ensureReady, retryNow, sessionIndicators, hasCompletedResults: completedSessionIds.size > 0, hasAttention: attentionSessionIds.size > 0,
      syncVersion, publicationRefreshVersion, notificationRefreshVersion, agentRuns,
      acknowledgeSession, acknowledgeCompletedResults }}>
      {children}
    </GenerationEventStreamContext>
  );
}

export function useGenerationEventStream(): GenerationEventStreamContextValue {
  const value = use(GenerationEventStreamContext);
  if (!value) throw new Error("useGenerationEventStream must be used within GenerationEventStreamProvider.");
  return value;
}
