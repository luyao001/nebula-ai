import { describe, expect, it } from "vitest";
import { extractFileReferenceTokens, resolveFileReferences } from "../src/agent/references";

describe("extractFileReferenceTokens", () => {
  it("extracts path-like tokens", () => {
    const tokens = extractFileReferenceTokens(
      "先看 @src/main.ts 和 @docs/api.md，再改 @src/agent/runner.ts",
    );
    expect(tokens).toEqual(["src/main.ts", "docs/api.md", "src/agent/runner.ts"]);
  });

  it("ignores emails, bare mentions and mid-word tokens", () => {
    const tokens = extractFileReferenceTokens(
      "联系 someone@example.com 或者 @someone，还有 team@docs",
    );
    expect(tokens).toEqual([]);
  });

  it("deduplicates and caps the number of references", () => {
    const many = Array.from({ length: 12 }, (_, index) => `@src/file${index}.ts`).join(" ");
    const tokens = extractFileReferenceTokens(`@src/main.ts ${many} @src/main.ts`);
    expect(tokens.length).toBe(8);
    expect(tokens[0]).toBe("src/main.ts");
  });

  it("accepts extensionless paths with a slash", () => {
    expect(extractFileReferenceTokens("查看 @src/utils 目录")).toEqual(["src/utils"]);
  });
});

describe("resolveFileReferences", () => {
  it("attaches readable files and reports what was attached", async () => {
    const result = await resolveFileReferences("总结 @src/app.ts 的结构", async (path) => ({
      path,
      language: "typescript",
      content: "export const app = 1;",
      bytes: 22,
    }));
    expect(result.attached).toEqual(["src/app.ts"]);
    expect(result.text).toContain("[Attached workspace files for context]");
    expect(result.text).toContain("--- @src/app.ts (typescript) ---");
    expect(result.text).toContain("export const app = 1;");
  });

  it("keeps tokens that do not resolve to workspace files", async () => {
    const result = await resolveFileReferences("问一下 @someone 和 @missing.ts", async () => {
      throw new Error("not found");
    });
    expect(result.attached).toEqual([]);
    expect(result.text).toBe("问一下 @someone 和 @missing.ts");
  });

  it("truncates oversized file content", async () => {
    const result = await resolveFileReferences("看 @big.log", async (path) => ({
      path,
      language: "plaintext",
      content: "x".repeat(30_000),
      bytes: 30_000,
    }));
    expect(result.text).toContain("已截断");
    expect(result.text.length).toBeLessThan(26_000);
  });
});
