import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

export type WorkspaceInfo = {
  workspacePath: string;
  sandboxPath: string;
};

export type WriteFileDetails = {
  kind: "write_file";
  path: string;
  scope: string;
  isNewFile: boolean;
  byteSize: number;
  oldContent: string | null;
  oldOmitted: boolean;
  newContent: string;
};

export type RunCommandDetails = {
  kind: "run_command";
  program: string;
  args: string[];
  executable: string;
  cwd: string;
  timeoutMs: number;
  allowReason: string;
};

export type FetchUrlDetails = {
  kind: "fetch_url";
  url: string;
  host: string;
  origin: string;
  resolved: string[];
  resolvedCount: number;
};

export type ToolCallDetails = WriteFileDetails | RunCommandDetails | FetchUrlDetails;

export type PreparedToolCall = {
  requestId: string;
  toolName: string;
  display: string;
  risk: string;
  requiresConfirmation: boolean;
  canAllowSession: boolean;
  details: ToolCallDetails | null;
};

export type PermissionDecision = "allow_once" | "allow_session" | "deny";

export type ToolExecutionResult = {
  ok: boolean;
  content: string;
  metadata: Record<string, unknown>;
};

export const selectWorkspaceRoot = async () => {
  const selected = await open({ directory: true, multiple: false, title: "选择 Agent 工作目录" });
  if (!selected || Array.isArray(selected)) return null;
  return invoke<WorkspaceInfo>("authorize_workspace_root", { path: selected });
};

export const getWorkspaceStatus = () =>
  invoke<WorkspaceInfo | null>("workspace_status");

export const prepareGatewayToolCall = (toolName: string, argumentsValue: unknown) =>
  invoke<PreparedToolCall>("prepare_tool_call", {
    toolName,
    arguments: argumentsValue,
  });

export const resolveGatewayPermission = (requestId: string, decision: PermissionDecision) =>
  invoke<{ approved: boolean }>("resolve_tool_permission", { requestId, decision });

export const executeGatewayToolCall = (requestId: string) =>
  invoke<ToolExecutionResult>("execute_tool_call", { requestId });
