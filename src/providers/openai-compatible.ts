import { getResponseError, readSseStream } from "../lib/streaming";
import { StreamAccumulator } from "./stream-accumulator";
import type {
  AssistantTurn,
  ChatProvider,
  NormalizedToolCall,
  ProviderFinishReason,
  ProviderMessage,
} from "./types";

type CompatibleChunk = {
  choices?: Array<{
    delta?: {
      content?: unknown;
      tool_calls?: Array<{
        index?: unknown;
        id?: unknown;
        function?: { name?: unknown; arguments?: unknown };
      }>;
    };
    finish_reason?: unknown;
  }>;
  usage?: {
    prompt_tokens?: unknown;
    completion_tokens?: unknown;
  };
  error?: { message?: unknown } | unknown;
};

const encodeToolCall = (toolCall: NormalizedToolCall) => ({
  id: toolCall.id,
  type: "function",
  function: { name: toolCall.name, arguments: toolCall.arguments },
});

const encodeMessage = (message: ProviderMessage) => {
  if (message.role === "assistant" && message.toolCalls?.length) {
    return {
      role: "assistant",
      content: message.content || null,
      tool_calls: message.toolCalls.map(encodeToolCall),
    };
  }
  if (message.role === "tool") {
    return {
      role: "tool",
      tool_call_id: message.toolCallId || "unknown_call",
      content: message.content,
    };
  }
  return { role: message.role, content: message.content };
};

const getChunkError = (error: CompatibleChunk["error"]) => {
  if (
    typeof error === "object" &&
    error &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }
  return "OrcaRouter 返回错误。";
};

const normalizeFinishReason = (value: unknown, hasToolCalls: boolean): ProviderFinishReason => {
  if (value === "tool_calls" || hasToolCalls) return "tool_calls";
  if (value === "stop") return "stop";
  if (value === "length") return "length";
  return "unknown";
};

type OpenAiCompatibleOptions = {
  chatUrl: string;
  referer?: string;
  title?: string;
};

export const createOpenAiCompatibleProvider = ({
  chatUrl,
  referer,
  title,
}: OpenAiCompatibleOptions): ChatProvider => ({
  id: "orcarouter",
  async streamChat(request, onEvent): Promise<AssistantTurn> {
    if (!request.apiKey?.trim()) throw new Error("缺少 OrcaRouter API Key。");
    const response = await fetch(chatUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${request.apiKey.trim()}`,
        ...(referer ? { "HTTP-Referer": referer } : {}),
        ...(title ? { "X-Title": title } : {}),
      },
      body: JSON.stringify({
        model: request.model,
        messages: request.messages.map(encodeMessage),
        stream: true,
        ...(request.tools?.length
          ? {
              tools: request.tools,
              tool_choice: request.toolChoice || "auto",
            }
          : {}),
      }),
      signal: request.signal,
    });
    if (!response.ok) throw new Error(await getResponseError(response, "OrcaRouter"));

    const accumulator = new StreamAccumulator();
    let rawFinishReason: unknown;

    await readSseStream<CompatibleChunk>(response, "OrcaRouter", (chunk) => {
      if (chunk.error) throw new Error(getChunkError(chunk.error));
      const choice = chunk.choices?.[0];
      const content = choice?.delta?.content;
      if (typeof content === "string" && content) {
        accumulator.appendContent(content);
        onEvent({ type: "content_delta", content });
      }
      choice?.delta?.tool_calls?.forEach((delta) => {
        const toolCall = accumulator.appendOpenAiToolDelta(delta);
        onEvent({ type: "tool_call_delta", toolCall });
      });
      if (choice?.finish_reason !== undefined && choice.finish_reason !== null) {
        rawFinishReason = choice.finish_reason;
      }
      const inputTokens =
        typeof chunk.usage?.prompt_tokens === "number" ? chunk.usage.prompt_tokens : undefined;
      const outputTokens =
        typeof chunk.usage?.completion_tokens === "number"
          ? chunk.usage.completion_tokens
          : undefined;
      if (inputTokens !== undefined || outputTokens !== undefined) {
        onEvent({ type: "usage", inputTokens, outputTokens });
      }
    });

    const toolCalls = accumulator.getToolCalls();
    const finishReason = normalizeFinishReason(rawFinishReason, toolCalls.length > 0);
    onEvent({ type: "completed", finishReason });
    return { content: accumulator.content, toolCalls, finishReason };
  },
});
