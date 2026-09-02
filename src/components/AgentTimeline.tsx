import { useState } from "react";
import {
  Ban,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleDashed,
  Clock3,
  RotateCcw,
  ShieldAlert,
  Wrench,
} from "lucide-react";
import type { AgentPlanStep, AgentState, AgentTimelineItem, AgentUsage } from "../agent/types";

type AgentTimelineProps = {
  state: AgentState;
  plan: AgentPlanStep[];
  items: AgentTimelineItem[];
  usage: AgentUsage | null;
  canRetry: boolean;
  onRetry: () => void;
};

const formatTokens = (value: number) =>
  value >= 100_000
    ? `${(value / 1000).toFixed(0)}k`
    : value >= 10_000
      ? `${(value / 1000).toFixed(1)}k`
      : String(value);

const iconFor = (item: AgentTimelineItem) => {
  if (item.kind === "permission") return <ShieldAlert size={14} />;
  if (item.kind === "tool") return <Wrench size={14} />;
  if (item.kind === "stopped") return <Ban size={14} />;
  if (item.status === "success") return <CheckCircle2 size={14} />;
  if (item.status === "waiting") return <Clock3 size={14} />;
  if (item.status === "error") return <CircleDashed size={14} />;
  return <CircleDashed size={14} />;
};

const USAGE_LABEL: Record<AgentState, string> = {
  idle: "待命",
  planning: "制定计划",
  model_streaming: "模型思考中",
  awaiting_permission: "等待授权",
  running_tool: "执行工具",
  observing: "观察结果",
  self_check: "网页自检",
  completed: "已完成",
  stopped: "已中断",
  error: "执行失败",
  awaiting_user: "等待下一步",
};

function TimelineEntry({ item }: { item: AgentTimelineItem }) {
  const [expanded, setExpanded] = useState(false);
  const [showResult, setShowResult] = useState(false);
  const hasIssues = Boolean(item.issues?.length);
  const hasResult = Boolean(item.result);

  return (
    <article className={item.status + (expanded ? " expanded" : "")}>
      <span>{iconFor(item)}</span>
      <div>
        <strong>{item.title}</strong>
        {item.detail && (
          <p className={expanded ? "" : "clamped"}>{item.detail}</p>
        )}
        {hasIssues && (
          <ul className="nf-agent-issues">
            {item.issues!.slice(0, expanded ? undefined : 3).map((issue, index) => (
              <li key={index} className={issue.severity}>
                {issue.severity === "error" ? "错误" : "警告"}
                <em>{issue.message}</em>
              </li>
            ))}
          </ul>
        )}
        {hasIssues && item.issues!.length > 3 && !expanded && (
          <button type="button" className="nf-agent-more" onClick={() => setExpanded(true)}>
            还有 {item.issues!.length - 3} 条诊断
          </button>
        )}
        {hasResult && (
          <>
            <button type="button" className="nf-agent-more" onClick={() => setShowResult((value) => !value)}>
              {showResult ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
              {showResult ? "收起工具输出" : "查看工具输出"}
            </button>
            {showResult && <pre className="nf-agent-result">{item.result}</pre>}
          </>
        )}
      </div>
    </article>
  );
}

export function AgentTimeline({ state, plan, items, usage, canRetry, onRetry }: AgentTimelineProps) {
  return (
    <section className="nf-agent-panel" aria-label="Agent 执行过程">
      <div className="nf-agent-panel-heading">
        <span>AGENT RUN</span>
        <strong>{USAGE_LABEL[state] ?? state.replace(/_/g, " ")}</strong>
        {usage && (
          <span
            className="nf-agent-usage"
            title="本次任务累计 token 用量（输入/输出）"
          >
            ↑{formatTokens(usage.inputTokens)} · ↓{formatTokens(usage.outputTokens)} tok
          </span>
        )}
      </div>
      {plan.length > 0 && (
        <ol className="nf-agent-plan">
          {plan.map((step) => (
            <li key={step.id} className={step.status}>
              <span />
              {step.title}
            </li>
          ))}
        </ol>
      )}
      <div className="nf-agent-timeline">
        {items.map((item) => (
          <TimelineEntry key={item.id} item={item} />
        ))}
      </div>
      {canRetry && (
        <div className="nf-agent-actions">
          <button type="button" onClick={onRetry}>
            <RotateCcw size={12} /> 用同一任务重试
          </button>
        </div>
      )}
    </section>
  );
}
