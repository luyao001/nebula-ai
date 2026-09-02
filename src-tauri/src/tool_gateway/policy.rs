use super::GatewayRoots;
use serde_json::{json, Value};
use std::{
    env, fs,
    net::{IpAddr, ToSocketAddrs},
    path::{Component, Path, PathBuf},
};
use url::Url;

const MAX_TEXT_BYTES: usize = 1_048_576;
const MAX_DIFF_PREVIEW_BYTES: usize = 256 * 1024;

pub(super) struct CheckedCall {
    pub arguments: Value,
    pub display: String,
    pub risk: String,
    pub requires_confirmation: bool,
    pub can_allow_session: bool,
    pub grant_key: Option<String>,
    pub details: Option<Value>,
}

fn string_arg<'a>(arguments: &'a Value, key: &str) -> Result<&'a str, String> {
    arguments
        .get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| format!("工具参数 `{key}` 必须是字符串。"))
}

fn optional_string_arg<'a>(arguments: &'a Value, key: &str) -> Result<Option<&'a str>, String> {
    match arguments.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(value) => value
            .as_str()
            .map(Some)
            .ok_or_else(|| format!("工具参数 `{key}` 必须是字符串。")),
    }
}

fn root_for_scope<'a>(roots: &'a GatewayRoots, scope: &str) -> Result<&'a Path, String> {
    match scope {
        "workspace" => Ok(&roots.workspace),
        "sandbox" => Ok(&roots.sandbox),
        _ => Err("`scope` 只能是 workspace 或 sandbox。".to_string()),
    }
}

fn has_unsafe_components(path: &Path) -> bool {
    path.is_absolute()
        || path.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
}

fn resolve_path(
    roots: &GatewayRoots,
    scope: &str,
    relative: &str,
    must_exist: bool,
) -> Result<PathBuf, String> {
    let relative_path = Path::new(relative);
    if relative.trim().is_empty() || has_unsafe_components(relative_path) {
        return Err("路径必须是授权目录内的安全相对路径。".to_string());
    }
    let root = root_for_scope(roots, scope)?;
    let candidate = root.join(relative_path);
    let checked = if candidate.exists() {
        candidate
            .canonicalize()
            .map_err(|_| "无法解析目标路径。".to_string())?
    } else {
        if must_exist {
            return Err("目标路径不存在。".to_string());
        }
        let parent = candidate
            .parent()
            .ok_or_else(|| "目标路径缺少父目录。".to_string())?
            .canonicalize()
            .map_err(|_| "目标文件的父目录不存在或不可访问。".to_string())?;
        let file_name = candidate
            .file_name()
            .ok_or_else(|| "目标文件名无效。".to_string())?;
        parent.join(file_name)
    };
    if !checked.starts_with(root) {
        return Err("路径越过了已授权目录边界。".to_string());
    }
    Ok(checked)
}

fn scope(arguments: &Value) -> Result<&str, String> {
    optional_string_arg(arguments, "scope").map(|value| value.unwrap_or("workspace"))
}

fn validate_read(
    tool_name: &str,
    arguments: Value,
    roots: &GatewayRoots,
) -> Result<CheckedCall, String> {
    let selected_scope = scope(&arguments)?;
    let relative = optional_string_arg(&arguments, "path")?.unwrap_or(".");
    let path = resolve_path(roots, selected_scope, relative, true)?;
    if tool_name == "read_file" && !path.is_file() {
        return Err("read_file 的目标不是文件。".to_string());
    }
    if tool_name == "list_dir" && !path.is_dir() {
        return Err("list_dir 的目标不是目录。".to_string());
    }
    Ok(CheckedCall {
        arguments: json!({ "path": path, "scope": selected_scope }),
        display: format!("{} {}", tool_name, path.display()),
        risk: "读取已授权目录中的本地数据".to_string(),
        requires_confirmation: false,
        can_allow_session: false,
        grant_key: None,
        details: None,
    })
}

