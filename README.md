# 🌌 Nebula Forge (星云锻造炉)

**Nebula Forge** 是一款基于 **Tauri + React** 构建的 AI 网页构建器。它默认支持 **Ollama** 本地模型，也可以切换到 **OrcaRouter** 作为可选云端 Provider，提供流式代码生成与实时渲染体验。

### ✨ 核心特性

- 🧠 **双 Provider 支持**：默认深度集成 Ollama，也可选择 OrcaRouter 调用云端大模型 API。
- 📡 **动态模型探测**：启动时自动扫描本地 Ollama 环境，智能列出已拉取的模型，断连自动提示防错。
- ☁️ **OrcaRouter 接入**：在侧边栏切换 Provider，填写 API Key 与模型 ID 后即可使用 OpenAI 兼容接口。
- ⚡ **流式代码跳字**：搭载优化的流式解析器，AI 输出的同时，代码在右侧**实时同步渲染**。
- 🌈 **智能代码高亮**：支持动态语言嗅探，无论生成 HTML 还是 Python，都能精准识别并实时高亮。
- 👁️ **即时沙盒预览**：内置安全沙盒环境，生成的代码一键切换为可视化交互网页。
- 📋 **一键纯净提取**：带有成功状态反馈的“一键复制”功能，生成的代码随用随取。
- 🎛️ **极简专注布局**：沉浸式工作台，底部固定输入区与自适应折叠侧边栏。

---

### 📦 下载与使用 (小白必看)

如果你只想使用本软件，无需配置代码环境，请按以下步骤操作：

1. **下载软件**：前往右侧的 **[Releases 页面](https://github.com/luyao001/nebula-forge/releases)** 下载最新的安装包并安装。
2. **安装 AI 大脑 (Ollama)**：
   - 前往 [Ollama 官网](https://ollama.com/) 下载并安装。
   - 打开系统终端 (cmd)，运行 `ollama pull qwen2.5-coder:7b` (或你喜欢的其他模型) 进行下载。
3. **开启跨域权限 (🚨非常重要)**：
   - 因为本软件属于第三方桌面应用，出于安全限制，必须授权跨域。
   - 打开 Windows 终端 (cmd)，执行命令：`setx OLLAMA_ORIGINS "*"`
   - 执行完毕后，请在电脑右下角托盘**彻底退出 Ollama**，然后再重新打开 Ollama。
4. 打开 Nebula Forge，左侧下拉菜单会自动刷出你的模型，开始你的锻造之旅！

#### 使用 OrcaRouter

1. 在左侧 `PROVIDER` 中选择 `OrcaRouter 云端`。
2. 在 `API KEY` 中填写你的 OrcaRouter API Key。
3. 从下拉菜单选择预置模型，或在自定义模型输入框中填写 OrcaRouter 支持的模型 ID。
4. 输入需求后发送，Nebula Forge 会通过 `https://api.orcarouter.ai/v1/chat/completions` 流式生成代码。

---

### 🛠️ 开发者指南

如果你想克隆代码进行二次开发：

```bash
# 1. 安装项目依赖
pnpm install

# 2. 启动本地开发环境
pnpm tauri dev

# 3. 打包生成可执行文件
pnpm tauri build
