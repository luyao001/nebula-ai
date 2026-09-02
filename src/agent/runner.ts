import type { ChatProvider, NormalizedToolCall, ProviderMessage } from "../providers";
import { AGENT_TOOLS } from "../tools/catalog";
import {
  executeGatewayToolCall,
  prepareGatewayToolCall,
  resolveGatewayPermission,
} from "../tools/gateway";
import type { PreviewReport } from "../tools/preview";
import { compactAgentContext } from "./context";
import type { AgentPlanStep, AgentRunnerEvent, AgentTimelineItem, AgentUsage, PermissionRequester } from "./types";

const MAX_STEPS = 20;
const MAX_PARSE_FAILURES = 2;
const MAX_PREVIEW_ROUNDS = 3;
const MAX_TOOL_CALLS_PER_TURN = 4;
const MAX_RESULT_CHARS = 4000;

type RunAgentOptions = {
  provider: ChatProvider;
  model: string;
  apiKey?: string;
  systemPrompt: string;
  task: string;
  history?: ProviderMessage[];
  webMode: boolean;
  signal: AbortSignal;
  requestPermission: PermissionRequester;
  auditPreview: (html: string, signal: AbortSignal) => Promise<PreviewReport>;
  onEvent: (event: AgentRunnerEvent) => void;
};

const truncateResult = (text: string) =>
  text.length > MAX_RESULT_CHARS
    ? `${text.slice(0, MAX_RESULT_CHARS)}\n…（已截断，原文共 ${text.length} 字符）`
    : text;

const timeline = (
  kind: AgentTimelineItem["kind"],
  title: string,
  status: AgentTimelineItem["status"],
  detail?: string,
  extra?: Pick<AgentTimelineItem, "result" | "issues">,
): AgentTimelineItem => ({
  id: crypto.randomUUID(),
  kind,
  title,
  detail,
  status,
  timestamp: Date.now(),
  ...extra,
});

const parseArguments = (toolCall: NormalizedToolCall) => {
  try {
    const value = JSON.parse(toolCall.arguments || "{}") as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("arguments must be a JSON object");
    }
    return value as Record<string, unknown>;
  } catch (error) {
    const detail = error instanceof Error ? error.message : "invalid JSON";
    throw new Error(`工具 ${toolCall.name} 参数无法解析：${detail}`);
  }
};

const toolResultMessage = (
  toolCall: NormalizedToolCall,
  content: string,
): ProviderMessage => ({
  role: "tool",
  content,
  toolCallId: toolCall.id,
  toolName: toolCall.name,
});

const extractHtml = (content: string) => {
  const fenced = content.match(/```html[^\n]*\n([\s\S]*?)(?:```|$)/i);
  if (fenced) return fenced[1].trim();
  const trimmed = content.trimStart();
  return /^(<!doctype\s+html|<html)/i.test(trimmed) ? trimmed : null;
};

const previewResultText = (report: PreviewReport) =>
  JSON.stringify({
    passed: report.passed,
    title: report.title,
    textLength: report.textLength,
    nodeCount: report.nodeCount,
    issues: report.issues,
  });

const stableSignature = (toolCall: NormalizedToolCall) => `${toolCall.name}:${toolCall.arguments}`;

export const hasRepeatedToolCycle = (signatures: string[], repeats = 3) => {
  for (let cycleLength = 1; cycleLength <= Math.min(4, Math.floor(signatures.length / repeats)); cycleLength += 1) {
    const required = cycleLength * repeats;
    const start = signatures.length - required;
    let matches = true;
    for (let offset = cycleLength; offset < required; offset += 1) {
      if (signatures[start + offset] !== signatures[start + (offset % cycleLength)]) {
        matches = false;
        break;
      }
    }
    if (matches) return true;
  }
  return false;
};

