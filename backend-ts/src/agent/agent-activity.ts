import type { AgentRuntimeEvent } from "./agent-runtime.js";

export interface AgentActivityItem {
  activityKey: string;
  type: "NARRATION" | "SKILL" | "TOOL";
  state: "RUNNING" | "COMPLETED" | "FAILED";
  content: string;
  toolName: string | null;
  generationTaskId: string | null;
  startedAt: string;
  completedAt: string | null;
}

/**
 * Projects Pi events into the small set of stable steps that may be persisted.
 * Text remains pending until a later Tool proves it was narration; final text is never duplicated here.
 */
export class AgentActivityCollector {
  private readonly pendingText: string[] = [];
  private readonly tools = new Map<string, AgentActivityItem>();
  private readonly stable = new Map<string, AgentActivityItem>();
  private narrationSequence = 0;
  private readonly skillCalls = new Map<string, string>();

  constructor(private readonly now: () => Date = () => new Date()) {}

  accept(event: AgentRuntimeEvent): AgentActivityItem[] {
    if (event.type === "text_end") {
      const text = event.text.trim();
      if (text) this.pendingText.push(limitCodePoints(text, 1_000));
      return [];
    }
    if (event.type === "tool_start") {
      const skillName = selectedSkillName(event.toolName, event.args);
      if (skillName) {
        this.skillCalls.set(event.toolCallId, skillName);
        return [];
      }
      const occurredAt = this.now().toISOString();
      const emitted = this.flushNarration(occurredAt);
      const activity: AgentActivityItem = {
        activityKey: `tool:${event.toolCallId}`,
        type: "TOOL",
        state: "RUNNING",
        content: `正在执行${toolLabel(event.toolName)}。`,
        toolName: event.toolName,
        generationTaskId: null,
        startedAt: occurredAt,
        completedAt: null,
      };
      this.tools.set(event.toolCallId, activity);
      return this.record([...emitted, activity]);
    }
    if (event.type === "tool_end") {
      const skillName = this.skillCalls.get(event.toolCallId);
      if (skillName) {
        this.skillCalls.delete(event.toolCallId);
        if (event.isError) return [];
        const occurredAt = this.now().toISOString();
        return this.record([{
          activityKey: `skill:${skillName}`,
          type: "SKILL",
          state: "COMPLETED",
          content: `已启用${skillLabel(skillName)}。`,
          toolName: null,
          generationTaskId: null,
          startedAt: occurredAt,
          completedAt: occurredAt,
        }]);
      }
      const existing = this.tools.get(event.toolCallId);
      if (!existing) return [];
      const details = outcomeDetails(event.result);
      const failed = event.isError || details.outcome === "FAILED";
      const completed: AgentActivityItem = {
        ...existing,
        state: failed ? "FAILED" : "COMPLETED",
        content: failed
          ? `${toolLabel(event.toolName)}未完成。`
          : `${toolLabel(event.toolName)}已完成。`,
        generationTaskId: details.taskId,
        completedAt: this.now().toISOString(),
      };
      this.tools.set(event.toolCallId, completed);
      return this.record([completed]);
    }
    return [];
  }

  /** Final assistant text remains a conversation message, not a duplicate NARRATION activity. */
  discardFinalText(): void {
    this.pendingText.length = 0;
  }

  snapshot(): AgentActivityItem[] {
    return [...this.stable.values()].map((activity) => ({ ...activity }));
  }

  private flushNarration(occurredAt: string): AgentActivityItem[] {
    return this.pendingText.splice(0).map((content) => ({
      activityKey: `narration:${++this.narrationSequence}`,
      type: "NARRATION" as const,
      state: "COMPLETED" as const,
      content,
      toolName: null,
      generationTaskId: null,
      startedAt: occurredAt,
      completedAt: occurredAt,
    }));
  }

  private record(items: AgentActivityItem[]): AgentActivityItem[] {
    for (const item of items) this.stable.set(item.activityKey, item);
    return items;
  }
}

function toolLabel(toolName: string): string {
  if (toolName === "text_to_image") return "文生图";
  if (toolName === "image_to_image") return "图生图";
  return "创作工具";
}

export function selectedSkillName(toolName: string, args: unknown): string | null {
  if (toolName !== "read" || !args || typeof args !== "object" || !("path" in args)
      || typeof args.path !== "string") return null;
  const normalized = args.path.replaceAll("\\", "/");
  const match = normalized.match(/\/skills\/([a-z0-9-]+)\/SKILL\.md$/i);
  return match?.[1]?.toLowerCase() ?? null;
}

function skillLabel(skillName: string): string {
  return skillName === "poster-design" ? "海报设计 Skill" : "创作 Skill";
}

function outcomeDetails(result: unknown): { outcome?: string; taskId: string | null } {
  if (!result || typeof result !== "object" || !("details" in result)) return { taskId: null };
  const details = result.details;
  if (!details || typeof details !== "object") return { taskId: null };
  const outcome = "outcome" in details && typeof details.outcome === "string" ? details.outcome : undefined;
  const taskId = "taskId" in details && typeof details.taskId === "string" && /^\d+$/.test(details.taskId)
    ? details.taskId : null;
  return outcome === undefined ? { taskId } : { outcome, taskId };
}

function limitCodePoints(value: string, limit: number): string {
  return Array.from(value).slice(0, limit).join("");
}
