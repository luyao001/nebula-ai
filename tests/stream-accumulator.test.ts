import { describe, expect, it } from "vitest";
import { StreamAccumulator } from "../src/providers/stream-accumulator";

describe("StreamAccumulator", () => {
  it("aggregates fragmented OpenAI-compatible tool call deltas by index", () => {
    const accumulator = new StreamAccumulator();
    accumulator.appendOpenAiToolDelta({
      index: 0,
      id: "call-a",
      function: { name: "write_", arguments: '{"path":"index' },
    });
    accumulator.appendOpenAiToolDelta({
      index: 1,
      id: "call-b",
      function: { name: "list_dir", arguments: "{}" },
    });
    accumulator.appendOpenAiToolDelta({
      index: 0,
      function: { name: "file", arguments: '.html","content":"ok"}' },
    });

    expect(accumulator.getToolCalls()).toEqual([
      {
        id: "call-a",
        index: 0,
        name: "write_file",
        arguments: '{"path":"index.html","content":"ok"}',
      },
      { id: "call-b", index: 1, name: "list_dir", arguments: "{}" },
    ]);
  });

  it("normalizes Ollama object arguments without losing Unicode", () => {
    const accumulator = new StreamAccumulator();
    accumulator.appendOllamaToolCall(
      {
        function: {
          index: 2,
          name: "write_file",
          arguments: { path: "页面.html", content: "你好" },
        },
      },
      0,
    );

    expect(accumulator.getToolCalls()).toEqual([
      {
        id: "ollama-2",
        index: 2,
        name: "write_file",
        arguments: JSON.stringify({ path: "页面.html", content: "你好" }),
      },
    ]);
  });
});
