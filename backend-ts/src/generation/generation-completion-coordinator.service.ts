import { Injectable } from "@nestjs/common";
import type { GenerationCompletionResponse } from "./generation-completion-client.service.js";

type Waiter = {
  resolve(value: GenerationCompletionResponse): void;
  reject(reason: unknown): void;
  removeAbortListener(): void;
};

/** Single-process bridge from a committed Generation completion back to a waiting Agent Tool. */
@Injectable()
export class GenerationCompletionCoordinatorService {
  private readonly waiters = new Map<string, Set<Waiter>>();
  private readonly earlyResults = new Map<string, GenerationCompletionResponse>();

  wait(taskId: string, signal?: AbortSignal): Promise<GenerationCompletionResponse> {
    const early = this.earlyResults.get(taskId);
    if (early) {
      this.earlyResults.delete(taskId);
      return Promise.resolve(early);
    }
    if (signal?.aborted) return Promise.reject(abortError());
    return new Promise((resolve, reject) => {
      const abort = () => {
        this.remove(taskId, waiter);
        reject(abortError());
      };
      const waiter: Waiter = {
        resolve,
        reject,
        removeAbortListener: () => signal?.removeEventListener("abort", abort),
      };
      const taskWaiters = this.waiters.get(taskId) ?? new Set<Waiter>();
      taskWaiters.add(waiter);
      this.waiters.set(taskId, taskWaiters);
      signal?.addEventListener("abort", abort, { once: true });
    });
  }

  complete(result: GenerationCompletionResponse): void {
    const taskWaiters = this.waiters.get(result.taskId);
    if (!taskWaiters || taskWaiters.size === 0) {
      this.earlyResults.set(result.taskId, result);
      if (this.earlyResults.size > 1_000) {
        const oldest = this.earlyResults.keys().next().value as string | undefined;
        if (oldest) this.earlyResults.delete(oldest);
      }
      return;
    }
    this.waiters.delete(result.taskId);
    for (const waiter of taskWaiters) {
      waiter.removeAbortListener();
      waiter.resolve(result);
    }
  }

  private remove(taskId: string, waiter: Waiter): void {
    waiter.removeAbortListener();
    const taskWaiters = this.waiters.get(taskId);
    taskWaiters?.delete(waiter);
    if (taskWaiters?.size === 0) this.waiters.delete(taskId);
  }
}

function abortError(): DOMException {
  return new DOMException("Agent generation wait was aborted", "AbortError");
}
