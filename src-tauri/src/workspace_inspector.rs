use serde::Serialize;
use std::{
    fs,
    path::{Component, Path, PathBuf},
    process::Command,
};

use crate::tool_gateway::ToolGatewayState;

const MAX_INDEX_ENTRIES: usize = 1_600;
const MAX_SEARCH_RESULTS: usize = 80;
const MAX_FILE_BYTES: u64 = 1_048_576;
const MAX_SEARCH_FILE_BYTES: u64 = 256 * 1024;
const MAX_GIT_OUTPUT_BYTES: usize = 512 * 1024;

const IGNORED_DIRECTORIES: &[&str] = &[
    ".git",
    ".idea",
    ".next",
    ".nuxt",
    ".turbo",
    ".venv",
    ".vscode",
    "build",
    "coverage",
    "dist",
    "node_modules",
    "target",
    "vendor",
];

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceEntry {
    path: String,
    name: String,
    kind: String,
    depth: usize,
    bytes: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceIndex {
    entries: Vec<WorkspaceEntry>,
    truncated: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceFileContent {
    path: String,
    language: String,
    content: String,
    bytes: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSearchResult {
    path: String,
    line: Option<usize>,
    preview: String,
    kind: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSearchResponse {
    results: Vec<WorkspaceSearchResult>,
    truncated: bool,
    inspected_files: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitFileChange {
    status: String,
    path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitReview {
    is_repository: bool,
    branch: String,
    files: Vec<GitFileChange>,
    diff: String,
    truncated: bool,
}

fn workspace_root(state: &tauri::State<'_, ToolGatewayState>) -> Result<PathBuf, String> {
    state
        .workspace_root()
        .ok_or_else(|| "请先选择并授权一个工作目录。".to_string())
}

fn is_safe_relative(path: &Path) -> bool {
    !path.is_absolute()
        && !path.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
}

fn resolve_workspace_path(root: &Path, relative: &str) -> Result<PathBuf, String> {
    let requested = Path::new(relative);
    if relative.trim().is_empty() || !is_safe_relative(requested) {
        return Err("路径必须是工作目录内的安全相对路径。".to_string());
    }
    let resolved = root
        .join(requested)
        .canonicalize()
        .map_err(|_| "文件不存在或无法访问。".to_string())?;
    if !resolved.starts_with(root) {
        return Err("路径越过了已授权工作目录。".to_string());
    }
    Ok(resolved)
}

fn relative_path(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .components()
        .map(|component| component.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/")
}

fn ignored_directory(name: &str) -> bool {
    IGNORED_DIRECTORIES
        .iter()
        .any(|ignored| name.eq_ignore_ascii_case(ignored))
}

fn collect_entries(root: &Path) -> Result<(Vec<WorkspaceEntry>, bool), String> {
    let mut entries = Vec::new();
    let mut pending = vec![(root.to_path_buf(), 0_usize)];
    let mut truncated = false;

    while let Some((directory, depth)) = pending.pop() {
        if depth >= 14 {
            continue;
        }
        let mut children = fs::read_dir(&directory)
            .map_err(|_| "无法读取工作目录。".to_string())?
            .filter_map(Result::ok)
            .collect::<Vec<_>>();
        children.sort_by_key(|entry| entry.file_name().to_string_lossy().to_ascii_lowercase());

        let mut directories = Vec::new();
        for child in children {
            if entries.len() >= MAX_INDEX_ENTRIES {
                truncated = true;
                break;
            }
            let file_type = match child.file_type() {
                Ok(value) => value,
                Err(_) => continue,
            };
            if file_type.is_symlink() {
                continue;
            }
            let name = child.file_name().to_string_lossy().into_owned();
            if file_type.is_dir() && ignored_directory(&name) {
                continue;
            }
            let path = child.path();
            let is_directory = file_type.is_dir();
            let bytes = if file_type.is_file() {
                child.metadata().ok().map(|metadata| metadata.len())
            } else {
                None
            };
            entries.push(WorkspaceEntry {
                path: relative_path(root, &path),
                name,
                kind: if is_directory { "directory" } else { "file" }.to_string(),
                depth,
                bytes,
            });
            if is_directory {
                directories.push(path);
            }
        }
        for path in directories.into_iter().rev() {
            pending.push((path, depth + 1));
        }
        if truncated {
            break;
        }
    }

    Ok((entries, truncated))
}

fn language_for(path: &Path) -> String {
    match path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "css" => "css",
        "go" => "go",
        "html" | "htm" => "html",
        "java" => "java",
        "js" | "jsx" | "mjs" | "cjs" => "javascript",
        "json" => "json",
        "md" | "mdx" => "markdown",
        "py" => "python",
        "rs" => "rust",
        "sh" | "bash" | "zsh" => "shell",
        "toml" => "toml",
        "ts" | "tsx" => "typescript",
        "xml" => "xml",
        "yaml" | "yml" => "yaml",
        _ => "plaintext",
    }
    .to_string()
}

#[tauri::command]
pub fn list_workspace_entries(
    state: tauri::State<'_, ToolGatewayState>,
) -> Result<WorkspaceIndex, String> {
    let root = workspace_root(&state)?;
    let (entries, truncated) = collect_entries(&root)?;
    Ok(WorkspaceIndex { entries, truncated })
}

#[tauri::command]
pub fn read_workspace_file(
    path: String,
    state: tauri::State<'_, ToolGatewayState>,
) -> Result<WorkspaceFileContent, String> {
    let root = workspace_root(&state)?;
    let resolved = resolve_workspace_path(&root, &path)?;
    let metadata = fs::metadata(&resolved).map_err(|_| "无法读取文件元数据。".to_string())?;
    if !metadata.is_file() || metadata.len() > MAX_FILE_BYTES {
        return Err("只能打开不超过 1 MiB 的文本文件。".to_string());
    }
    let bytes = fs::read(&resolved).map_err(|_| "读取文件失败。".to_string())?;
    let content = String::from_utf8(bytes).map_err(|_| "当前文件不是 UTF-8 文本。".to_string())?;
    Ok(WorkspaceFileContent {
        path,
        language: language_for(&resolved),
        content,
        bytes: metadata.len(),
    })
}

#[tauri::command]
pub fn search_workspace(
    query: String,
    state: tauri::State<'_, ToolGatewayState>,
) -> Result<WorkspaceSearchResponse, String> {
    let query = query.trim();
    if !(2..=120).contains(&query.chars().count()) || query.contains(['\r', '\n']) {
        return Err("搜索词长度必须为 2 到 120 个字符。".to_string());
    }
    let root = workspace_root(&state)?;
    let (entries, index_truncated) = collect_entries(&root)?;
    let needle = query.to_lowercase();
    let mut results = Vec::new();
    let mut inspected_files = 0;
    let mut truncated = index_truncated;

    for entry in entries.into_iter().filter(|entry| entry.kind == "file") {
        if results.len() >= MAX_SEARCH_RESULTS {
            truncated = true;
            break;
        }
        if entry.path.to_lowercase().contains(&needle) {
            results.push(WorkspaceSearchResult {
                path: entry.path.clone(),
                line: None,
                preview: "文件路径匹配".to_string(),
                kind: "path".to_string(),
            });
            if results.len() >= MAX_SEARCH_RESULTS {
                truncated = true;
                break;
            }
        }
        if entry.bytes.unwrap_or(u64::MAX) > MAX_SEARCH_FILE_BYTES {
            continue;
        }
        inspected_files += 1;
        let Ok(content) = fs::read_to_string(root.join(&entry.path)) else {
            continue;
        };
        for (line_index, line) in content.lines().enumerate() {
            if line.to_lowercase().contains(&needle) {
                let preview = line.trim();
                results.push(WorkspaceSearchResult {
                    path: entry.path.clone(),
                    line: Some(line_index + 1),
                    preview: preview.chars().take(220).collect(),
                    kind: "content".to_string(),
                });
                if results.len() >= MAX_SEARCH_RESULTS {
                    truncated = true;
                    break;
                }
            }
        }
    }

    Ok(WorkspaceSearchResponse {
        results,
        truncated,
        inspected_files,
    })
}

fn git_output(root: &Path, args: &[&str]) -> Result<String, String> {
    let output = Command::new("git")
        .args(args)
        .current_dir(root)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_PAGER", "cat")
        .output()
        .map_err(|_| "系统中找不到 Git，无法生成审查视图。".to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

fn append_limited(target: &mut String, source: &str, truncated: &mut bool) {
    let remaining = MAX_GIT_OUTPUT_BYTES.saturating_sub(target.len());
    if source.len() <= remaining {
        target.push_str(source);
        return;
    }
    let mut boundary = remaining;
    while boundary > 0 && !source.is_char_boundary(boundary) {
        boundary -= 1;
    }
    target.push_str(&source[..boundary]);
    *truncated = true;
}

#[tauri::command]
pub fn workspace_git_review(
    state: tauri::State<'_, ToolGatewayState>,
) -> Result<GitReview, String> {
    let root = workspace_root(&state)?;
    let branch = match git_output(&root, &["rev-parse", "--abbrev-ref", "HEAD"]) {
        Ok(value) => value.trim().to_string(),
        Err(_) => {
            return Ok(GitReview {
                is_repository: false,
                branch: String::new(),
                files: Vec::new(),
                diff: String::new(),
                truncated: false,
            })
        }
    };
    let status = git_output(
        &root,
        &[
            "status",
            "--porcelain=v1",
            "--untracked-files=normal",
            "--",
            ".",
        ],
    )?;
    let mut files = status
        .lines()
        .filter(|line| line.len() >= 3)
        .take(300)
        .map(|line| GitFileChange {
            status: line[..2].to_string(),
            path: line[3..].to_string(),
        })
        .collect::<Vec<_>>();
    files.sort_by(|left, right| left.path.cmp(&right.path));

    let staged = git_output(
        &root,
        &[
            "diff",
            "--cached",
            "--no-color",
            "--no-ext-diff",
            "--unified=3",
            "--",
            ".",
        ],
    )?;
    let unstaged = git_output(
        &root,
        &[
            "diff",
            "--no-color",
            "--no-ext-diff",
            "--unified=3",
            "--",
            ".",
        ],
    )?;
    let mut diff = String::new();
    let mut truncated = false;
    if !staged.is_empty() {
        diff.push_str("# STAGED\n");
        append_limited(&mut diff, &staged, &mut truncated);
    }
    if !unstaged.is_empty() && diff.len() < MAX_GIT_OUTPUT_BYTES {
        if !diff.is_empty() {
            diff.push_str("\n# UNSTAGED\n");
        }
        append_limited(&mut diff, &unstaged, &mut truncated);
    }
    if status.lines().count() > files.len() {
        truncated = true;
    }

    Ok(GitReview {
        is_repository: true,
        branch,
        files,
        diff,
        truncated,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_paths_that_escape_workspace() {
        assert!(!is_safe_relative(Path::new("../secret")));
        assert!(is_safe_relative(Path::new("src/main.rs")));
    }

    #[test]
    fn maps_common_source_languages() {
        assert_eq!(language_for(Path::new("src/App.tsx")), "typescript");
        assert_eq!(language_for(Path::new("Cargo.toml")), "toml");
    }

    #[test]
    fn ignores_generated_dependency_trees() {
        assert!(ignored_directory("node_modules"));
        assert!(ignored_directory("TARGET"));
        assert!(!ignored_directory("src"));
    }
}
