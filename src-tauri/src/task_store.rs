use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf};
use tauri::Manager;

const MAX_PLAN_STEPS: usize = 12;
const MAX_TOOL_LOG_ITEMS: usize = 500;
const MAX_ARTIFACT_BYTES: usize = 2 * 1024 * 1024;
const MAX_USAGE_TOKENS: u64 = 100_000_000;

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TaskPlanStep {
    id: String,
    title: String,
    status: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TaskToolLogItem {
    id: String,
    kind: String,
    title: String,
    detail: Option<String>,
    status: String,
    timestamp: u64,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TaskArtifact {
    language: String,
    content: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TaskUsage {
    input_tokens: u64,
    output_tokens: u64,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TaskSnapshot {
    schema_version: u32,
    task_id: String,
    title: String,
    mode: String,
    provider: String,
    model: String,
    status: String,
    plan: Vec<TaskPlanStep>,
    tool_log: Vec<TaskToolLogItem>,
    final_artifact: Option<TaskArtifact>,
    #[serde(default)]
    usage: Option<TaskUsage>,
    created_at: u64,
    updated_at: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskSummary {
    task_id: String,
    title: String,
    mode: String,
    provider: String,
    model: String,
    status: String,
    has_artifact: bool,
    created_at: u64,
    updated_at: u64,
}

fn valid_task_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 80
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}

fn tasks_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|_| "无法解析应用数据目录。".to_string())?
        .join("agent-tasks");
    fs::create_dir_all(&directory).map_err(|_| "无法创建任务存储目录。".to_string())?;
    Ok(directory)
}

fn validate_snapshot(snapshot: &TaskSnapshot) -> Result<(), String> {
    if snapshot.schema_version != 1 || !valid_task_id(&snapshot.task_id) {
        return Err("任务快照版本或 ID 无效。".to_string());
    }
    if snapshot.title.len() > 160
        || snapshot.model.len() > 160
        || snapshot.plan.len() > MAX_PLAN_STEPS
        || snapshot.tool_log.len() > MAX_TOOL_LOG_ITEMS
    {
        return Err("任务快照字段超过限制。".to_string());
    }
    if snapshot.plan.iter().any(|step| step.title.len() > 240)
        || snapshot.tool_log.iter().any(|item| {
            item.title.len() > 240
                || item
                    .detail
                    .as_ref()
                    .is_some_and(|detail| detail.len() > 1000)
        })
    {
        return Err("任务计划或工具日志条目过长。".to_string());
    }
    if snapshot
        .final_artifact
        .as_ref()
        .is_some_and(|artifact| artifact.content.len() > MAX_ARTIFACT_BYTES)
    {
        return Err("最终产物超过 2 MiB 限制。".to_string());
    }
    if snapshot.usage.as_ref().is_some_and(|usage| {
        usage.input_tokens > MAX_USAGE_TOKENS || usage.output_tokens > MAX_USAGE_TOKENS
    }) {
        return Err("任务 token 用量数值超出限制。".to_string());
    }
    Ok(())
}

#[tauri::command]
pub fn save_task_snapshot(app: tauri::AppHandle, snapshot: TaskSnapshot) -> Result<(), String> {
    validate_snapshot(&snapshot)?;
    let directory = tasks_dir(&app)?;
    let target = directory.join(format!("{}.json", snapshot.task_id));
    let temporary = directory.join(format!(".{}.tmp", snapshot.task_id));
    let serialized =
        serde_json::to_vec_pretty(&snapshot).map_err(|_| "任务快照序列化失败。".to_string())?;
    fs::write(&temporary, serialized).map_err(|_| "任务快照写入失败。".to_string())?;
    if target.exists() {
        fs::remove_file(&target).map_err(|_| "无法替换旧任务快照。".to_string())?;
    }
    fs::rename(&temporary, &target).map_err(|_| "无法提交任务快照。".to_string())?;
    Ok(())
}

#[tauri::command]
pub fn list_task_snapshots(app: tauri::AppHandle) -> Result<Vec<TaskSummary>, String> {
    let directory = tasks_dir(&app)?;
    let mut summaries = Vec::new();
    for entry in fs::read_dir(directory).map_err(|_| "无法读取任务存储目录。".to_string())?
    {
        let entry = match entry {
            Ok(value) => value,
            Err(_) => continue,
        };
        if entry.path().extension().and_then(|value| value.to_str()) != Some("json") {
            continue;
        }
        let bytes = match fs::read(entry.path()) {
            Ok(value) => value,
            Err(_) => continue,
        };
        let snapshot: TaskSnapshot = match serde_json::from_slice(&bytes) {
            Ok(value) => value,
            Err(_) => continue,
        };
        summaries.push(TaskSummary {
            task_id: snapshot.task_id,
            title: snapshot.title,
            mode: snapshot.mode,
            provider: snapshot.provider,
            model: snapshot.model,
            status: snapshot.status,
            has_artifact: snapshot.final_artifact.is_some(),
            created_at: snapshot.created_at,
            updated_at: snapshot.updated_at,
        });
    }
    summaries.sort_by_key(|summary| std::cmp::Reverse(summary.updated_at));
    summaries.truncate(100);
    Ok(summaries)
}

#[tauri::command]
pub fn load_task_snapshot(app: tauri::AppHandle, task_id: String) -> Result<TaskSnapshot, String> {
    if !valid_task_id(&task_id) {
        return Err("任务 ID 无效。".to_string());
    }
    let path = tasks_dir(&app)?.join(format!("{task_id}.json"));
    let bytes = fs::read(path).map_err(|_| "任务快照不存在或无法读取。".to_string())?;
    let snapshot = serde_json::from_slice::<TaskSnapshot>(&bytes)
        .map_err(|_| "任务快照格式无效。".to_string())?;
    validate_snapshot(&snapshot)?;
    Ok(snapshot)
}

#[cfg(test)]
mod tests {
    use super::valid_task_id;
    use super::*;

    #[test]
    fn task_ids_cannot_escape_the_store() {
        assert!(valid_task_id("task-123_ab"));
        assert!(!valid_task_id("../task"));
        assert!(!valid_task_id("task.json"));
    }

    fn legacy_snapshot_value() -> serde_json::Value {
        serde_json::json!({
            "schemaVersion": 1,
            "taskId": "task-1",
            "title": "fixture",
            "mode": "web",
            "provider": "ollama",
            "model": "fixture-model",
            "status": "completed",
            "plan": [],
            "toolLog": [],
            "finalArtifact": null,
            "createdAt": 1,
            "updatedAt": 2
        })
    }

    #[test]
    fn snapshots_saved_before_usage_field_still_load() {
        let snapshot: TaskSnapshot = serde_json::from_value(legacy_snapshot_value()).unwrap();
        assert!(snapshot.usage.is_none());
        validate_snapshot(&snapshot).unwrap();
    }

    #[test]
    fn usage_is_persisted_but_capped() {
        let mut value = legacy_snapshot_value();
        value["usage"] = serde_json::json!({ "inputTokens": 1234, "outputTokens": 567 });
        let snapshot: TaskSnapshot = serde_json::from_value(value).unwrap();
        let usage = snapshot.usage.as_ref().unwrap();
        assert_eq!((usage.input_tokens, usage.output_tokens), (1234, 567));
        validate_snapshot(&snapshot).unwrap();

        let mut oversized = legacy_snapshot_value();
        oversized["usage"] =
            serde_json::json!({ "inputTokens": MAX_USAGE_TOKENS + 1, "outputTokens": 0 });
        let snapshot: TaskSnapshot = serde_json::from_value(oversized).unwrap();
        assert!(validate_snapshot(&snapshot).is_err());
    }
}
