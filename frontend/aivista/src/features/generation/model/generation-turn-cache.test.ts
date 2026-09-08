import { describe, expect, it } from "vitest";

import type { GenerationTurn } from "@/entities/generation/model/generation";
import {
  applyGenerationTaskUpdateToTurns,
  mergeGenerationTurnPages,
} from "@/features/generation/model/generation-turn-cache";

function turn(version: number, status: GenerationTurn["generation"]["status"]): GenerationTurn {
  return {
    id: "creation-task-1", mode: "NORMAL",
    userMessage: { id: "message-1", sequenceNo: 1, role: "USER", content: "test", createdAt: "2026-08-12T00:00:00Z" },
    assistantMessage: { id: "message-2", sequenceNo: 2, role: "ASSISTANT", content: null, createdAt: "2026-08-12T00:00:00Z" },
    normalGenerationRequest: { negativePrompt: null },
    generation: {
      id: "task-1", sessionId: "session-1", version, status, retryCount: 0, maxRetryCount: 3,
      requestedImageCount: 1, completedImageCount: 0, failedImageCount: 0,
      failureCode: null, failureMessage: null, images: [], createdAt: "2026-08-12T00:00:00Z", completedAt: null,
    },
  };
}

const page = (item: GenerationTurn) => ({ pages: [{ items: [item], nextBefore: null, hasMore: false }], pageParams: [undefined] });

describe("generation turn cache", () => {
  it("keeps a newer SSE state when an older REST response arrives", () => {
    const current = applyGenerationTaskUpdateToTurns(page(turn(0, "QUEUED")), {
      sessionId: "session-1", taskId: "task-1", taskVersion: 1, status: "SUCCEEDED", retryCount: 0, maxRetryCount: 3,
    });
    const merged = mergeGenerationTurnPages(current, page(turn(0, "QUEUED")));

    expect(merged.pages[0].items[0].generation).toMatchObject({ version: 1, status: "SUCCEEDED" });
  });

  it("allows same-version REST data to fill in complete fields", () => {
    const current = applyGenerationTaskUpdateToTurns(page(turn(0, "QUEUED")), {
      sessionId: "session-1", taskId: "task-1", taskVersion: 1, status: "SUCCEEDED", retryCount: 0, maxRetryCount: 3,
    });
    const complete = turn(1, "SUCCEEDED");
    complete.generation.completedImageCount = 1;
    complete.generation.images = [{ id: "image-1", sourceIndex: 0, imageUrls: { thumbnail: { url: "https://example.test/image", expiresAt: "2026-08-12T00:10:00Z" }, display: null }, width: 2048, height: 2048, createdAt: "2026-08-12T00:00:00Z", favorited: false, finalPrompt: "test", finalNegativePrompt: null, requestedImageCount: 1, promptExtend: false, publicationReviewStatus: "NONE", publicationVersion: 0, publicAt: null, title: null, description: null, authorId: "user-1", likeCount: 0, likedByCurrentUser: false }];
    const merged = mergeGenerationTurnPages(current, page(complete));

    expect(merged.pages[0].items[0].generation).toMatchObject({ completedImageCount: 1 });
    expect(merged.pages[0].items[0].generation.images).toHaveLength(1);
  });

  it("ignores a replayed SSE event with the same task version", () => {
    const current = applyGenerationTaskUpdateToTurns(page(turn(1, "FAILED")), {
      sessionId: "session-1", taskId: "task-1", taskVersion: 1, status: "SUCCEEDED", retryCount: 0, maxRetryCount: 3,
    });

    expect(current?.pages[0].items[0].generation).toMatchObject({ version: 1, status: "FAILED" });
  });
});
