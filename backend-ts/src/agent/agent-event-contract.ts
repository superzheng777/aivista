/** Pi SDK observation points consumed by the AiVista adapter. These are not UI event names. */
export type PiObservationPoint =
  | "message_update.text_start"
  | "message_update.text_delta"
  | "message_update.text_end"
  | "tool_execution_start"
  | "tool_execution_update"
  | "tool_execution_end";

/** Events owned by the runtime or Harness rather than emitted directly by Pi. */
export type RuntimeObservationPoint =
  | "runtime.before_prompt"
  | "harness.skill_activated"
  | "runtime.completion_committed"
  | "runtime.failure_committed";

export type AgentObservationPoint = PiObservationPoint | RuntimeObservationPoint;

export type AgentRealtimeEventType =
  | "RUN_STARTED"
  | "TEXT_STARTED"
  | "TEXT_DELTA"
  | "TEXT_FINISHED"
  | "SKILL_SELECTED"
  | "TOOL_STARTED"
  | "TOOL_PROGRESS"
  | "TOOL_FINISHED"
  | "RUN_FINISHED"
  | "RUN_FAILED";

const realtimeEventByObservation = {
  "runtime.before_prompt": "RUN_STARTED",
  "message_update.text_start": "TEXT_STARTED",
  "message_update.text_delta": "TEXT_DELTA",
  "message_update.text_end": "TEXT_FINISHED",
  "harness.skill_activated": "SKILL_SELECTED",
  tool_execution_start: "TOOL_STARTED",
  tool_execution_update: "TOOL_PROGRESS",
  tool_execution_end: "TOOL_FINISHED",
  "runtime.completion_committed": "RUN_FINISHED",
  "runtime.failure_committed": "RUN_FAILED",
} as const satisfies Record<AgentObservationPoint, AgentRealtimeEventType>;

export function realtimeEventTypeFor(point: AgentObservationPoint): AgentRealtimeEventType {
  return realtimeEventByObservation[point];
}
