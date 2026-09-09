import { mapGenerationAssetImage } from "@/entities/generation/model/generation";
import type {
  CursorPage,
  GenerationAsset,
  GenerationAssetImageDto,
  GenerationTurn,
  GenerationSession,
  GenerationTask,
  GenerationTaskStatus,
} from "@/entities/generation/model/generation";
import { browserApiClient } from "@/shared/api/browser-client";
import { type ApiResponse, unwrapApiResponse } from "@/shared/api/api-response";

type GenerationTaskDto = { taskId: string; sessionId: string; status: GenerationTaskStatus; taskVersion: number; retryCount: number; maxRetryCount: number; requestedImageCount: number; completedImageCount: number; failedImageCount: number; failureCode: string | null; failureMessage: string | null; images: GenerationAssetImageDto[]; createdAt: string; completedAt: string | null };
type GenerationSessionDto = { sessionId: string; title: string; lastMessageAt: string; latestTask: { taskId: string; status: GenerationTaskStatus; taskVersion: number } | null; hasActiveTask: boolean };
type UpdatedGenerationSessionDto = { sessionId: string; title: string; createdAt: string; lastMessageAt: string };
type ConversationMessageDto = { messageId: string; sequenceNo: number; role: "USER" | "ASSISTANT"; content: string | null; createdAt: string };
type CreationActivityDto = { activityKey: string; sequenceNo: number; type: "NARRATION" | "SKILL" | "TOOL"; state: "RUNNING" | "COMPLETED" | "FAILED"; content: string; toolName: string | null; generationTaskId: string | null; startedAt: string; completedAt: string | null };
type GenerationTurnDto = { creationTaskId: string; mode: "NORMAL" | "AGENT"; status: "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED"; failureCode: string | null; revision: number; userMessage: ConversationMessageDto; assistantMessage: ConversationMessageDto | null; normalGenerationRequest: { negativePrompt: string | null } | null; generations: GenerationTaskDto[]; activities: CreationActivityDto[] };
type CreatedGenerationTaskDto = Pick<GenerationTaskDto, "taskId" | "sessionId" | "status" | "taskVersion" | "requestedImageCount" | "createdAt">;

export type CreateGenerationTaskInput = { sessionId?: string; prompt: string; inputAssetIds?: string[]; negativePrompt?: string; aspectRatio: string; promptExtend: boolean; imageCount: number };
export type UpdatedGenerationSession = { id: string; title: string; createdAt: string; lastMessageAt: string };

export const generationQueryKeys = {
  all: ["generation"] as const,
  sessions: () => [...generationQueryKeys.all, "sessions"] as const,
  turns: (sessionId: string) => [...generationQueryKeys.all, "session", sessionId, "turns"] as const,
  task: (taskId: string) => [...generationQueryKeys.all, "task", taskId] as const,
};

function toImage(dto: GenerationAssetImageDto): GenerationAsset { return mapGenerationAssetImage(dto); }
function toTask(dto: GenerationTaskDto): GenerationTask {
  return { id: dto.taskId, sessionId: dto.sessionId, status: dto.status, version: dto.taskVersion, retryCount: dto.retryCount, maxRetryCount: dto.maxRetryCount, requestedImageCount: dto.requestedImageCount, completedImageCount: dto.completedImageCount, failedImageCount: dto.failedImageCount, failureCode: dto.failureCode, failureMessage: dto.failureMessage, images: dto.images.map(toImage), createdAt: dto.createdAt, completedAt: dto.completedAt };
}
function toSession(dto: GenerationSessionDto): GenerationSession { return { id: dto.sessionId, title: dto.title, lastMessageAt: dto.lastMessageAt, latestTask: dto.latestTask && { id: dto.latestTask.taskId, status: dto.latestTask.status, version: dto.latestTask.taskVersion }, hasActiveTask: dto.hasActiveTask }; }
function toUpdatedSession(dto: UpdatedGenerationSessionDto): UpdatedGenerationSession { return { id: dto.sessionId, title: dto.title, createdAt: dto.createdAt, lastMessageAt: dto.lastMessageAt }; }

export async function listGenerationSessions(cursor?: string): Promise<CursorPage<GenerationSession>> { const response = await browserApiClient.get<ApiResponse<{ items: GenerationSessionDto[]; nextCursor: string | null }>>("/generation-sessions", { params: { cursor, limit: 20 } }); const data = unwrapApiResponse(response.data); return { items: data.items.map(toSession), nextCursor: data.nextCursor }; }
export async function listGenerationTurns(sessionId: string, before?: string): Promise<{ items: GenerationTurn[]; nextBefore: string | null; hasMore: boolean }> { const response = await browserApiClient.get<ApiResponse<{ items: GenerationTurnDto[]; nextBefore: string | null; hasMore: boolean }>>(`/generation-sessions/${sessionId}/turns`, { params: { before, limit: 5 } }); const data = unwrapApiResponse(response.data); return { items: data.items.map((turn) => ({ id: turn.creationTaskId, mode: turn.mode, status: turn.status, failureCode: turn.failureCode, revision: turn.revision, userMessage: { id: turn.userMessage.messageId, sequenceNo: turn.userMessage.sequenceNo, role: turn.userMessage.role, content: turn.userMessage.content, createdAt: turn.userMessage.createdAt }, assistantMessage: turn.assistantMessage ? { id: turn.assistantMessage.messageId, sequenceNo: turn.assistantMessage.sequenceNo, role: turn.assistantMessage.role, content: turn.assistantMessage.content, createdAt: turn.assistantMessage.createdAt } : null, normalGenerationRequest: turn.normalGenerationRequest, generations: turn.generations.map(toTask), activities: turn.activities })), nextBefore: data.nextBefore, hasMore: data.hasMore }; }
export async function updateGenerationSessionTitle(sessionId: string, title: string): Promise<UpdatedGenerationSession> { const response = await browserApiClient.patch<ApiResponse<UpdatedGenerationSessionDto>>(`/generation-sessions/${sessionId}`, { title }); return toUpdatedSession(unwrapApiResponse(response.data)); }
export async function createGenerationTask(input: CreateGenerationTaskInput, idempotencyKey: string): Promise<Pick<GenerationTask, "id" | "sessionId" | "status" | "version" | "requestedImageCount" | "createdAt">> { const response = await browserApiClient.post<ApiResponse<CreatedGenerationTaskDto>>("/generation-tasks", input, { headers: { "Idempotency-Key": idempotencyKey } }); const data = unwrapApiResponse(response.data); return { id: data.taskId, sessionId: data.sessionId, status: data.status, version: data.taskVersion, requestedImageCount: data.requestedImageCount, createdAt: data.createdAt }; }
export async function getGenerationTask(taskId: string): Promise<GenerationTask> { const response = await browserApiClient.get<ApiResponse<GenerationTaskDto>>(`/generation-tasks/${taskId}`); return toTask(unwrapApiResponse(response.data)); }
