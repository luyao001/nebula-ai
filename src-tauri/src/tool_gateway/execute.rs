use super::{policy::file_fingerprint, GatewayRoots, ToolExecutionResult};
use reqwest::blocking::Client;
use serde_json::{json, Value};
use std::{
    fs,
    io::{Read, Write},
    path::PathBuf,
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant},
};

const MAX_TEXT_BYTES: usize = 1_048_576;
const MAX_FETCH_BYTES: u64 = 524_288;
const MAX_COMMAND_OUTPUT_BYTES: usize = 524_288;

fn value_string<'a>(arguments: &'a Value, key: &str) -> Result<&'a str, String> {
    arguments
        .get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| format!("冻结的工具参数 `{key}` 无效。"))
}

fn path_arg(arguments: &Value, key: &str) -> Result<PathBuf, String> {
    value_string(arguments, key).map(PathBuf::from)
}

fn result(content: String, metadata: Value) -> ToolExecutionResult {
    ToolExecutionResult {
        ok: true,
        content,
        metadata,
    }
}

fn read_file(arguments: &Value) -> Result<ToolExecutionResult, String> {
    let path = path_arg(arguments, "path")?;
    let metadata = fs::metadata(&path).map_err(|_| "无法读取文件元数据。".to_string())?;
    if metadata.len() > MAX_TEXT_BYTES as u64 {
        return Err("文件超过 1 MiB 读取限制。".to_string());
    }
    let bytes = fs::read(&path).map_err(|_| "读取文件失败。".to_string())?;
    let content =
        String::from_utf8(bytes).map_err(|_| "read_file 仅支持 UTF-8 文本文件。".to_string())?;
    Ok(result(
        content,
        json!({ "bytes": metadata.len(), "path": path }),
    ))
}

fn list_dir(arguments: &Value) -> Result<ToolExecutionResult, String> {
    let path = path_arg(arguments, "path")?;
    let mut entries = Vec::new();
    for entry in fs::read_dir(&path)
        .map_err(|_| "读取目录失败。".to_string())?
        .take(201)
    {
        let entry = entry.map_err(|_| "读取目录项失败。".to_string())?;
        let metadata = entry
            .metadata()
            .map_err(|_| "读取目录项元数据失败。".to_string())?;
        entries.push(json!({
            "name": entry.file_name().to_string_lossy(),
            "kind": if metadata.is_dir() { "directory" } else if metadata.is_file() { "file" } else { "other" },
            "bytes": if metadata.is_file() { Some(metadata.len()) } else { None }
        }));
    }
    let truncated = entries.len() > 200;
    entries.truncate(200);
    let content =
        serde_json::to_string_pretty(&entries).map_err(|_| "目录结果序列化失败。".to_string())?;
    Ok(result(
        content,
        json!({ "count": entries.len(), "truncated": truncated, "path": path }),
    ))
}

