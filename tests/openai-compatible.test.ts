import { afterEach, describe, expect, it, vi } from "vitest";
import { createOpenAiCompatibleProvider } from "../src/providers";

describe("OpenAI-compatible provider", () => {
  afterEach(() => vi.restoreAllMocks());

  it("asks OrcaRouter to include usage in streamed responses", async () => {
    let requestBody: Record<string, unknown> | undefined;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(
        [
          'data: {"choices":[{"delta":{"content":"ok"},"finish_reason":null}]}',
          'data: {"choices":[],"usage":{"prompt_tokens":12,"completion_tokens":3}}',
          "data: [DONE]",
          "",
        ].join("\n\n"),
        { status: 200, headers: { "Content-Type": "text/event-stream" } },
      );
    });

    const usage: Array<{ inputTokens?: number; outputTokens?: number }> = [];
    const provider = createOpenAiCompatibleProvider({
      chatUrl: "https://api.orcarouter.ai/v1/chat/completions",
    });
    const result = await provider.streamChat(
      {
        model: "orcarouter/auto",
        apiKey: "memory-only",
        messages: [{ role: "user", content: "hello" }],
      },
      (event) => {
        if (event.type === "usage") usage.push(event);
      },
    );

    expect(requestBody?.stream_options).toEqual({ include_usage: true });
    expect(result.content).toBe("ok");
    expect(usage).toEqual([{ type: "usage", inputTokens: 12, outputTokens: 3 }]);
  });
});
