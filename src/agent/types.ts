import type { PreviewIssue } from "../tools/preview";
import type { PreparedToolCall, PermissionDecision } from "../tools/gateway";

export type AgentState =
  | "idle"
  | "planning"
  | "model_streaming"
  | "awaiting_permission"
  | "running_tool"
  | "observing"
  | "self_check"
  | "completed"
  | "stopped"
  | "error"
  | "awaiting_user";

export type AgentPlanStep = {
  id: string;
  title: string;
  status: "pending" | "in_progress" | "completed";
};

export type AgentUsage = {
  inputTokens: number;
  outputTokens: number;
};

export type TimelineKind =
  | "plan"
  | "model"
  | "tool"
  | "permission"
  | "preview"
  | "error"
  | "complete"
  | "stopped";

export type AgentTimelineItem = {
  id: string;
  kind: TimelineKind;
  title: string;
  detail?: string;
  status: "running" | "success" | "error" | "waiting";
  timestamp: number;
  /** Truncated raw tool output, viewable on demand in the timeline. */
  result?: string;
  /** Structured preview diagnostics, rendered with severity colors. */
  issues?: PreviewIssue[];
};

export type AgentRunnerEvent =
  | { type: "state"; state: AgentState }
  | { type: "plan"; steps: AgentPlanStep[] }
  | { type: "model_started"; step: number }
  | { type: "content_delta"; content: string }
  | { type: "usage"; usage: AgentUsage }
  | { type: "timeline"; item: AgentTimelineItem };

export type PermissionRequester = (
  request: PreparedToolCall,
) => Promise<PermissionDecision>;
