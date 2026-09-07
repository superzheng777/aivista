import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Environment } from "../config/environment.js";

export type ProviderCallPermit = () => void;

/** 单实例并发与启动速率门控；多实例部署前应替换为共享限流器。 */
@Injectable()
export class GenerationProviderCallGateService {
  private readonly maxConcurrent: number;
  private readonly startIntervalMs: number;
  private active = 0;
  private readonly waiters: Array<() => void> = [];
  private nextStartAt = 0;
  private startQueue: Promise<void> = Promise.resolve();

  constructor(config: ConfigService<Environment, true>) {
    this.maxConcurrent = config.get("AIVISTA_GENERATION_MAX_CONCURRENT_CALLS", { infer: true });
    this.startIntervalMs = 1000 / config.get("AIVISTA_GENERATION_RATE_LIMIT_PER_SECOND", { infer: true });
  }

  async acquire(signal?: AbortSignal): Promise<ProviderCallPermit> {
    await this.acquireConcurrency(signal);
    try {
      await this.reserveStart(signal);
    } catch (error) {
      this.releaseConcurrency();
      throw error;
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.releaseConcurrency();
    };
  }

  private acquireConcurrency(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.reject(abortError());
    if (this.active < this.maxConcurrent) {
      this.active += 1;
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const grant = () => {
        signal?.removeEventListener("abort", abort);
        this.active += 1;
        resolve();
      };
      const abort = () => {
        const index = this.waiters.indexOf(grant);
        if (index >= 0) this.waiters.splice(index, 1);
        reject(abortError());
      };
      signal?.addEventListener("abort", abort, { once: true });
      this.waiters.push(grant);
    });
  }

  private reserveStart(signal?: AbortSignal): Promise<void> {
    const reservation = this.startQueue.then(async () => {
      const waitMs = Math.max(0, this.nextStartAt - performance.now());
      if (waitMs > 0) await abortableDelay(waitMs, signal);
      if (signal?.aborted) throw abortError();
      const now = performance.now();
      this.nextStartAt = Math.max(now, this.nextStartAt) + this.startIntervalMs;
    });
    this.startQueue = reservation.catch(() => undefined);
    return reservation;
  }

  private releaseConcurrency() {
    this.active -= 1;
    this.waiters.shift()?.();
  }
}

function abortableDelay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const timer = setTimeout(done, milliseconds);
    function done() { signal?.removeEventListener("abort", abort); resolve(); }
    function abort() { clearTimeout(timer); reject(abortError()); }
    signal?.addEventListener("abort", abort, { once: true });
  });
}

function abortError() { return new DOMException("Provider call gate wait aborted", "AbortError"); }
