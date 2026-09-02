import { useMemo, useState } from "react";
import { Archive, FileCode2, RefreshCw, Search } from "lucide-react";
import type { TaskSummary } from "../agent/task-store";

type TaskHistoryProps = {
  tasks: TaskSummary[];
  error: string;
  onRefresh: () => void;
  onOpen: (taskId: string) => void;
};

type StatusFilter = "all" | "completed" | "error" | "stopped";

const STATUS_LABEL: Record<StatusFilter, string> = {
  all: "全部状态",
  completed: "成功",
  error: "失败",
  stopped: "中断",
};

const formatTime = (timestamp: number) => {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleString(undefined, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
};

export function TaskHistory({ tasks, error, onRefresh, onOpen }: TaskHistoryProps) {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [keyword, setKeyword] = useState("");

  const visibleTasks = useMemo(() => {
    const query = keyword.trim().toLowerCase();
    return tasks.filter((task) => {
      if (statusFilter !== "all" && task.status !== statusFilter) return false;
      if (query && !task.title.toLowerCase().includes(query) && !task.model.toLowerCase().includes(query)) {
        return false;
      }
      return true;
    });
  }, [tasks, statusFilter, keyword]);

  return (
    <details className="nf-task-history">
      <summary><Archive size={13} /> 任务历史 <span>{tasks.length}</span></summary>
      <div className="nf-task-history-actions">
        <div className="nf-task-search">
          <Search size={11} />
          <input
            type="search"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="搜索任务标题或模型"
            aria-label="搜索任务历史"
          />
        </div>
        <div className="nf-task-filter-row">
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
            aria-label="按状态筛选任务"
          >
            {(Object.keys(STATUS_LABEL) as StatusFilter[]).map((value) => (
              <option key={value} value={value}>{STATUS_LABEL[value]}</option>
            ))}
          </select>
          <button type="button" onClick={onRefresh}><RefreshCw size={12} /> 刷新</button>
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="nf-task-list">
        {visibleTasks.map((task) => (
          <button key={task.taskId} type="button" onClick={() => onOpen(task.taskId)}>
            <FileCode2 size={13} />
            <span>
              <strong>{task.title}</strong>
              <small>
                {task.mode} · {task.status} · {formatTime(task.updatedAt)}
                {task.hasArtifact ? " · 有产物" : ""}
              </small>
            </span>
          </button>
        ))}
        {!visibleTasks.length && !error && (
          <p>{tasks.length ? "没有符合筛选条件的任务。" : "还没有 Agent 任务快照。"}</p>
        )}
      </div>
    </details>
  );
}
