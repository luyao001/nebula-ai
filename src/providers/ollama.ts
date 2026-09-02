import { getResponseError, readNdjsonStream } from "../lib/streaming";
import { StreamAccumulator } from "./stream-accumulator";
import type {
  AssistantTurn,
  ChatProvider,
  NormalizedToolCall,
  ProviderFinishReason,
  ProviderMessage,
} from "./types";

type OllamaChunk = {
  message?: {
    content?: unknown;
    tool_calls?: Array<{
      id?: unknown;
      function?: {
        index?: unknown;
        name?: unknown;
        arguments?: unknown;
      };
    }>;
  };
  done?: unknown;
  done_reason?: unknown;
  prompt_eval_count?: unknown;
  eval_count?: unknown;
  error?: unknown;
};

const parseArguments = (argumentsValue: string) => {
  try {
    return JSON.parse(argumentsValue) as unknown;
  } catch {
    return argumentsValue;
  }
};

const encodeToolCall = (toolCall: NormalizedToolCall) => ({
  type: "function",
  function: {
    index: toolCall.index,
    name: toolCall.name,
    arguments: parseArguments(toolCall.arguments),
  },
});

const encodeMessage = (message: ProviderMessage) => {
  if (message.role === "assistant" && message.toolCalls?.length) {
    return {
      role: "assistant",
      content: message.content,
      tool_calls: message.toolCalls.map(encodeToolCall),
    };
  }
  if (message.role === "tool") {
    return {
      role: "tool",
      tool_name: message.toolName || "unknown_tool",
      content: message.content,
    };
  }
  return { role: message.role, content: message.content };
};

const normalizeFinishReason = (value: unknown, hasToolCalls: boolean): ProviderFinishReason => {
  if (hasToolCalls) return "tool_calls";
  if (value === "stop") return "stop";
  if (value === "length") return "length";
  return "unknown";
};

export const createOllamaProvider = (chatUrl: string): ChatProvider => ({
  id: "ollama",
  async streamChat(request, onEvent): Promise<AssistantTurn> {
    const response = await fetch(chatUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: request.model,
        messages: request.messages.map(encodeMessage),
        stream: true,
        ...(request.tools?.length ? { tools: request.tools } : {}),
      }),
      signal: request.signal,
    });
    if (!response.ok) throw new Error(await getResponseError(response, "Ollama"));

    const accumulator = new StreamAccumulator();
    let doneReason: unknown;
    let inputTokens: number | undefined;
    let outputTokens: number | undefined;
    let nextFallbackToolIndex = 0;

    await readNdjsonStream<OllamaChunk>(response, "Ollama", (chunk) => {
      if (chunk.error) {
        throw new Error(typeof chunk.error === "string" ? chunk.error : "Ollama 返回错误。");
      }
      const content = chunk.message?.content;
      if (typeof content === "string" && content) {
        accumulator.appendContent(content);
        onEvent({ type: "content_delta", content });
      }
      chunk.message?.tool_calls?.forEach((call) => {
        const toolCall = accumulator.appendOllamaToolCall(call, nextFallbackToolIndex);
        nextFallbackToolIndex += 1;
        onEvent({ type: "tool_call_delta", toolCall });
      });
      if (typeof chunk.prompt_eval_count === "number") inputTokens = chunk.prompt_eval_count;
      if (typeof chunk.eval_count === "number") outputTokens = chunk.eval_count;
      if (chunk.done === true) doneReason = chunk.done_reason;
    });

    if (inputTokens !== undefined || outputTokens !== undefined) {
      onEvent({ type: "usage", inputTokens, outputTokens });
    }
    const toolCalls = accumulator.getToolCalls();
    const finishReason = normalizeFinishReason(doneReason, toolCalls.length > 0);
    onEvent({ type: "completed", finishReason });
    return { content: accumulator.content, toolCalls, finishReason };
  },
});
