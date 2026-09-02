mod execute;
mod policy;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    sync::Mutex,
    time::{Duration, SystemTime},
};
use uuid::Uuid;

#[derive(Clone)]
pub(crate) struct GatewayRoots {
    pub workspace: PathBuf,
    pub sandbox: PathBuf,
}

struct PendingCall {
    tool_name: String,
    arguments: Value,
    approved: bool,
    grant_key: Option<String>,
    can_allow_session: bool,
}

#[derive(Default)]
struct GatewayInner {
    roots: Option<GatewayRoots>,
    pending: HashMap<String, PendingCall>,
    session_grants: HashSet<String>,
    sandboxes: HashSet<PathBuf>,
}

#[derive(Default)]
pub struct ToolGatewayState {
    inner: Mutex<GatewayInner>,
}

impl Drop for ToolGatewayState {
    fn drop(&mut self) {
        if let Ok(inner) = self.inner.lock() {
            for sandbox in &inner.sandboxes {
                let _ = std::fs::remove_dir_all(sandbox);
            }
        }
    }
}

impl ToolGatewayState {
    pub(crate) fn workspace_root(&self) -> Option<PathBuf> {
        self.inner
            .lock()
            .ok()
            .and_then(|inner| inner.roots.as_ref().map(|roots| roots.workspace.clone()))
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceInfo {
    workspace_path: String,
    sandbox_path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparedToolCall {
    request_id: String,
    tool_name: String,
    display: String,
    risk: String,
    requires_confirmation: bool,
    can_allow_session: bool,
    details: Option<Value>,
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PermissionDecision {
    AllowOnce,
    AllowSession,
    Deny,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionResolution {
    approved: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolExecutionResult {
    pub ok: bool,
    pub content: String,
    pub metadata: Value,
}

fn lock_error() -> String {
    "工具网关状态不可用。".to_string()
}

fn cleanup_stale_sandboxes(base: &Path) {
    const MAX_AGE: Duration = Duration::from_secs(7 * 24 * 60 * 60);
    let Ok(entries) = std::fs::read_dir(base) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let is_managed_directory = entry
            .file_name()
            .to_str()
            .and_then(|name| Uuid::parse_str(name).ok())
            .is_some()
            && path.is_dir();
        let is_stale = entry
            .metadata()
            .ok()
            .and_then(|metadata| metadata.modified().ok())
            .and_then(|modified| SystemTime::now().duration_since(modified).ok())
            .is_some_and(|age| age >= MAX_AGE);
        if is_managed_directory && is_stale {
            let _ = std::fs::remove_dir_all(path);
        }
    }
}

#[tauri::command]
pub fn authorize_workspace_root(
    path: String,
    state: tauri::State<'_, ToolGatewayState>,
) -> Result<WorkspaceInfo, String> {
    let workspace = PathBuf::from(path)
        .canonicalize()
        .map_err(|_| "无法访问所选工作目录。".to_string())?;
    if !workspace.is_dir() {
        return Err("所选路径不是目录。".to_string());
    }

    let sandbox_base = std::env::temp_dir().join("nebula-ai-agent");
    std::fs::create_dir_all(&sandbox_base)
        .map_err(|_| "无法创建 Agent 临时沙盒根目录。".to_string())?;
    cleanup_stale_sandboxes(&sandbox_base);
    let sandbox = sandbox_base.join(Uuid::new_v4().to_string());
    std::fs::create_dir_all(&sandbox).map_err(|_| "无法创建 Agent 临时沙盒。".to_string())?;
    let sandbox = sandbox
        .canonicalize()
        .map_err(|_| "无法初始化 Agent 临时沙盒。".to_string())?;

    let mut inner = state.inner.lock().map_err(|_| lock_error())?;
    inner.roots = Some(GatewayRoots {
        workspace: workspace.clone(),
        sandbox: sandbox.clone(),
    });
    inner.sandboxes.insert(sandbox.clone());
    inner.pending.clear();
    inner.session_grants.clear();

    Ok(WorkspaceInfo {
        workspace_path: workspace.to_string_lossy().into_owned(),
        sandbox_path: sandbox.to_string_lossy().into_owned(),
    })
}

#[tauri::command]
pub fn workspace_status(
    state: tauri::State<'_, ToolGatewayState>,
) -> Result<Option<WorkspaceInfo>, String> {
    let inner = state.inner.lock().map_err(|_| lock_error())?;
    Ok(inner.roots.as_ref().map(|roots| WorkspaceInfo {
        workspace_path: roots.workspace.to_string_lossy().into_owned(),
        sandbox_path: roots.sandbox.to_string_lossy().into_owned(),
    }))
}

#[tauri::command]
pub fn prepare_tool_call(
    tool_name: String,
    arguments: Value,
    state: tauri::State<'_, ToolGatewayState>,
) -> Result<PreparedToolCall, String> {
    let mut inner = state.inner.lock().map_err(|_| lock_error())?;
    let roots = inner
        .roots
        .clone()
        .ok_or_else(|| "请先选择并授权一个工作目录。".to_string())?;
    let checked = policy::validate_and_describe(&tool_name, arguments, &roots)?;
    let approved_by_session = checked
        .grant_key
        .as_ref()
        .is_some_and(|key| inner.session_grants.contains(key));
    let approved = !checked.requires_confirmation || approved_by_session;
    let request_id = Uuid::new_v4().to_string();

    inner.pending.insert(
        request_id.clone(),
        PendingCall {
            tool_name: tool_name.clone(),
            arguments: checked.arguments,
            approved,
            grant_key: checked.grant_key,
            can_allow_session: checked.can_allow_session,
        },
    );

    Ok(PreparedToolCall {
        request_id,
        tool_name,
        display: checked.display,
        risk: checked.risk,
        requires_confirmation: !approved,
        can_allow_session: checked.can_allow_session,
        details: checked.details,
    })
}

#[tauri::command]
pub fn resolve_tool_permission(
    request_id: String,
    decision: PermissionDecision,
    state: tauri::State<'_, ToolGatewayState>,
) -> Result<PermissionResolution, String> {
    let mut inner = state.inner.lock().map_err(|_| lock_error())?;
    if matches!(decision, PermissionDecision::Deny) {
        inner.pending.remove(&request_id);
        return Ok(PermissionResolution { approved: false });
    }

    let (grant_key, can_allow_session) = {
        let pending = inner
            .pending
            .get_mut(&request_id)
            .ok_or_else(|| "工具请求已失效。".to_string())?;
        if matches!(decision, PermissionDecision::AllowSession) && !pending.can_allow_session {
            return Err("此工具必须逐次确认。".to_string());
        }
        pending.approved = true;
        (pending.grant_key.clone(), pending.can_allow_session)
    };

    if matches!(decision, PermissionDecision::AllowSession) && can_allow_session {
        if let Some(key) = grant_key {
            inner.session_grants.insert(key);
        }
    }
    Ok(PermissionResolution { approved: true })
}

#[tauri::command]
pub async fn execute_tool_call(
    request_id: String,
    state: tauri::State<'_, ToolGatewayState>,
) -> Result<ToolExecutionResult, String> {
    let (pending, roots) = {
        let mut inner = state.inner.lock().map_err(|_| lock_error())?;
        let pending = inner
            .pending
            .remove(&request_id)
            .ok_or_else(|| "工具请求已失效或已执行。".to_string())?;
        if !pending.approved {
            return Err("工具请求尚未获得用户授权。".to_string());
        }
        let roots = inner
            .roots
            .clone()
            .ok_or_else(|| "工作目录授权已失效。".to_string())?;
        (pending, roots)
    };

    tauri::async_runtime::spawn_blocking(move || {
        execute::execute(&pending.tool_name, &pending.arguments, &roots)
    })
    .await
    .map_err(|_| "工具执行线程异常终止。".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn permission_decision_names_are_stable() {
        let value: PermissionDecision = serde_json::from_str("\"allow_once\"").unwrap();
        assert!(matches!(value, PermissionDecision::AllowOnce));
    }
}
