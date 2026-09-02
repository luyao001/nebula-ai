export type DiffLineKind = "same" | "add" | "del" | "skip";

export type DiffLine = {
  kind: DiffLineKind;
  text: string;
};

export type DiffResult = {
  lines: DiffLine[];
  added: number;
  removed: number;
  /** Output was cut to the display cap; counts still reflect the full diff. */
  truncated: boolean;
  /** LCS was skipped because the inputs were too large to diff line-by-line. */
  oversized: boolean;
};

const MAX_DIFF_LINES = 400;
const MAX_LCS_CELLS = 250_000;
const CONTEXT_LINES = 3;

const buildLcsOps = (oldLines: string[], newLines: string[]): DiffLine[] => {
  const rows = oldLines.length + 1;
  const cols = newLines.length + 1;
  const table = new Int32Array(rows * cols);
  for (let i = oldLines.length - 1; i >= 0; i -= 1) {
    for (let j = newLines.length - 1; j >= 0; j -= 1) {
      table[i * cols + j] =
        oldLines[i] === newLines[j]
          ? table[(i + 1) * cols + (j + 1)] + 1
          : Math.max(table[(i + 1) * cols + j], table[i * cols + (j + 1)]);
    }
  }

  const ops: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < oldLines.length && j < newLines.length) {
    if (oldLines[i] === newLines[j]) {
      ops.push({ kind: "same", text: oldLines[i] });
      i += 1;
      j += 1;
    } else if (table[(i + 1) * cols + j] >= table[i * cols + (j + 1)]) {
      ops.push({ kind: "del", text: oldLines[i] });
      i += 1;
    } else {
      ops.push({ kind: "add", text: newLines[j] });
      j += 1;
    }
  }
  while (i < oldLines.length) {
    ops.push({ kind: "del", text: oldLines[i] });
    i += 1;
  }
  while (j < newLines.length) {
    ops.push({ kind: "add", text: newLines[j] });
    j += 1;
  }
  return ops;
};

const contextualizeOps = (ops: DiffLine[]) => {
  if (ops.length <= MAX_DIFF_LINES) return { lines: ops, collapsed: false };
  const selected = new Set<number>();
  ops.forEach((op, index) => {
    if (op.kind === "same") return;
    const start = Math.max(0, index - CONTEXT_LINES);
    const end = Math.min(ops.length - 1, index + CONTEXT_LINES);
    for (let cursor = start; cursor <= end; cursor += 1) selected.add(cursor);
  });
  if (!selected.size) {
    return { lines: ops.slice(0, MAX_DIFF_LINES), collapsed: true };
  }

  const indices = [...selected].sort((left, right) => left - right);
  const contextual: DiffLine[] = [];
  let previous = -1;
  for (const index of indices) {
    if (index > previous + 1) {
      contextual.push({
        kind: "skip",
        text: `… 省略 ${index - previous - 1} 行未改内容 …`,
      });
    }
    contextual.push(ops[index]);
    previous = index;
  }
  if (previous < ops.length - 1) {
    contextual.push({
      kind: "skip",
      text: `… 省略 ${ops.length - previous - 1} 行未改内容 …`,
    });
  }
  if (contextual.length <= MAX_DIFF_LINES) {
    return { lines: contextual, collapsed: true };
  }

  const headSize = Math.floor((MAX_DIFF_LINES - 1) / 2);
  const tailSize = MAX_DIFF_LINES - headSize - 1;
  return {
    lines: [
      ...contextual.slice(0, headSize),
      { kind: "skip" as const, text: "… 差异过大，中间部分已省略 …" },
      ...contextual.slice(-tailSize),
    ],
    collapsed: true,
  };
};

export const computeLineDiff = (oldText: string, newText: string): DiffResult => {
  const oldLines = oldText ? oldText.split("\n") : [];
  const newLines = newText ? newText.split("\n") : [];
  const oversized = oldLines.length * newLines.length > MAX_LCS_CELLS;
  const ops = oversized
    ? [
        ...oldLines.map((text): DiffLine => ({ kind: "del", text })),
        ...newLines.map((text): DiffLine => ({ kind: "add", text })),
      ]
    : buildLcsOps(oldLines, newLines);

  let added = 0;
  let removed = 0;
  for (const op of ops) {
    if (op.kind === "add") added += 1;
    else if (op.kind === "del") removed += 1;
  }
  const display = contextualizeOps(ops);
  return {
    lines: display.lines,
    added,
    removed,
    truncated: display.collapsed,
    oversized,
  };
};
