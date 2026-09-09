package com.superz.aivista.generation.message;

/** Agent 命令只携带权威 Creation 的定位信息；上下文由 TS 通过内部快照读取。 */
public record AgentExecuteMessage(long eventId, long creationTaskId, long revision) {
}