fn search_files(arguments: &Value, roots: &GatewayRoots) -> Result<ToolExecutionResult, String> {
    const MAX_RESULTS: usize = 80;
    const MAX_ENTRIES: usize = 1_600;
    const MAX_FILE_BYTES: u64 = 256 * 1024;
    const IGNORED: &[&str] = &[
        ".git",
        ".next",
        ".nuxt",
        ".venv",
        "build",
        "coverage",
        "dist",
        "node_modules",
        "target",
        "vendor",
    ];

    let base = path_arg(arguments, "path")?;
    let query = value_string(arguments, "query")?;
    let scope = value_string(arguments, "scope")?;
    let scope_root = match scope {
        "workspace" => &roots.workspace,
        "sandbox" => &roots.sandbox,
        _ => return Err("冻结的搜索 scope 无效。".to_string()),
    };
    let needle = query.to_lowercase();
    let mut pending = vec![(base, 0_usize)];
    let mut results = Vec::new();
    let mut inspected_entries = 0_usize;
    let mut inspected_files = 0_usize;
    let mut truncated = false;

    while let Some((directory, depth)) = pending.pop() {
        if depth > 14 || inspected_entries >= MAX_ENTRIES || results.len() >= MAX_RESULTS {
            truncated = true;
            break;
        }
        let entries = match fs::read_dir(directory) {
            Ok(value) => value,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            inspected_entries += 1;
            if inspected_entries > MAX_ENTRIES || results.len() >= MAX_RESULTS {
                truncated = true;
                break;
            }
            let file_type = match entry.file_type() {
                Ok(value) => value,
                Err(_) => continue,
            };
            if file_type.is_symlink() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().into_owned();
            let path = entry.path();
            if file_type.is_dir() {
                if !IGNORED
                    .iter()
                    .any(|ignored| name.eq_ignore_ascii_case(ignored))
                {
                    pending.push((path, depth + 1));
                }
                continue;
            }
            if !file_type.is_file() {
                continue;
            }
            inspected_files += 1;
            let relative = path
                .strip_prefix(scope_root)
                .unwrap_or(&path)
                .components()
                .map(|component| component.as_os_str().to_string_lossy())
                .collect::<Vec<_>>()
                .join("/");
            if relative.to_lowercase().contains(&needle) {
                results.push(json!({
                    "path": relative,
                    "line": null,
                    "preview": "file path match",
                    "kind": "path"
                }));
            }
            if entry
                .metadata()
                .is_ok_and(|metadata| metadata.len() <= MAX_FILE_BYTES)
            {
                let Ok(content) = fs::read_to_string(&path) else {
                    continue;
                };
                for (line_index, line) in content.lines().enumerate() {
                    if line.to_lowercase().contains(&needle) {
                        results.push(json!({
                            "path": relative,
                            "line": line_index + 1,
                            "preview": line.trim().chars().take(220).collect::<String>(),
                            "kind": "content"
                        }));
                        if results.len() >= MAX_RESULTS {
                            truncated = true;
                            break;
                        }
                    }
                }
            }
        }
    }

    let content =
        serde_json::to_string_pretty(&results).map_err(|_| "搜索结果序列化失败。".to_string())?;
    Ok(result(
        content,
        json!({
            "count": results.len(),
            "truncated": truncated,
            "inspectedEntries": inspected_entries,
            "inspectedFiles": inspected_files,
            "query": query
        }),
    ))
}

fn write_file(arguments: &Value) -> Result<ToolExecutionResult, String> {
    let path = path_arg(arguments, "path")?;
    let content = value_string(arguments, "content")?;
    if content.len() > MAX_TEXT_BYTES {
        return Err("write_file 内容超过 1 MiB 限制。".to_string());
    }
    let expected_fingerprint = arguments.get("expectedFingerprint");
    match expected_fingerprint {
        Some(Value::Null) if path.exists() => {
            return Err("目标原本不存在，但审批后已被创建；为避免覆盖，写入已取消。".to_string())
        }
        Some(Value::String(expected)) if !path.exists() => {
            return Err("目标在审批后被删除；为避免写入过期路径，操作已取消。".to_string())
        }
        Some(Value::String(expected)) if file_fingerprint(&path)? != *expected => {
            return Err("目标文件在审批后发生变化；请重新审查最新 diff。".to_string())
        }
        Some(Value::String(_)) | Some(Value::Null) => {}
        _ => return Err("写入请求缺少审批时的文件指纹。".to_string()),
    }
    let mut options = fs::OpenOptions::new();
    options.create(true).write(true).truncate(true);
    let mut file = options
        .open(&path)
        .map_err(|_| "打开目标文件失败。".to_string())?;
    file.write_all(content.as_bytes())
        .map_err(|_| "写入目标文件失败。".to_string())?;
    file.sync_all()
        .map_err(|_| "刷新目标文件失败。".to_string())?;
    Ok(result(
        format!("已写入 {} 字节。", content.len()),
        json!({ "bytes": content.len(), "path": path }),
    ))
}

fn read_stream_limited<R: Read>(mut reader: R) -> Vec<u8> {
    let mut kept = Vec::new();
    let mut buffer = [0_u8; 8192];
    loop {
        match reader.read(&mut buffer) {
            Ok(0) | Err(_) => break,
            Ok(read) => {
                let remaining = MAX_COMMAND_OUTPUT_BYTES.saturating_sub(kept.len());
                kept.extend_from_slice(&buffer[..read.min(remaining)]);
            }
        }
    }
    kept
}

fn command_path(program: &str) -> &str {
    program
}

