import { describe, expect, it } from "vitest";
import { hasRepeatedToolCycle, runAgentTask } from "../src/agent/runner";
import type { AgentRunnerEvent } from "../src/agent/types";
import type { ChatProvider, NormalizedToolCall } from "../src/providers";

const planCall = (index: number): NormalizedToolCall => ({
  id: `plan-${index}`,
  index,
  name: "report_plan",
  arguments: JSON.stringify({ steps: [`step-${index}`] }),
});

const runnerOptions = {
  model: "fixture",
  systemPrompt: "fixture",
  task: "fixture",
  webMode: false,
  signal: new AbortController().signal,
  requestPermission: async () => "deny" as const,
  auditPreview: async () => ({
    passed: true,
    title: "",
    textLength: 0,
    nodeCount: 0,
    issues: [],
  }),
  onEvent: () => undefined,
};

describe("runAgentTask", () => {
  it("lets the model report meaningful progress between plan stages", async () => {
    const emitted: AgentRunnerEvent[] = [];
    let turn = 0;
    const provider: ChatProvider = {
      id: "ollama",
      async streamChat() {
        turn += 1;
        if (turn === 1) {
          return {
            content: "",
            toolCalls: [{
              id: "plan",
              index: 0,
              name: "report_plan",
              arguments: JSON.stringify({ steps: ["inspect", "change", "verify"] }),
            }],
            finishReason: "tool_calls",
          };
        }
        if (turn === 2) {
          return {
            content: "",
            toolCalls: [{
              id: "progress",
              index: 0,
              name: "update_plan",
              arguments: JSON.stringify({ completed_steps: 1, note: "inspection complete" }),
            }],
            finishReason: "tool_calls",
          };
        }
        return { content: "done", toolCalls: [], finishReason: "stop" };
      },
    };

    await runAgentTask({ provider, ...runnerOptions, onEvent: (event) => emitted.push(event) });
    const plans = emitted
      .filter((event): event is Extract<AgentRunnerEvent, { type: "plan" }> => event.type === "plan")
      .map((event) => event.steps.map((step) => step.status));
    expect(plans).toContainEqual(["completed", "in_progress", "pending"]);
    const progressEvent = emitted.find(
      (event) => event.type === "timeline" && event.item.title === "进入计划步骤 2/3",
    );
    expect(progressEvent).toBeTruthy();
  });

  it("keeps assistant tool_calls and tool results protocol-complete when a turn returns more than four calls", async () => {
    let turn = 0;
    const provider: ChatProvider = {
      id: "ollama",
      async streamChat(request) {
        turn += 1;
        if (turn === 1) {
          return {
            content: "",
            toolCalls: Array.from({ length: 5 }, (_, index) => planCall(index)),
            finishReason: "tool_calls",
          };
        }

        const assistant = [...request.messages]
          .reverse()
          .find((message) => message.role === "assistant");
        expect(assistant?.toolCalls).toHaveLength(4);
        expect(request.messages.filter((message) => message.role === "tool")).toHaveLength(4);
        expect(request.messages[request.messages.length - 1]?.role).toBe("user");
        expect(request.messages[request.messages.length - 1]?.content).toContain(
          "其余 1 个需在下一轮重新请求",
        );
        return { content: "done", toolCalls: [], finishReason: "stop" };
      },
    };

    const result = await runAgentTask({ provider, ...runnerOptions });
    expect(result.content).toBe("done");
    expect(result.steps).toBe(2);
  });

  it("detects alternating A/B tool-call cycles", () => {
    expect(hasRepeatedToolCycle(["A", "B", "A", "B", "A", "B"])).toBe(true);
    expect(hasRepeatedToolCycle(["A", "B", "A", "C", "A", "B"])).toBe(false);
  });

  it("accumulates provider usage events into running totals and the result", async () => {
    const emitted: AgentRunnerEvent[] = [];
    const provider: ChatProvider = {
      id: "ollama",
      async streamChat(_request, onEvent) {
        onEvent({ type: "usage", inputTokens: 100, outputTokens: 40 });
        onEvent({ type: "usage", outputTokens: 10 });
        return { content: "done", toolCalls: [], finishReason: "stop" };
      },
    };

    const result = await runAgentTask({ provider, ...runnerOptions, onEvent: (event) => emitted.push(event) });

    expect(result.usage).toEqual({ inputTokens: 100, outputTokens: 50 });
    expect(emitted.filter((event) => event.type === "usage")).toEqual([
      { type: "usage", usage: { inputTokens: 100, outputTokens: 40 } },
      { type: "usage", usage: { inputTokens: 100, outputTokens: 50 } },
    ]);
  });

  it("attaches structured preview issues to web-mode timeline items", async () => {
    const emitted: AgentRunnerEvent[] = [];
    const provider: ChatProvider = {
      id: "ollama",
      async streamChat() {
        return {
          content: "<!doctype html>\n<html><body>probe</body></html>",
          toolCalls: [],
          finishReason: "stop",
        };
      },
    };

    await expect(
      runAgentTask({
        provider,
        ...runnerOptions,
        webMode: true,
        onEvent: (event) => emitted.push(event),
        auditPreview: async () => ({
          passed: false,
          title: "fixture",
          textLength: 5,
          nodeCount: 3,
          issues: [
            { severity: "error", message: "页面没有可见内容。" },
            { severity: "warning", message: "页面缺少 title。" },
          ],
        }),
      }),
    ).rejects.toThrow("网页自检连续 3 轮未通过");

    const previewItems = emitted
      .filter((event): event is Extract<AgentRunnerEvent, { type: "timeline" }> => event.type === "timeline")
      .map((event) => event.item)
      .filter((item) => item.kind === "preview");
    expect(previewItems).toHaveLength(3);
    for (const item of previewItems) {
      expect(item.status).toBe("error");
      expect(item.issues).toEqual([
        { severity: "error", message: "页面没有可见内容。" },
        { severity: "warning", message: "页面缺少 title。" },
      ]);
    }
  });
});
