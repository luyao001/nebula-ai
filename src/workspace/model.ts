export const classifyGitDiffLine = (line: string) => {
  if (line.startsWith("@@")) return "hunk";
  if (line.startsWith("diff --git") || line.startsWith("# ")) return "header";
  if (line.startsWith("+") && !line.startsWith("+++")) return "add";
  if (line.startsWith("-") && !line.startsWith("---")) return "del";
  return "context";
};

export const gitStatusLabel = (status: string) => {
  if (status === "??") return "新增";
  if (status.includes("A")) return "新增";
  if (status.includes("D")) return "删除";
  if (status.includes("R")) return "重命名";
  if (status.includes("M")) return "修改";
  return status.trim() || "变更";
};

export const formatFileSize = (bytes: number | null) => {
  if (bytes === null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};
