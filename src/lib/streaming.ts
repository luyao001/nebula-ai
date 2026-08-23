type ContentHandler = (content: string) => void;

type OllamaChunk = {
  message?: { content?: unknown };
  error?: unknown;
};

type CompatibleChunk = {
  choices?: Array<{ delta?: { content?: unknown } }>;
  error?: { message?: unknown } | unknown;
};

const getReader = (response: Response) => {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("响应流不可用。");
  return reader;
};

const parseJson = <T>(value: string, source: string): T => {
  try {
    return JSON.parse(value) as T;
  } catch {
    throw new Error(source + " 返回了无法解析的流式数据。");
  }
};

export const getResponseError = async (response: Response, source: string) => {
  const fallback = source + " 请求失败（HTTP " + response.status + "）";
  try {
    const text = await response.text();
    if (!text) return fallback;
    const data = JSON.parse(text) as {
      error?: { message?: unknown } | unknown;
      message?: unknown;
    };
    if (
      data.error &&
      typeof data.error === "object" &&
      "message" in data.error &&
      typeof data.error.message === "string"
    ) {
      return data.error.message;
    }
    if (typeof data.error === "string") return data.error;
    if (typeof data.message === "string") return data.message;
    return fallback;
  } catch {
    return fallback;
  }
};

export const readNdjsonStream = async (
  response: Response,
  onContent: ContentHandler,
) => {
  const reader = getReader(response);
  const decoder = new TextDecoder();
  let buffer = "";

  const processLine = (line: string) => {
    const value = line.trim();
    if (!value) return;
    const chunk = parseJson<OllamaChunk>(value, "Ollama");
    if (chunk.error) {
      throw new Error(typeof chunk.error === "string" ? chunk.error : "Ollama 返回错误。");
    }
    const content = chunk.message?.content;
    if (typeof content === "string" && content) onContent(content);
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";
    lines.forEach(processLine);
  }

  buffer += decoder.decode();
  if (buffer.trim()) processLine(buffer);
};

export const readSseStream = async (
  response: Response,
  onContent: ContentHandler,
) => {
  const reader = getReader(response);
  const decoder = new TextDecoder();
  let buffer = "";

  const processEvent = (event: string) => {
    const payload = event
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.replace(/^data:\s?/, ""))
      .join("\n")
      .trim();

    if (!payload || payload === "[DONE]") return payload === "[DONE]";
    const chunk = parseJson<CompatibleChunk>(payload, "OrcaRouter");
    if (chunk.error) {
      const message =
        typeof chunk.error === "object" &&
        chunk.error &&
        "message" in chunk.error &&
        typeof chunk.error.message === "string"
          ? chunk.error.message
          : "OrcaRouter 返回错误。";
      throw new Error(message);
    }
    const content = chunk.choices?.[0]?.delta?.content;
    if (typeof content === "string" && content) onContent(content);
    return false;
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split(/\r?\n\r?\n/);
    buffer = events.pop() || "";
    for (const event of events) {
      if (processEvent(event)) return;
    }
  }

  buffer += decoder.decode();
  if (buffer.trim()) processEvent(buffer);
};