fn validate_write(arguments: Value, roots: &GatewayRoots) -> Result<CheckedCall, String> {
    let selected_scope = scope(&arguments)?;
    let relative = string_arg(&arguments, "path")?;
    let content = string_arg(&arguments, "content")?;
    if content.len() > MAX_TEXT_BYTES {
        return Err("write_file 内容超过 1 MiB 限制。".to_string());
    }
    if selected_scope == "workspace"
        && !sandbox_contains_content(&roots.sandbox, content.as_bytes())
    {
        return Err("写入工作目录前，必须先把完全相同的内容写入临时沙盒并完成检查。".to_string());
    }
    let path = resolve_path(roots, selected_scope, relative, false)?;
    let grant_directory = path
        .parent()
        .ok_or_else(|| "目标文件缺少父目录。".to_string())?;
    let display = format!("写入 {}（{} 字节）", path.display(), content.len());
    let is_new_file = !path.exists();
    let (old_content, old_omitted) = if is_new_file {
        (None, false)
    } else {
        match fs::read(&path) {
            Ok(bytes) if bytes.len() <= MAX_DIFF_PREVIEW_BYTES => {
                (Some(String::from_utf8_lossy(&bytes).into_owned()), false)
            }
            _ => (None, true),
        }
    };
    Ok(CheckedCall {
        arguments: json!({ "path": path, "content": content, "scope": selected_scope }),
        display,
        risk: if is_new_file {
            "在已授权目录中创建文件".to_string()
        } else {
            "覆盖已授权目录中的现有文件".to_string()
        },
        requires_confirmation: true,
        can_allow_session: true,
        grant_key: Some(format!(
            "write_file:{selected_scope}:{}",
            grant_directory.display()
        )),
        details: Some(json!({
            "kind": "write_file",
            "path": path.display().to_string(),
            "scope": selected_scope,
            "isNewFile": is_new_file,
            "byteSize": content.len(),
            "oldContent": old_content,
            "oldOmitted": old_omitted,
            "newContent": content,
        })),
    })
}

fn sandbox_contains_content(root: &Path, expected: &[u8]) -> bool {
    let mut pending = vec![(root.to_path_buf(), 0_usize)];
    let mut inspected = 0_usize;
    while let Some((directory, depth)) = pending.pop() {
        if depth > 6 || inspected >= 500 {
            continue;
        }
        let entries = match fs::read_dir(directory) {
            Ok(value) => value,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            inspected += 1;
            if inspected > 500 {
                break;
            }
            let path = entry.path();
            let metadata = match entry.metadata() {
                Ok(value) => value,
                Err(_) => continue,
            };
            if metadata.is_dir() {
                pending.push((path, depth + 1));
            } else if metadata.is_file()
                && metadata.len() == expected.len() as u64
                && fs::read(path).is_ok_and(|content| content == expected)
            {
                return true;
            }
        }
    }
    false
}

fn string_array(arguments: &Value, key: &str) -> Result<Vec<String>, String> {
    arguments
        .get(key)
        .and_then(Value::as_array)
        .ok_or_else(|| format!("工具参数 `{key}` 必须是字符串数组。"))?
        .iter()
        .map(|value| {
            value
                .as_str()
                .map(ToOwned::to_owned)
                .ok_or_else(|| format!("工具参数 `{key}` 必须是字符串数组。"))
        })
        .collect()
}

fn validate_program(program: &str, args: &[String]) -> Result<(), String> {
    let name = program.to_ascii_lowercase();
    let first = args.first().map(String::as_str).unwrap_or("");
    let allowed = match name.as_str() {
        "cargo" | "cargo.exe" => matches!(first, "check" | "test" | "fmt" | "clippy" | "metadata"),
        "node" | "node.exe" => first == "--check" && args.len() == 2,
        "python" | "python.exe" | "python3" => {
            args.len() == 3 && args[0] == "-m" && args[1] == "py_compile"
        }
        _ => false,
    };
    if !allowed {
        return Err(
            "命令不在安全白名单内；仅允许 cargo check/test/fmt/clippy/metadata、node --check 与 python -m py_compile。"
                .to_string(),
        );
    }
    if args.len() > 32
        || args.iter().any(|arg| {
            arg.contains('\n')
                || arg.contains('\r')
                || arg == "--git-dir"
                || arg == "--work-tree"
                || arg.starts_with("--git-dir=")
                || arg.starts_with("--work-tree=")
        })
    {
        return Err("命令参数包含禁止项或数量超限。".to_string());
    }
    Ok(())
}

/// Only called after `validate_program` approved the call; produces the
/// human-readable whitelist explanation shown in the permission dialog.
fn whitelist_reason(program: &str, args: &[String]) -> String {
    let name = program.to_ascii_lowercase();
    let first = args.first().map(String::as_str).unwrap_or("");
    match name.as_str() {
        "cargo" | "cargo.exe" => {
            format!("命中白名单：cargo {first} 只做编译检查、测试、格式化或元数据读取，不运行任意项目代码。")
        }
        "node" | "node.exe" => "命中白名单：node --check 只做语法检查，不执行脚本。".to_string(),
        _ => "命中白名单：python -m py_compile 只做编译检查，不执行脚本。".to_string(),
    }
}

