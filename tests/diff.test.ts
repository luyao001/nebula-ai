import { describe, expect, it } from "vitest";
import { computeLineDiff } from "../src/lib/diff";

describe("computeLineDiff", () => {
  it("returns unchanged lines as same with zero churn", () => {
    const result = computeLineDiff("a\nb\nc", "a\nb\nc");
    expect(result.lines.map((line) => line.kind)).toEqual(["same", "same", "same"]);
    expect(result.added).toBe(0);
    expect(result.removed).toBe(0);
    expect(result.truncated).toBe(false);
    expect(result.oversized).toBe(false);
  });

  it("marks a single edited line with one deletion and one addition", () => {
    const result = computeLineDiff("a\nb\nc", "a\nB\nc");
    expect(result.lines[0]).toEqual({ kind: "same", text: "a" });
    expect(result.lines[result.lines.length - 1]).toEqual({ kind: "same", text: "c" });
    expect(result.lines.map((line) => line.kind).sort()).toEqual(["add", "del", "same", "same"]);
    expect(result.added).toBe(1);
    expect(result.removed).toBe(1);
  });

  it("treats an empty old text as pure additions", () => {
    const result = computeLineDiff("", "x\ny");
    expect(result.lines.map((line) => line.kind)).toEqual(["add", "add"]);
    expect(result.added).toBe(2);
    expect(result.removed).toBe(0);
  });

  it("falls back to block mode when the LCS table would explode", () => {
    const old = Array.from({ length: 600 }, (_, index) => `old-${index}`).join("\n");
    const updated = Array.from({ length: 600 }, (_, index) => `new-${index}`).join("\n");
    const result = computeLineDiff(old, updated);
    expect(result.oversized).toBe(true);
    expect(result.removed).toBe(600);
    expect(result.added).toBe(600);
    expect(result.lines.length).toBeLessThanOrEqual(400);
    expect(result.truncated).toBe(true);
  });

  it("caps displayed lines but keeps full add/remove counts", () => {
    const old = Array.from({ length: 300 }, () => "same").join("\n");
    const added = Array.from({ length: 300 }, (_, index) => `added-${index}`).join("\n");
    const result = computeLineDiff(old, `${old}\n${added}`);
    expect(result.oversized).toBe(false);
    expect(result.truncated).toBe(true);
    expect(result.added).toBe(300);
    expect(result.lines.length).toBe(400);
  });
});
