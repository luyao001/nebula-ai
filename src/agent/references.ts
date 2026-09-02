import type { WorkspaceFileContent } from "../workspace/api";

const MAX_REFERENCES = 8;
const MAX_REFERENCE_CHARS = 24_000;

// @token must look path-like: contain a slash or end with a file extension,
// so chat mentions such as "@someone" stay literal text.
const REFERENCE_PATTERN = /@([A-Za-z0-9][A-Za-z0-9_.\-/\\]{0,199})/g;

export const extractFileReferenceTokens = (text: string): string[] => {
  const tokens: string[] = [];
  for (const match of text.matchAll(REFERENCE_PATTERN)) {
    const token = match[1];
    const start = match.index ?? 0;
    if (start > 0 && /[\w.@]/.test(text[start - 1] ?? "")) continue;
    if (!token.includes("/") && !/\.[A-Za-z0-9]+$/.test(token)) continue;
    if (!tokens.includes(token)) tokens.push(token);
    if (tokens.length >= MAX_REFERENCES) break;
  }
  return tokens;
};

type FileReader = (path: string) => Promise<WorkspaceFileContent>;

const blockFor = (file: WorkspaceFileContent) => {
  const content =
    file.content.length > MAX_REFERENCE_CHARS
      ? `${file.content.slice(0, MAX_REFERENCE_CHARS)}\n…（已截断，原文共 ${file.content.length} 字符）`
      : file.content;
  return `--- @${file.path} (${file.language}) ---\n${content}`;
};

export const resolveFileReferences = async (
  text: string,
  readFile: FileReader,
): Promise<{ text: string; attached: string[] }> => {
  const tokens = extractFileReferenceTokens(text);
  if (!tokens.length) return { text, attached: [] };
  const blocks: string[] = [];
  const attached: string[] = [];
  for (const token of tokens) {
    try {
      const file = await readFile(token);
      blocks.push(blockFor(file));
      attached.push(file.path);
    } catch {
      // Not a workspace file (typo, mention, or unauthorized path): keep as typed.
    }
  }
  if (!blocks.length) return { text, attached: [] };
  return {
    text: `${text}\n\n[Attached workspace files for context]\n${blocks.join("\n\n")}`,
    attached,
  };
};