fn resolve_program_path(program: &str) -> Result<PathBuf, String> {
    let path_value = env::var_os("PATH").ok_or_else(|| "系统 PATH 不可用。".to_string())?;
    #[cfg(windows)]
    let extensions: Vec<String> = if Path::new(program).extension().is_some() {
        vec![String::new()]
    } else {
        env::var_os("PATHEXT")
            .map(|value| {
                value
                    .to_string_lossy()
                    .split(';')
                    .filter(|item| !item.is_empty())
                    .map(ToOwned::to_owned)
                    .collect()
            })
            .unwrap_or_else(|| vec![".COM".into(), ".EXE".into(), ".BAT".into(), ".CMD".into()])
    };
    #[cfg(not(windows))]
    let extensions = vec![String::new()];

    for directory in env::split_paths(&path_value) {
        if directory.as_os_str().is_empty() {
            continue;
        }
        for extension in &extensions {
            let candidate = directory.join(format!("{program}{extension}"));
            if candidate.is_file() {
                return candidate
                    .canonicalize()
                    .map_err(|_| "无法解析白名单命令的真实路径。".to_string());
            }
        }
    }
    Err(format!("系统 PATH 中找不到白名单命令：{program}"))
}

fn validate_command(arguments: Value, roots: &GatewayRoots) -> Result<CheckedCall, String> {
    let program = string_arg(&arguments, "program")?.to_string();
    let mut args = string_array(&arguments, "args")?;
    validate_program(&program, &args)?;
    let executable = resolve_program_path(&program)?;
    let program_name = program.to_ascii_lowercase();
    if matches!(program_name.as_str(), "node" | "node.exe") {
        let checked = resolve_path(roots, "sandbox", &args[1], true)?;
        args[1] = checked.to_string_lossy().into_owned();
    }
    if matches!(program_name.as_str(), "python" | "python.exe" | "python3") {
        let checked = resolve_path(roots, "sandbox", &args[2], true)?;
        args[2] = checked.to_string_lossy().into_owned();
    }
    if matches!(program_name.as_str(), "cargo" | "cargo.exe")
        && args.iter().skip(1).any(|arg| {
            Path::new(arg).is_absolute()
                || arg.split(['/', '\\']).any(|part| part == "..")
                || arg.starts_with("--manifest-path")
                || arg.starts_with("--target-dir")
                || arg.starts_with("--output")
                || arg == "--ext-diff"
                || arg == "--textconv"
                || arg.starts_with("--exec-path")
        })
    {
        return Err("命令参数不得引用沙盒外路径或重定向输出。".to_string());
    }
    let relative_cwd = optional_string_arg(&arguments, "cwd")?.unwrap_or(".");
    let cwd = resolve_path(roots, "sandbox", relative_cwd, true)?;
    if !cwd.is_dir() {
        return Err("命令工作目录不是沙盒内的目录。".to_string());
    }
    let timeout_ms = arguments
        .get("timeout_ms")
        .and_then(Value::as_u64)
        .unwrap_or(30_000)
        .clamp(1_000, 120_000);
    Ok(CheckedCall {
        arguments: json!({
            "program": executable,
            "args": args,
            "cwd": cwd,
            "timeout_ms": timeout_ms
        }),
        display: format!(
            "{} {}\n可执行文件：{}\n工作目录：{}",
            program,
            args.join(" "),
            executable.display(),
            cwd.display()
        ),
        risk: "在临时沙盒中启动受限本地进程".to_string(),
        requires_confirmation: true,
        can_allow_session: false,
        grant_key: None,
        details: Some(json!({
            "kind": "run_command",
            "program": program,
            "args": args,
            "executable": executable.display().to_string(),
            "cwd": cwd.display().to_string(),
            "timeoutMs": timeout_ms,
            "allowReason": whitelist_reason(&program, &args),
        })),
    })
}

fn blocked_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => {
            ip.is_private()
                || ip.is_loopback()
                || ip.is_link_local()
                || ip.is_broadcast()
                || ip.is_unspecified()
                || ip.is_multicast()
                || ip.octets()[0] == 0
                || (ip.octets()[0] == 100 && (64..=127).contains(&ip.octets()[1]))
        }
        IpAddr::V6(ip) => {
            let octets = ip.octets();
            let first = octets[0];
            if octets[..10].iter().all(|byte| *byte == 0)
                && octets[10] == 0xff
                && octets[11] == 0xff
            {
                return blocked_ip(IpAddr::V4(std::net::Ipv4Addr::new(
                    octets[12], octets[13], octets[14], octets[15],
                )));
            }
            ip.is_loopback()
                || ip.is_unspecified()
                || ip.is_multicast()
                || first == 0xfc
                || first == 0xfd
                || (first == 0xfe && ip.octets()[1] & 0xc0 == 0x80)
        }
    }
}

