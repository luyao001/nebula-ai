import { useEffect, useState } from "react";
import { CheckCircle2, GitBranch, GitCompareArrows, LoaderCircle, RefreshCw } from "lucide-react";
import { getWorkspaceGitReview } from "../workspace/api";
import type { GitReview } from "../workspace/api";
import { classifyGitDiffLine, gitStatusLabel } from "../workspace/model";

export function GitReviewPanel({ workspacePath }: { workspacePath: string }) {
  const [review, setReview] = useState<GitReview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = async () => {
    setLoading(true);
    setError("");
    try {
      setReview(await getWorkspaceGitReview());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, [workspacePath]);

  if (loading) {
    return <div className="nf-review-state"><LoaderCircle size={18} className="is-spinning" /> 正在读取 Git 状态</div>;
  }
  if (error) {
    return <div className="nf-review-state error"><GitCompareArrows size={20} /><strong>无法生成审查</strong><p>{error}</p><button onClick={() => void refresh()}>重试</button></div>;
  }
  if (!review?.isRepository) {
    return <div className="nf-review-state"><GitCompareArrows size={24} /><strong>当前目录不是 Git 仓库</strong><p>文件浏览和搜索仍然可用；初始化 Git 后可在这里集中审查改动。</p></div>;
  }

  return (
    <section className="nf-git-review" aria-label="Git 改动审查">
      <header>
        <div><GitBranch size={13} /><span>{review.branch || "detached HEAD"}</span><b>{review.files.length} 个改动文件</b></div>
        <button type="button" onClick={() => void refresh()}><RefreshCw size={12} /> 刷新</button>
      </header>
      {!review.files.length ? (
        <div className="nf-review-clean"><CheckCircle2 size={28} /><strong>工作区干净</strong><p>当前没有已暂存、未暂存或未跟踪改动。</p></div>
      ) : (
        <div className="nf-review-layout">
          <aside>
            {review.files.map((file) => (
              <div key={`${file.status}:${file.path}`}>
                <b>{gitStatusLabel(file.status)}</b>
                <span title={file.path}>{file.path}</span>
              </div>
            ))}
          </aside>
          <div className="nf-unified-diff" tabIndex={0}>
            {review.diff ? review.diff.split("\n").map((line, index) => (
              <div key={index} className={classifyGitDiffLine(line)}>
                <span>{index + 1}</span><code>{line || " "}</code>
              </div>
            )) : (
              <p>未跟踪文件不会自动读取内容；先暂存后即可查看统一 diff。</p>
            )}
            {review.truncated && <div className="truncated">审查内容已达到安全显示上限。</div>}
          </div>
        </div>
      )}
    </section>
  );
}
