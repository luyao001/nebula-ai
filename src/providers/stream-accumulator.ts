import type { NormalizedToolCall } from "./types";

type OpenAiToolCallDelta = {
  index?: unknown;
  id?: unknown;
  function?: {
    name?: unknown;
    arguments?: unknown;
  };
};

type OllamaToolCall = {
  id?: unknown;
  function?: {
    index?: unknown;
    name?: unknown;
    arguments?: unknown;
  };
};

const toArgumentString = (value: unknown) => {
  if (typeof value === "string") return value;
  if (value === undefined) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
};

const toIndex = (value: unknown, fallback: number) =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : fallback;

export class StreamAccumulator {
  private contentValue = "";
  private readonly toolCallsByIndex = new Map<number, NormalizedToolCall>();

  get content() {
    return this.contentValue;
  }

  appendContent(content: string) {
    this.contentValue += content;
  }

  appendOpenAiToolDelta(delta: OpenAiToolCallDelta) {
    const index = toIndex(delta.index, 0);
    const previous = this.toolCallsByIndex.get(index);
    const id = typeof delta.id === "string" && delta.id ? delta.id : previous?.id || `call-${index}`;
    const namePart = typeof delta.function?.name === "string" ? delta.function.name : "";
    const argumentPart =
      typeof delta.function?.arguments === "string" ? delta.function.arguments : "";
    const toolCall: NormalizedToolCall = {
      id,
      index,
      name: (previous?.name || "") + namePart,
      arguments: (previous?.arguments || "") + argumentPart,
    };
    this.toolCallsByIndex.set(index, toolCall);
    return toolCall;
  }

  appendOllamaToolCall(call: OllamaToolCall, fallbackIndex: number) {
    const index = toIndex(call.function?.index, fallbackIndex);
    const previous = this.toolCallsByIndex.get(index);
    const id = typeof call.id === "string" && call.id ? call.id : previous?.id || `ollama-${index}`;
    const name = typeof call.function?.name === "string" ? call.function.name : "";
    const argumentsValue = toArgumentString(call.function?.arguments);
    const toolCall: NormalizedToolCall = {
      id,
      index,
      name: name || previous?.name || "",
      arguments: argumentsValue || previous?.arguments || "",
    };
    this.toolCallsByIndex.set(index, toolCall);
    return toolCall;
  }

  getToolCalls() {
    return [...this.toolCallsByIndex.values()].sort((left, right) => left.index - right.index);
  }
}
