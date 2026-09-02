import type { ProviderMessage } from "../providers";

const MAX_CONTEXT_CHARACTERS = 120_000;
const MAX_TOOL_RESULT_CHARACTERS = 32_000;
const MAX_TOOL_ARGUMENT_CHARACTERS = 32_000;
const COMPACTION_NOTICE =
  "Earlier low-priority observations were compacted. Use the current plan and recent tool results as the source of truth.";

const normalizeMessage = (message: ProviderMessage): ProviderMessage => {
  const content =
    message.role === "tool" && message.content.length > MAX_TOOL_RESULT_CHARACTERS
      ? message.content.slice(0, MAX_TOOL_RESULT_CHARACTERS) +
        `\n[结果已截断；原始长度 ${message.content.length.toLocaleString()} 字符]`
      : message.content;
  const toolCalls = message.toolCalls?.map((toolCall) =>
    toolCall.arguments.length > MAX_TOOL_ARGUMENT_CHARACTERS
      ? {
          ...toolCall,
          arguments: JSON.stringify({
            compacted: true,
            originalCharacters: toolCall.arguments.length,
          }),
        }
      : toolCall,
  );
  return { ...message, content, ...(toolCalls ? { toolCalls } : {}) };
};

const messageSize = (message: ProviderMessage) =>
  message.content.length +
  (message.toolCalls?.reduce(
    (sum, toolCall) => sum + toolCall.id.length + toolCall.name.length + toolCall.arguments.length,
    0,
  ) ?? 0);

export const compactAgentContext = (messages: ProviderMessage[]) => {
  const normalized = messages.map(normalizeMessage);
  if (normalized.reduce((sum, message) => sum + messageSize(message), 0) <= MAX_CONTEXT_CHARACTERS) {
    return normalized;
  }

  const system = normalized.find((message) => message.role === "system") ?? {
    role: "system" as const,
    content: "Continue the current Nova Agent task safely.",
  };
  const notice: ProviderMessage = { role: "system", content: COMPACTION_NOTICE };
  let remaining = Math.max(
    0,
    MAX_CONTEXT_CHARACTERS - messageSize(system) - messageSize(notice),
  );
  const tail: ProviderMessage[] = [];
  for (let index = normalized.length - 1; index >= 0; index -= 1) {
    const message = normalized[index];
    if (message === system) continue;
    const size = messageSize(message);
    if (size > remaining) break;
    tail.unshift(message);
    remaining -= size;
  }

  // Compatible endpoints reject a tool result without its preceding assistant
  // tool_calls message, so never leave an orphan at the cut point.
  while (tail[0]?.role === "tool") tail.shift();
  return [system, notice, ...tail];
};