fn validate_fetch(arguments: Value) -> Result<CheckedCall, String> {
    let raw_url = string_arg(&arguments, "url")?;
    let url = Url::parse(raw_url).map_err(|_| "fetch_url 的 URL 无效。".to_string())?;
    if !matches!(url.scheme(), "http" | "https")
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err("fetch_url 仅允许不含凭据的 HTTP(S) URL。".to_string());
    }
    let host = url
        .host_str()
        .ok_or_else(|| "URL 缺少主机名。".to_string())?;
    if host.eq_ignore_ascii_case("localhost") || host.ends_with(".localhost") {
        return Err("fetch_url 禁止访问本机地址。".to_string());
    }
    let port = url
        .port_or_known_default()
        .ok_or_else(|| "URL 端口无效。".to_string())?;
    let addresses: Vec<_> = (host, port)
        .to_socket_addrs()
        .map_err(|_| "无法解析 URL 主机。".to_string())?
        .collect();
    if addresses.is_empty() || addresses.iter().any(|address| blocked_ip(address.ip())) {
        return Err("fetch_url 禁止访问本机、私网或保留地址。".to_string());
    }
    let origin = format!(
        "{}://{}{}",
        url.scheme(),
        host,
        url.port()
            .map(|value| format!(":{value}"))
            .unwrap_or_default()
    );
    let resolved: Vec<String> = addresses.iter().take(4).map(|a| a.to_string()).collect();
    Ok(CheckedCall {
        arguments: json!({ "url": url.as_str() }),
        display: format!("GET {}", url.as_str()),
        risk: format!("向外部站点 {origin} 发起网络请求"),
        requires_confirmation: true,
        can_allow_session: true,
        grant_key: Some(format!("fetch_url:{origin}")),
        details: Some(json!({
            "kind": "fetch_url",
            "url": url.as_str(),
            "host": host,
            "origin": origin,
            "resolved": resolved,
            "resolvedCount": addresses.len(),
        })),
    })
}

pub(super) fn validate_and_describe(
    tool_name: &str,
    arguments: Value,
    roots: &GatewayRoots,
) -> Result<CheckedCall, String> {
    match tool_name {
        "read_file" | "list_dir" => validate_read(tool_name, arguments, roots),
        "write_file" => validate_write(arguments, roots),
        "run_command" => validate_command(arguments, roots),
        "fetch_url" => validate_fetch(arguments),
        _ => Err(format!("未知或未启用的工具：{tool_name}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_parent_directory_paths() {
        assert!(has_unsafe_components(Path::new("../secret")));
        assert!(!has_unsafe_components(Path::new("src/main.rs")));
    }

    #[test]
    fn blocks_private_addresses() {
        assert!(blocked_ip("127.0.0.1".parse().unwrap()));
        assert!(blocked_ip("192.168.1.1".parse().unwrap()));
        assert!(blocked_ip("100.64.0.1".parse().unwrap()));
        assert!(blocked_ip("::ffff:10.0.0.1".parse().unwrap()));
        assert!(!blocked_ip("100.128.0.1".parse().unwrap()));
        assert!(!blocked_ip("8.8.8.8".parse().unwrap()));
    }

    #[test]
    fn write_file_details_expose_diff_content() {
        let base = std::env::temp_dir().join(format!("nova-policy-{}", uuid::Uuid::new_v4()));
        let workspace = base.join("workspace");
        let sandbox = base.join("sandbox");
        std::fs::create_dir_all(&workspace).unwrap();
        std::fs::create_dir_all(&sandbox).unwrap();
        let roots = GatewayRoots {
            workspace: workspace
                .canonicalize()
                .expect("test workspace must canonicalize"),
            sandbox: sandbox
                .canonicalize()
                .expect("test sandbox must canonicalize"),
        };

        let existing = "line-1\nline-2\n";
        std::fs::write(workspace.join("notes.txt"), existing).unwrap();
        let updated = "line-1\nline-2 changed\n";
        std::fs::write(roots.sandbox.join("payload.txt"), updated).unwrap();

        let checked = validate_write(
            serde_json::json!({ "path": "notes.txt", "content": updated, "scope": "workspace" }),
            &roots,
        )
        .unwrap();
        let details = checked.details.expect("write_file must carry diff details");
        assert_eq!(details["kind"], "write_file");
        assert_eq!(details["isNewFile"], false);
        assert_eq!(details["oldOmitted"], false);
        assert_eq!(details["oldContent"], existing);
        assert_eq!(details["newContent"], updated);

        let fresh = validate_write(
            serde_json::json!({ "path": "fresh.txt", "content": "abc", "scope": "sandbox" }),
            &roots,
        )
        .unwrap();
        let fresh_details = fresh.details.unwrap();
        assert_eq!(fresh_details["isNewFile"], true);
        assert!(fresh_details["oldContent"].is_null());

        let _ = std::fs::remove_dir_all(base);
    }
}
