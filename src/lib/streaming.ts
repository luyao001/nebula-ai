type DataHandler<T> = (data: T) => void;

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

export const readNdjsonStream = async <T>(
  response: Response,
  source: string,
  onData: DataHandler<T>,
) => {
  const reader = getReader(response);
  const decoder = new TextDecoder();
  let buffer = "";

  const processLine = (line: string) => {
    const value = line.trim();
    if (!value) return;
    onData(parseJson<T>(value, source));
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

export const readSseStream = async <T>(
  response: Response,
  source: string,
  onData: DataHandler<T>,
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
    onData(parseJson<T>(payload, source));
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
