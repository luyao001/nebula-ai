import { useEffect, useRef, useState } from "react";
import {
  Braces,
  File,
  FileSearch,
  Folder,
  LoaderCircle,
  RefreshCw,
  Search,
} from "lucide-react";
import {
  listWorkspaceEntries,
  readWorkspaceFile,
  searchWorkspace,
} from "../workspace/api";
import type {
  WorkspaceEntry,
  WorkspaceFileContent,
  WorkspaceSearchResult,
} from "../workspace/api";
import { formatFileSize } from "../workspace/model";

type WorkspaceExplorerProps = {
  workspacePath: string;
  onReference: (path: string) => void;
};

export function WorkspaceExplorer({ workspacePath, onReference }: WorkspaceExplorerProps) {
  const [entries, setEntries] = useState<WorkspaceEntry[]>([]);
  const [indexTruncated, setIndexTruncated] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<WorkspaceSearchResult[]>([]);
  const [searchMeta, setSearchMeta] = useState("");
  const [selected, setSelected] = useState<WorkspaceFileContent | null>(null);
  const [selectedLine, setSelectedLine] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const searchSequence = useRef(0);

  const refresh = async () => {
    setLoading(true);
    setError("");
    try {
      const index = await listWorkspaceEntries();
      setEntries(index.entries);
      setIndexTruncated(index.truncated);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setSelected(null);
    setQuery("");
    void refresh();
  }, [workspacePath]);

  useEffect(() => {
    const normalized = query.trim();
    searchSequence.current += 1;
    const sequence = searchSequence.current;
    if (normalized.length < 2) {
      setResults([]);
      setSearchMeta("");
      return;
    }
    const timeoutId = window.setTimeout(() => {
      void searchWorkspace(normalized)
        .then((response) => {
          if (sequence !== searchSequence.current) return;
          setResults(response.results);
          setSearchMeta(
            `${response.results.length} 个命中 · 扫描 ${response.inspectedFiles} 个文本文件${response.truncated ? " · 已达上限" : ""}`,
          );
        })
        .catch((reason) => {
          if (sequence !== searchSequence.current) return;
          setResults([]);
          setSearchMeta(reason instanceof Error ? reason.message : String(reason));
        });
    }, 260);
    return () => window.clearTimeout(timeoutId);
  }, [query]);

  const openFile = async (path: string, line: number | null = null) => {
    setError("");
    try {
      const content = await readWorkspaceFile(path);
      setSelected(content);
      setSelectedLine(line);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  return (
    <section className="nf-repo-lens" aria-label="工作区文件">
      <aside className="nf-repo-rail">
        <div className="nf-repo-search">
          <Search size={13} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索路径或文件内容"
            aria-label="搜索工作区"
          />
          <button type="button" onClick={() => void refresh()} title="刷新文件索引" aria-label="刷新文件索引">
            <RefreshCw size={12} className={loading ? "is-spinning" : ""} />
          </button>
        </div>
        <div className="nf-repo-scope" title={workspacePath}>
          <Folder size={12} />
          <span>{workspacePath}</span>
        </div>
        {searchMeta && <small className="nf-repo-search-meta">{searchMeta}</small>}
        {error && <p className="nf-repo-error">{error}</p>}
        <div className="nf-repo-tree">
          {loading ? (
            <p className="nf-repo-loading"><LoaderCircle size={14} className="is-spinning" /> 正在建立索引</p>
          ) : query.trim().length >= 2 ? (
            results.map((result, index) => (
              <button
                type="button"
                key={`${result.path}:${result.line ?? "path"}:${index}`}
                className={selected?.path === result.path ? "active search-result" : "search-result"}
                onClick={() => void openFile(result.path, result.line)}
              >
                <FileSearch size={12} />
                <span>
                  <strong>{result.path}{result.line ? `:${result.line}` : ""}</strong>
                  <small>{result.preview}</small>
                </span>
              </button>
            ))
          ) : (
            entries.map((entry) =>
              entry.kind === "directory" ? (
                <div
                  key={entry.path}
                  className="nf-repo-directory"
                  style={{ paddingLeft: `${12 + entry.depth * 13}px` }}
                >
                  <Folder size={12} /> <span>{entry.name}</span>
                </div>
              ) : (
                <button
                  type="button"
                  key={entry.path}
                  className={selected?.path === entry.path ? "active" : ""}
                  style={{ paddingLeft: `${12 + entry.depth * 13}px` }}
                  onClick={() => void openFile(entry.path)}
                >
                  <File size={11} />
                  <span>{entry.name}</span>
                  <small>{formatFileSize(entry.bytes)}</small>
                </button>
              ),
            )
          )}
          {!loading && query.trim().length >= 2 && !results.length && !searchMeta.includes("扫描") && (
            <p className="nf-repo-loading">正在搜索…</p>
          )}
          {!loading && query.trim().length >= 2 && !results.length && searchMeta.includes("扫描") && (
            <p className="nf-repo-loading">没有找到匹配内容。</p>
          )}
        </div>
        {indexTruncated && <small className="nf-repo-cap">大型仓库：文件树仅显示前 1,600 项</small>}
      </aside>

      <div className="nf-repo-reader">
        {selected ? (
          <>
            <header>
              <div>
                <Braces size={13} />
                <span title={selected.path}>{selected.path}</span>
                {selectedLine && <b>第 {selectedLine} 行</b>}
              </div>
              <div>
                <small>{selected.language} · {formatFileSize(selected.bytes)}</small>
                <button type="button" onClick={() => onReference(selected.path)}>引用到任务</button>
              </div>
            </header>
            <pre tabIndex={0}><code>{selected.content}</code></pre>
          </>
        ) : (
          <div className="nf-repo-reader-empty">
            <FileSearch size={26} />
            <span>REPOSITORY INTELLIGENCE</span>
            <h2>从仓库上下文开始</h2>
            <p>打开文件进行只读检查，或搜索代码内容并把路径引用到下一条任务中。</p>
          </div>
        )}
      </div>
    </section>
  );
}
