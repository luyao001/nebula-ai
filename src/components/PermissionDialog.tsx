import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp, ShieldAlert } from "lucide-react";
import type {
  FetchUrlDetails,
  PermissionDecision,
  PreparedToolCall,
  RunCommandDetails,
  WriteFileDetails,
} from "../tools/gateway";
import { computeLineDiff } from "../lib/diff";

type PermissionDialogProps = {
  request: PreparedToolCall;
  onDecision: (decision: PermissionDecision) => void;
};

const DIFF_LINE_NOTE = "diff 仅显示前 400 行，计数基于完整对比结果。";

function WriteFilePreview({ details }: { details: WriteFileDetails }) {
  const diff = useMemo(
    () => computeLineDiff(details.oldContent ?? "", details.newContent),
    [details.oldContent, details.newContent],
  );
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? diff.lines : diff.lines.slice(0, 120);

  return (
    <div className="nf-tool-preview">
      <div className="nf-tool-preview-meta">
        <strong title={details.path}>{details.path}</strong>
        <span>
          {details.scope === "workspace" ? "工作目录" : "临时沙盒"}
          {" · "}
          {details.isNewFile
            ? "新建文件"
            : details.oldOmitted
              ? "原文件超过 256 KiB，跳过逐行对比"
              : `+${diff.added} 行 / -${diff.removed} 行`}
          {diff.truncated ? " · 存在更多差异行" : ""}
          {" · "}
          {details.byteSize.toLocaleString()} 字节
        </span>
      </div>
      <div className="nf-diff-lines">
        {visible.map((line, index) => (
          <div key={index} className={"nf-diff-line " + line.kind}>
            <span aria-hidden="true">{line.kind === "add" ? "+" : line.kind === "del" ? "-" : " "}</span>
            <code>{line.text || " "}</code>
          </div>
        ))}
        {!visible.length && <p className="nf-diff-empty">内容为空。</p>}
      </div>
      {diff.lines.length > 120 && (
        <button type="button" className="nf-tool-preview-toggle" onClick={() => setShowAll((value) => !value)}>
          {showAll ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          {showAll ? "收起 diff" : `展开剩余 ${diff.lines.length - visible.length} 行`}
        </button>
      )}
      {diff.truncated && <small>{DIFF_LINE_NOTE}</small>}
    </div>
  );
}

function RunCommandPreview({ details }: { details: RunCommandDetails }) {
  return (
    <div className="nf-tool-preview">
      <div className="nf-tool-preview-meta">
        <strong>{details.program} {details.args.join(" ")}</strong>
        <span>超时 {Math.round(details.timeoutMs / 1000)}s</span>
      </div>
      <p className="nf-allow-reason">{details.allowReason}</p>
      <dl className="nf-command-facts">
        <div>
          <dt>可执行文件</dt>
          <dd title={details.executable}>{details.executable}</dd>
        </div>
        <div>
          <dt>工作目录</dt>
          <dd title={details.cwd}>{details.cwd}</dd>
        </div>
      </dl>
    </div>
  );
}

function FetchUrlPreview({ details }: { details: FetchUrlDetails }) {
  return (
    <div className="nf-tool-preview">
      <div className="nf-tool-preview-meta">
        <strong>{details.host}</strong>
        <span>{details.origin}</span>
      </div>
      <dl className="nf-command-facts">
        <div>
          <dt>目标地址</dt>
          <dd title={details.url}>{details.url}</dd>
        </div>
        <div>
          <dt>DNS 解析</dt>
          <dd>
            {details.resolved.join("、") || "（无返回地址）"}
            {details.resolvedCount > details.resolved.length
              ? ` 等 ${details.resolvedCount} 个地址`
              : ""}
          </dd>
        </div>
      </dl>
    </div>
  );
}

function ToolPreview({ request }: { request: PreparedToolCall }) {
  if (request.details?.kind === "write_file") return <WriteFilePreview details={request.details} />;
  if (request.details?.kind === "run_command") return <RunCommandPreview details={request.details} />;
  if (request.details?.kind === "fetch_url") return <FetchUrlPreview details={request.details} />;
  return <pre>{request.display}</pre>;
}

export function PermissionDialog({ request, onDecision }: PermissionDialogProps) {
  return (
    <div className="nf-modal-backdrop" role="presentation">
      <section className="nf-permission-dialog" role="dialog" aria-modal="true" aria-labelledby="permission-title">
        <div className="nf-permission-heading">
          <span><ShieldAlert size={20} /></span>
          <div>
            <small>AGENT PERMISSION</small>
            <h2 id="permission-title">允许执行 {request.toolName}？</h2>
          </div>
        </div>
        <div className="nf-permission-risk">{request.risk}</div>
        <ToolPreview request={request} />
        <div className="nf-permission-actions">
          <button className="danger" onClick={() => onDecision("deny")}>拒绝</button>
          {request.canAllowSession && (
            <button onClick={() => onDecision("allow_session")}>本会话始终允许</button>
          )}
          <button className="primary" onClick={() => onDecision("allow_once")}>本次允许</button>
        </div>
      </section>
    </div>
  );
}