export const runAgentTask = async ({
  provider,
  model,
  apiKey,
  systemPrompt,
  task,
  history = [],
  webMode,
  signal,
  requestPermission,
  auditPreview,
  onEvent,
}: RunAgentOptions) => {
  const messages: ProviderMessage[] = [
    {
      role: "system",
      content:
        systemPrompt +
        "\n\nYou are running inside Nova Agent. First call report_plan with a concise plan. " +
        "Call update_plan after completing a meaningful plan stage so progress stays accurate. " +
        "Use tools when evidence or local changes are needed. Never claim a tool succeeded without its result. " +
        "Use safe relative paths. Before writing to the workspace, write the exact content to the temporary sandbox and validate it there. " +
        "Commands can only validate files already placed in the temporary sandbox. " +
        (webMode
          ? "For web work, call open_in_preview with the complete HTML and repair any reported errors before finishing."
          : "When the task is complete, answer with the final artifact and a concise verification summary."),
    },
    ...history.filter((message) => message.role !== "system" && message.role !== "tool"),
    { role: "user", content: task },
  ];
  let parseFailures = 0;
  let previewRounds = 0;
  const toolSignatures: string[] = [];
  const usageTotals: AgentUsage = { inputTokens: 0, outputTokens: 0 };
  let latestContent = "";
  let latestArtifact = "";
  let validatedArtifact = "";
  let plan: AgentPlanStep[] = [];

  onEvent({ type: "state", state: "planning" });

  for (let step = 1; step <= MAX_STEPS; step += 1) {
    if (signal.aborted) throw new DOMException("Agent stopped", "AbortError");
    onEvent({ type: "state", state: "model_streaming" });
    onEvent({ type: "model_started", step });
    onEvent({
      type: "timeline",
      item: timeline("model", `模型迭代 ${step}/${MAX_STEPS}`, "running"),
    });

    const turn = await provider.streamChat(
      {
        model,
        apiKey,
        messages: compactAgentContext(messages),
        tools: AGENT_TOOLS,
        toolChoice: "auto",
        signal,
      },
      (event) => {
        if (event.type === "content_delta") {
          onEvent({ type: "content_delta", content: event.content });
        }
        if (event.type === "usage") {
          usageTotals.inputTokens += event.inputTokens ?? 0;
          usageTotals.outputTokens += event.outputTokens ?? 0;
          onEvent({ type: "usage", usage: { ...usageTotals } });
        }
      },
    );
    const acceptedToolCalls = turn.toolCalls.slice(0, MAX_TOOL_CALLS_PER_TURN);
    messages.push({
      role: "assistant",
      content: turn.content,
      toolCalls: acceptedToolCalls,
    });
    if (turn.content.trim()) latestContent = turn.content;

    if (!turn.toolCalls.length) {
      const html = webMode ? extractHtml(turn.content) : null;
      if (html) latestArtifact = html;
      if (html && html === validatedArtifact) {
        const completedPlan = plan.map((item) => ({ ...item, status: "completed" as const }));
        plan = completedPlan;
        onEvent({ type: "plan", steps: completedPlan });
        onEvent({ type: "state", state: "completed" });
        onEvent({ type: "timeline", item: timeline("complete", "Agent 任务完成", "success") });
        return { content: latestContent || turn.content, artifact: latestArtifact, plan, steps: step, previewRounds, usage: { ...usageTotals } };
      }
      if (html && previewRounds < MAX_PREVIEW_ROUNDS) {
        previewRounds += 1;
        onEvent({ type: "state", state: "self_check" });
        const report = await auditPreview(html, signal);
        onEvent({
          type: "timeline",
          item: timeline(
            "preview",
            `网页自检 ${previewRounds}/${MAX_PREVIEW_ROUNDS}`,
            report.passed ? "success" : "error",
            report.issues.map((issue) => issue.message).join("\n") || "DOM 与运行时检查通过。",
            { issues: report.issues },
          ),
        });
        if (report.passed) validatedArtifact = html;
        if (previewRounds < MAX_PREVIEW_ROUNDS) {
          messages.push({
            role: "user",
            content:
              (report.passed
                ? "Nova automatic preview validation passed. Return the final complete HTML, preserving the validated behavior. Diagnostics:\n"
                : "Nova automatic preview validation failed. Repair the complete HTML and validate it again. Diagnostics:\n") +
              previewResultText(report),
          });
          continue;
        }
        if (!report.passed) {
          throw new Error(`网页自检连续 ${MAX_PREVIEW_ROUNDS} 轮未通过，Agent 已停止并保留最后一次诊断。`);
        }
      }
      const completedPlan = plan.map((item) => ({ ...item, status: "completed" as const }));
      plan = completedPlan;
      onEvent({ type: "plan", steps: completedPlan });
      onEvent({ type: "state", state: "completed" });
      onEvent({
        type: "timeline",
        item: timeline("complete", "Agent 任务完成", "success"),
      });
      return { content: latestContent || turn.content, artifact: latestArtifact || undefined, plan, steps: step, previewRounds, usage: { ...usageTotals } };
    }

    for (const toolCall of acceptedToolCalls) {
      const signature = stableSignature(toolCall);
      toolSignatures.push(signature);
      if (hasRepeatedToolCycle(toolSignatures)) {
        throw new Error(`检测到重复工具调用循环，最近调用为：${toolCall.name}`);
      }

      let argumentsValue: Record<string, unknown>;
      try {
        argumentsValue = parseArguments(toolCall);
        parseFailures = 0;
      } catch (error) {
        parseFailures += 1;
        const detail = error instanceof Error ? error.message : "工具参数格式错误";
        messages.push(toolResultMessage(toolCall, JSON.stringify({ ok: false, error: detail })));
        onEvent({ type: "timeline", item: timeline("error", detail, "error") });
        if (parseFailures >= MAX_PARSE_FAILURES) {
          throw new Error("工具调用参数连续两次无法解析，Agent 已停止。" );
        }
        continue;
      }

      if (toolCall.name === "report_plan") {
        const rawSteps = Array.isArray(argumentsValue.steps) ? argumentsValue.steps : [];
        const titles = rawSteps
          .filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
          .slice(0, 12);
        if (!titles.length) {
          messages.push(toolResultMessage(toolCall, JSON.stringify({ ok: false, error: "steps must contain strings" })));
          continue;
        }
        plan = titles.map((title, index) => ({
          id: `plan-${index + 1}`,
          title: title.trim(),
          status: index === 0 ? "in_progress" : "pending",
        }));
        onEvent({ type: "plan", steps: plan });
        onEvent({ type: "timeline", item: timeline("plan", "执行计划已建立", "success", titles.join("\n")) });
        messages.push(toolResultMessage(toolCall, JSON.stringify({ ok: true, steps: titles })));
        continue;
      }

      if (toolCall.name === "update_plan") {
        if (!plan.length) {
          messages.push(toolResultMessage(toolCall, JSON.stringify({ ok: false, error: "report_plan must be called first" })));
          continue;
        }
        const requestedCompleted = argumentsValue.completed_steps;
        if (typeof requestedCompleted !== "number" || !Number.isInteger(requestedCompleted)) {
          messages.push(toolResultMessage(toolCall, JSON.stringify({ ok: false, error: "completed_steps must be an integer" })));
          continue;
        }
        const completedSteps = Math.max(0, Math.min(plan.length, requestedCompleted));
        plan = plan.map((item, index) => ({
          ...item,
          status:
            index < completedSteps
              ? "completed" as const
              : index === completedSteps
                ? "in_progress" as const
                : "pending" as const,
        }));
        const note = typeof argumentsValue.note === "string" ? argumentsValue.note.trim() : "";
        onEvent({ type: "plan", steps: plan });
        onEvent({
          type: "timeline",
          item: timeline(
            "plan",
            completedSteps === plan.length ? "计划步骤已全部完成" : `进入计划步骤 ${completedSteps + 1}/${plan.length}`,
            "success",
            note || undefined,
          ),
        });
        messages.push(toolResultMessage(toolCall, JSON.stringify({ ok: true, completedSteps, totalSteps: plan.length })));
        continue;
      }

      if (toolCall.name === "open_in_preview") {
        if (!webMode) {
          messages.push(toolResultMessage(toolCall, JSON.stringify({ ok: false, error: "preview is only available in web mode" })));
          continue;
        }
        if (previewRounds >= MAX_PREVIEW_ROUNDS) {
          messages.push(toolResultMessage(toolCall, JSON.stringify({ ok: false, error: "preview round limit reached" })));
          continue;
        }
        const html = typeof argumentsValue.html === "string" ? argumentsValue.html : "";
        if (!html) {
          messages.push(toolResultMessage(toolCall, JSON.stringify({ ok: false, error: "html is required" })));
          continue;
        }
        previewRounds += 1;
        onEvent({ type: "state", state: "self_check" });
        const report = await auditPreview(html, signal);
        latestArtifact = html;
        if (report.passed) validatedArtifact = html;
        onEvent({
          type: "timeline",
          item: timeline(
            "preview",
            `网页自检 ${previewRounds}/${MAX_PREVIEW_ROUNDS}`,
            report.passed ? "success" : "error",
            report.issues.map((issue) => issue.message).join("\n") || "DOM 与运行时检查通过。",
            { issues: report.issues },
          ),
        });
        messages.push(toolResultMessage(toolCall, previewResultText(report)));
        if (!report.passed && previewRounds >= MAX_PREVIEW_ROUNDS) {
          throw new Error(`网页自检连续 ${MAX_PREVIEW_ROUNDS} 轮未通过，Agent 已停止并保留最后一次诊断。`);
        }
        continue;
      }

      onEvent({ type: "state", state: "running_tool" });
      let prepared;
      try {
        prepared = await prepareGatewayToolCall(toolCall.name, argumentsValue);
        if (prepared.requiresConfirmation) {
          onEvent({ type: "state", state: "awaiting_permission" });
          onEvent({
            type: "timeline",
            item: timeline("permission", `等待授权：${toolCall.name}`, "waiting", prepared.display),
          });
          const decision = await requestPermission(prepared);
          const resolution = await resolveGatewayPermission(prepared.requestId, decision);
          if (!resolution.approved) {
            messages.push(toolResultMessage(toolCall, JSON.stringify({ ok: false, error: "user denied this tool call" })));
            continue;
          }
        }
        const execution = await executeGatewayToolCall(prepared.requestId);
        onEvent({ type: "state", state: "observing" });
        onEvent({
          type: "timeline",
          item: timeline(
            "tool",
            `${toolCall.name} ${execution.ok ? "完成" : "失败"}`,
            execution.ok ? "success" : "error",
            prepared.display,
            execution.content ? { result: truncateResult(execution.content) } : undefined,
          ),
        });
        messages.push(toolResultMessage(toolCall, JSON.stringify(execution)));
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        onEvent({ type: "timeline", item: timeline("error", `${toolCall.name} 执行失败`, "error", detail) });
        messages.push(toolResultMessage(toolCall, JSON.stringify({ ok: false, error: detail })));
      }
    }

    if (turn.toolCalls.length > acceptedToolCalls.length) {
      const omitted = turn.toolCalls.length - acceptedToolCalls.length;
      const detail = `模型单轮返回 ${turn.toolCalls.length} 个工具调用；为控制风险，本轮只接受前 ${MAX_TOOL_CALLS_PER_TURN} 个，其余 ${omitted} 个需在下一轮重新请求。`;
      onEvent({ type: "timeline", item: timeline("error", "工具调用数量已截断", "error", detail) });
      messages.push({ role: "user", content: detail });
    }
  }

  onEvent({ type: "state", state: "awaiting_user" });
  throw new Error(`Agent 已达到 ${MAX_STEPS} 步上限，已安全停止。`);
};
