export type ProviderId = "ollama" | "orcarouter";

export type JsonSchema = Record<string, unknown>;

export type FunctionTool = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: JsonSchema;
  };
};

export type NormalizedToolCall = {
  id: string;
  index: number;
  name: string;
  arguments: string;
};

export type ProviderMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCalls?: NormalizedToolCall[];
  toolCallId?: string;
  toolName?: string;
};

export type ToolChoice =
  | "none"
  | "auto"
  | "required"
  | { type: "function"; function: { name: string } };

export type ProviderRequest = {
  model: string;
  messages: ProviderMessage[];
  tools?: FunctionTool[];
  toolChoice?: ToolChoice;
  apiKey?: string;
  signal?: AbortSignal;
};

export type ProviderFinishReason =
  | "stop"
  | "tool_calls"
  | "length"
  | "cancelled"
  | "unknown";

export type ProviderEvent =
  | { type: "content_delta"; content: string }
  | { type: "tool_call_delta"; toolCall: NormalizedToolCall }
  | { type: "usage"; inputTokens?: number; outputTokens?: number }
  | { type: "completed"; finishReason: ProviderFinishReason };

export type AssistantTurn = {
  content: string;
  toolCalls: NormalizedToolCall[];
  finishReason: ProviderFinishReason;
};

export type ProviderEventHandler = (event: ProviderEvent) => void;

export interface ChatProvider {
  readonly id: ProviderId;
  streamChat(request: ProviderRequest, onEvent: ProviderEventHandler): Promise<AssistantTurn>;
}
