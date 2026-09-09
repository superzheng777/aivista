import { z } from "zod";

export interface AgentExecuteMessage {
  eventId: bigint;
  creationTaskId: bigint;
  revision: number;
}

const schema = z.object({
  eventId: z.string().regex(/^\d+$/),
  creationTaskId: z.string().regex(/^\d+$/),
  revision: z.number().int().nonnegative(),
}).passthrough();

/** 在 JSON parse 前保留 Java BIGINT 的十进制精度。 */
export function parseAgentExecuteMessage(body: Buffer): AgentExecuteMessage {
  const text = body.toString("utf8")
    .replace(/("(?:eventId|creationTaskId)"\s*:\s*)(\d+)/g, '$1"$2"');
  const value = schema.parse(JSON.parse(text));
  return { eventId: BigInt(value.eventId), creationTaskId: BigInt(value.creationTaskId), revision: value.revision };
}
