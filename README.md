# Nebula AI

Nebula AI 是一款基于 Tauri + React 构建的本地优先 AI 工作台。它支持 Ollama 本地模型与 OrcaRouter 云端模型，把对话、可编辑成果、网页预览和文件导出放在同一个桌面应用里。

## 功能

- **四种工作模式**：网页构建、代码助手、内容创作、通用问答。
- **双 Provider**：自动探测 Ollama 本地模型，也可使用 OrcaRouter 兼容接口。
- **可靠流式输出**：正确处理跨网络分片的 NDJSON / SSE 数据，可随时停止生成。
- **成果工作区**：模型输出可以继续编辑、复制，并导出为 HTML、代码、Markdown 或文本文件。
- **安全网页预览**：生成的 HTML 在隔离 iframe 中运行，不继承应用权限。
- **桌面友好**：模型状态刷新、API Key 显示控制、响应式布局与键盘操作。

## 下载与使用

从 [Releases](https://github.com/luyao001/nebula-ai/releases) 下载最新 Windows 安装包。

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

4. 完全退出并重新启动 Ollama，然后打开 Nebula AI。若模型没有出现，点击左侧刷新按钮。

### 使用 OrcaRouter

1. 在左侧 Provider 中选择 OrcaRouter。
2. 输入 API Key，并选择或填写模型 ID。
3. “在此设备记住密钥”默认关闭；开启后密钥会保存在当前设备的本地存储中。

## 工作模式

| 模式 | 适合任务 | 默认成果 |
| --- | --- | --- |
| 网页构建 | 单页网站、组件原型、交互页面 | HTML + 沙盒预览 |
| 代码助手 | 编写脚本、修复错误、重构与解释代码 | 自动识别语言的代码 |
| 内容创作 | 文章、方案、邮件、提纲 | Markdown 文稿 |
| 通用问答 | 分析、总结、规划和开放式问题 | Markdown 回答 |

## 本地开发

需要 Node.js、pnpm、Rust 和 Tauri 2 的系统依赖。

~~~bash
pnpm install
pnpm check
pnpm tauri dev
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

Ollama 模式直接访问本机服务。OrcaRouter 模式会把当前对话发送到所选云端模型；API Key 是否持久化由“在此设备记住密钥”控制。导出的文件只写入用户在保存对话框中选择的位置。

完整说明参见 [隐私政策](PRIVACY.md)。

## 卸载

在 Windows 中打开 **设置 → 应用 → 已安装的应用 → Nebula AI → 卸载**。

## Code signing policy

Nebula AI 正在申请 SignPath Foundation 的开源代码签名服务。v0.2.1 的自动签名发布流程已经就绪，并会在缺少可信签名时阻止发布。完整要求参见 [Code signing policy](CODE_SIGNING_POLICY.md) 和 [Trusted release setup](SIGNING_SETUP.md)。

Free code signing provided by [SignPath.io](https://about.signpath.io/), certificate by [SignPath Foundation](https://signpath.org/).

## 许可证

本项目采用 [MIT License](LICENSE)。