fn run_command(arguments: &Value, roots: &GatewayRoots) -> Result<ToolExecutionResult, String> {
    let program = value_string(arguments, "program")?;
    let args: Vec<String> = arguments
        .get("args")
        .and_then(Value::as_array)
        .ok_or_else(|| "冻结的命令参数无效。".to_string())?
        .iter()
        .filter_map(Value::as_str)
        .map(ToOwned::to_owned)
        .collect();
    let cwd = path_arg(arguments, "cwd")?;
    if !cwd.starts_with(&roots.sandbox) {
        return Err("命令工作目录已越过临时沙盒。".to_string());
    }
    let timeout_ms = arguments
        .get("timeout_ms")
        .and_then(Value::as_u64)
        .unwrap_or(30_000);

    let mut command = Command::new(command_path(program));
    command
        .args(&args)
        .current_dir(&cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env_clear();
    for key in [
        "PATH",
        "PATHEXT",
        "SYSTEMROOT",
        "WINDIR",
        "TEMP",
        "TMP",
        "TMPDIR",
        "HOME",
        "USERPROFILE",
        "CARGO_HOME",
        "RUSTUP_HOME",
    ] {
        if let Some(value) = std::env::var_os(key) {
            command.env(key, value);
        }
    }
    command
        .env("CARGO_NET_OFFLINE", "true")
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_CONFIG_NOSYSTEM", "1");

    let mut child = command
        .spawn()
        .map_err(|_| "无法启动白名单命令。".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "无法读取命令标准输出。".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "无法读取命令错误输出。".to_string())?;
    let stdout_thread = thread::spawn(move || read_stream_limited(stdout));
    let stderr_thread = thread::spawn(move || read_stream_limited(stderr));
    let started = Instant::now();
    let status = loop {
        if let Some(status) = child
            .try_wait()
            .map_err(|_| "无法查询命令状态。".to_string())?
        {
            break status;
        }
        if started.elapsed() >= Duration::from_millis(timeout_ms) {
            let _ = child.kill();
            let _ = child.wait();
            return Err(format!("命令超过 {} ms，已终止。", timeout_ms));
        }
        thread::sleep(Duration::from_millis(40));
    };
    let stdout = stdout_thread.join().unwrap_or_default();
    let stderr = stderr_thread.join().unwrap_or_default();
    let stdout = String::from_utf8_lossy(&stdout);
    let stderr = String::from_utf8_lossy(&stderr);
    let content = format!(
        "exit_code: {}\nstdout:\n{}\nstderr:\n{}",
        status.code().unwrap_or(-1),
        stdout,
        stderr
    );
    Ok(ToolExecutionResult {
        ok: status.success(),
        content,
        metadata: json!({
            "exitCode": status.code(),
            "durationMs": started.elapsed().as_millis(),
            "outputTruncated": stdout.len() >= MAX_COMMAND_OUTPUT_BYTES || stderr.len() >= MAX_COMMAND_OUTPUT_BYTES
        }),
    })
}

fn allowed_content_type(value: &str) -> bool {
    let media_type = value
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();
    media_type.starts_with("text/")
        || matches!(
            media_type.as_str(),
            "application/json"
                | "application/xml"
                | "application/javascript"
                | "application/xhtml+xml"
        )
}

fn fetch_url(arguments: &Value) -> Result<ToolExecutionResult, String> {
    let url = value_string(arguments, "url")?;
    let client = Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(15))
        .user_agent("Nebula-AI-Agent/0.3")
        .build()
        .map_err(|_| "无法初始化受控网络客户端。".to_string())?;
    let response = client
        .get(url)
        .send()
        .map_err(|_| "网络请求失败。".to_string())?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("目标站点返回 HTTP {}。", status.as_u16()));
    }
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("text/plain")
        .to_string();
    if !allowed_content_type(&content_type) {
        return Err(format!("不允许读取内容类型：{content_type}"));
    }
    if response
        .content_length()
        .is_some_and(|length| length > MAX_FETCH_BYTES)
    {
        return Err("远程响应超过 512 KiB 限制。".to_string());
    }
    let mut bytes = Vec::new();
    response
        .take(MAX_FETCH_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "读取远程响应失败。".to_string())?;
    if bytes.len() as u64 > MAX_FETCH_BYTES {
        return Err("远程响应超过 512 KiB 限制。".to_string());
    }
    let content =
        String::from_utf8(bytes).map_err(|_| "fetch_url 仅支持 UTF-8 文本响应。".to_string())?;
    Ok(result(
        content,
        json!({ "status": status.as_u16(), "contentType": content_type, "url": url }),
    ))
}

pub(super) fn execute(
    tool_name: &str,
    arguments: &Value,
    roots: &GatewayRoots,
) -> Result<ToolExecutionResult, String> {
    match tool_name {
        "read_file" => read_file(arguments),
        "list_dir" => list_dir(arguments),
        "search_files" => search_files(arguments, roots),
        "write_file" => write_file(arguments),
        "run_command" => run_command(arguments, roots),
        "fetch_url" => fetch_url(arguments),
        _ => Err(format!("未知或未启用的工具：{tool_name}")),
    }
}
