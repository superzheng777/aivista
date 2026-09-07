import { z } from "zod";
import type { TaskExecuteMessage } from "./generation-task-execution-state.service.js";

const schema = z.object({ eventId: z.string().regex(/^\d+$/), taskId: z.string().regex(/^\d+$/),
  taskVersion: z.number().int().nonnegative() }).passthrough();

/** JSON 数字形式的 BIGINT 在解析前转为字符串，避免 JS Number 精度丢失。 */
export function parseTaskExecuteMessage(body: Buffer): TaskExecuteMessage {
  const text = body.toString("utf8").replace(/("(?:eventId|taskId)"\s*:\s*)(\d+)/g, '$1"$2"');
  const value = schema.parse(JSON.parse(text));
  return { eventId: BigInt(value.eventId), taskId: BigInt(value.taskId), taskVersion: value.taskVersion };
}
