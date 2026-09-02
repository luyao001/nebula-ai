import { describe, expect, it } from "vitest";
import { classifyGitDiffLine, formatFileSize, gitStatusLabel } from "../src/workspace/model";

describe("workspace presentation model", () => {
  it("classifies unified diff lines without treating file headers as changes", () => {
    expect(classifyGitDiffLine("+++ b/src/App.tsx")).toBe("context");
    expect(classifyGitDiffLine("+const ready = true")).toBe("add");
    expect(classifyGitDiffLine("-const ready = false")).toBe("del");
    expect(classifyGitDiffLine("@@ -1 +1 @@")).toBe("hunk");
  });

  it("labels porcelain statuses and formats file sizes", () => {
    expect(gitStatusLabel("??")).toBe("新增");
    expect(gitStatusLabel(" M")).toBe("修改");
    expect(formatFileSize(1536)).toBe("1.5 KB");
  });
});
