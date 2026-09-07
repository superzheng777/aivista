import { z } from "zod";
import type { ImageTransferMessage } from "./generation-image-transfer-state.service.js";
const schema = z.object({ outboxEventId: z.string().regex(/^\d+$/), taskId: z.string().regex(/^\d+$/),
  taskVersion: z.number().int().nonnegative() }).passthrough();
export function parseImageTransferMessage(body: Buffer): ImageTransferMessage {
  const text = body.toString("utf8").replace(/("(?:outboxEventId|taskId)"\s*:\s*)(\d+)/g, '$1"$2"');
  const value = schema.parse(JSON.parse(text));
  return { outboxEventId: BigInt(value.outboxEventId), taskId: BigInt(value.taskId), taskVersion: value.taskVersion };
}
