# Nova

Nova（前身为 Nebula AI）是一款基于 Tauri + React 构建的本地优先 AI 工作台。它支持 Ollama 本地模型与 OrcaRouter 云端模型，把对话、可编辑成果、网页预览和文件导出放在同一个桌面应用里。

## 功能

- **四种工作模式**：网页构建、代码助手、内容创作、通用问答。
- **双 Provider**：自动探测 Ollama 本地模型，也可使用 OrcaRouter 兼容接口。
- **Agent 执行循环**：支持计划、工具调用、观察、修复与最多 20 步的多轮执行。
- **安全本地工具**：文件、受限命令和 URL 获取均由 Rust 网关校验；敏感操作需要明确授权。
- **透明授权**：`write_file` 授权弹窗展示逐行 diff，`run_command` 高亮白名单命中原因，`fetch_url` 展示域名与 DNS 解析摘要。
- **执行可观测**：实时展示 Agent 状态与累计 token 用量，工具输出与网页自检诊断（按严重度着色）可在时间线中按需查看；任务失败或中断后可一键重试。
- **网页自检**：Agent 网页模式在禁网沙盒中执行 DOM 与运行时检查，最多自动修复三轮。
- **任务快照**：保存计划、脱敏工具时间线、累计 token 用量和最终产物，支持搜索、按状态筛选，并可从侧栏恢复查看。
- **可靠流式输出**：正确处理跨网络分片的 NDJSON / SSE 数据，可随时停止生成。
- **成果工作区**：模型输出可以继续编辑、复制，并导出为 HTML、代码、Markdown 或文本文件。
- **安全网页预览**：生成的 HTML 在隔离 iframe 中运行，不继承应用权限。
- **桌面友好**：模型状态刷新、API Key 显示控制、响应式布局与键盘操作；Monaco 编辑器按需加载，不阻塞应用启动。

## 下载与使用

从 [Releases](https://github.com/luyao001/nova/releases) 下载最新 Windows 安装包。

### 使用 Ollama

1. 从 [Ollama 官网](https://ollama.com/) 安装 Ollama。
2. 拉取一个模型，例如：

~~~bash
ollama pull qwen2.5-coder:7b
~~~

3. Windows 用户首次使用时执行：

~~~powershell
setx OLLAMA_ORIGINS "*"
~~~

4. 完全退出并重新启动 Ollama，然后打开 Nova。若模型没有出现，点击左侧刷新按钮。

### 使用 OrcaRouter

1. 在左侧 Provider 中选择 OrcaRouter。
2. 输入 API Key，并选择或填写模型 ID。
3. API Key 仅保留在当前应用内存中，关闭应用后即清除，不会写入本地存储。

## 工作模式

| 模式 | 适合任务 | 默认成果 |
| --- | --- | --- |
| 网页构建 | 单页网站、组件原型、交互页面 | HTML + 沙盒预览 |
| 代码助手 | 编写脚本、修复错误、重构与解释代码 | 自动识别语言的代码 |
| 内容创作 | 文章、方案、邮件、提纲 | Markdown 文稿 |
| 通用问答 | 分析、总结、规划和开放式问题 | Markdown 回答 |

## Agent 模式

1. 在左侧 Execution 中选择“Agent · 多步执行”。
2. 通过系统目录选择器授权一个工作目录。该授权仅保留到应用关闭或更换目录。
3. 选择模型并提交任务。Agent 会先生成计划，再按需申请工具权限。
4. `write_file` 与 `fetch_url` 支持本次或本会话授权；`run_command` 始终逐条确认。
5. Agent 生成的文件必须先写入临时沙盒并完成检查，之后才能写入授权工作目录。

Agent 单任务最多执行 20 次模型迭代；工具参数连续两次无法解析或检测到重复调用循环时会安全终止。受限命令不接受 shell 字符串，只能在临时沙盒内运行允许的检查命令。

Agent 运行面板会实时显示计划进度、状态与累计 token 用量（OrcaRouter 流式请求会显式请求 usage 数据，并随任务快照持久化）；点击时间线条目可展开详情、查看工具输出原文与按严重度着色的自检诊断。任务失败或被中断后，面板底部提供"用同一任务重试"入口，已完成步骤与产物始终保留。任务历史使用首段指令生成简短标题，便于搜索和恢复。

## 本地开发

需要 Node.js、pnpm、Rust 和 Tauri 2 的系统依赖。

~~~bash
pnpm install
pnpm check
pnpm test
pnpm tauri dev
~~~

可选的真实浏览器回归需要 Python Playwright；安装后运行 `pnpm test:browser`。该脚本会自行启动并关闭临时 Vite 服务，验证密钥清理、Agent 工作区门禁和沙盒预览错误捕获。

Rust 网关回归：

~~~bash
cd src-tauri
cargo fmt --all -- --check
cargo clippy --locked -- -D warnings
cargo test --locked
~~~

构建桌面安装包：

~~~bash
pnpm tauri build
~~~

## 技术栈

- Tauri 2
- React 19 + TypeScript
- Vite 7
- Monaco Editor
- Ollama NDJSON API
- OrcaRouter OpenAI-compatible SSE API

## 隐私说明

Ollama 模式直接访问本机服务。OrcaRouter 模式会把当前对话发送到所选云端模型；API Key 只驻留内存，不会持久化。导出的文件只写入用户在保存对话框中选择的位置。Agent 任务快照不包含 API Key 或完整对话。

完整说明参见 [隐私政策](PRIVACY.md)。

## 卸载

在 Windows 中打开 **设置 → 应用 → 已安装的应用 → Nova → 卸载**。

## Code signing policy

Nova 正在申请 SignPath Foundation 的开源代码签名服务。v0.3.0 的自动签名发布流程已经就绪，并会在缺少可信签名时阻止发布。完整要求参见 [Code signing policy](CODE_SIGNING_POLICY.md) 和 [Trusted release setup](SIGNING_SETUP.md)。

Free code signing provided by [SignPath.io](https://about.signpath.io/), certificate by [SignPath Foundation](https://signpath.org/).

## 许可证

本项目采用 [MIT License](LICENSE)。
