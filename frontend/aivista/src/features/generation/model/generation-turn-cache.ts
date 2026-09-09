import type { InfiniteData } from "@tanstack/react-query";

import type { GenerationTurn } from "@/entities/generation/model/generation";
import type { GenerationTaskUpdateEvent } from "@/features/generation/model/generation-event-stream-parsing";

export type GenerationTurnPage = { items: GenerationTurn[]; nextBefore: string | null; hasMore: boolean };

export function mergeGenerationTurnPages(
  current: InfiniteData<GenerationTurnPage> | undefined,
  incoming: InfiniteData<GenerationTurnPage>,
): InfiniteData<GenerationTurnPage> {
  if (!current) return incoming;
  const currentTasks = new Map<string, GenerationTurn["generations"][number]>();
  for (const page of current.pages) for (const turn of page.items) {
    for (const task of turn.generations) currentTasks.set(task.id, task);
  }
  return { ...incoming, pages: incoming.pages.map((page) => ({ ...page, items: page.items.map((turn) => {
    const generations = turn.generations.map((task) => {
      const currentTask = currentTasks.get(task.id);
      return currentTask && currentTask.version > task.version ? currentTask : task;
    });
    return { ...turn, generations };
  }) })) };
}

export function mergeGenerationTurnPageData(oldData: unknown, newData: unknown): unknown {
  return mergeGenerationTurnPages(oldData as InfiniteData<GenerationTurnPage> | undefined, newData as InfiniteData<GenerationTurnPage>);
}

export function applyGenerationTaskUpdateToTurns(
  current: InfiniteData<GenerationTurnPage> | undefined,
  event: GenerationTaskUpdateEvent,
): InfiniteData<GenerationTurnPage> | undefined {
  if (!current) return current;
  return { ...current, pages: current.pages.map((page) => ({ ...page, items: page.items.map((turn) => {
    let changed = false;
    const generations = turn.generations.map((task) => {
      if (task.id !== event.taskId || event.taskVersion <= task.version) return task;
      changed = true;
      return { ...task, status: event.status, version: event.taskVersion,
        retryCount: event.retryCount, maxRetryCount: event.maxRetryCount };
    });
    return changed ? { ...turn, generations } : turn;
  }) })) };
}
