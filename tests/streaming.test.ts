import { describe, expect, it } from "vitest";
import { readNdjsonStream, readSseStream } from "../src/lib/streaming";

const fragmentedResponse = (parts: string[]) => {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        parts.forEach((part) => controller.enqueue(encoder.encode(part)));
        controller.close();
      },
    }),
  );
};

describe("stream framing", () => {
  it("parses NDJSON split across arbitrary network chunks", async () => {
    const values: Array<{ value: string }> = [];
    await readNdjsonStream(
      fragmentedResponse(['{"value":"你', '好"}\n{"value":"two"', "}\n"]),
      "fixture",
      (value: { value: string }) => values.push(value),
    );
    expect(values).toEqual([{ value: "你好" }, { value: "two" }]);
  });

  it("parses multiline SSE events and stops at DONE", async () => {
    const values: Array<{ value: number }> = [];
    await readSseStream(
      fragmentedResponse([
        'data: {"value":',
        "1}\n\n",
        'data: {"value":2}\n\n',
        "data: [DONE]\n\n",
        'data: {"value":3}\n\n',
      ]),
      "fixture",
      (value: { value: number }) => values.push(value),
    );
    expect(values).toEqual([{ value: 1 }, { value: 2 }]);
  });
});
