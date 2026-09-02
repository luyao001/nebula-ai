import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Braces,
  Check,
  Cloud,
  Code,
  Copy,
  Cpu,
  Download,
  Eye,
  EyeOff,
  FolderOpen,
  KeyRound,
  LoaderCircle,
  MessageSquare,
  PanelLeftClose,
  RefreshCw,
  RotateCcw,
  Send,
  ShieldCheck,
  Sparkles,
  Square,
  Workflow,
} from "lucide-react";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { createOllamaProvider, createOpenAiCompatibleProvider } from "./providers";
import type { ProviderMessage } from "./providers";
import { runAgentTask } from "./agent/runner";
import type { AgentPlanStep, AgentState, AgentTimelineItem, AgentUsage } from "./agent/types";
import { AgentTimeline } from "./components/AgentTimeline";
import { PermissionDialog } from "./components/PermissionDialog";
import { TaskHistory } from "./components/TaskHistory";
import {
  listTaskSnapshots,
  loadTaskSnapshot,
  saveTaskSnapshot,
} from "./agent/task-store";
import type { TaskSummary } from "./agent/task-store";
import { auditHtmlInPreview } from "./tools/preview";
import {
  getWorkspaceStatus,
  selectWorkspaceRoot,
} from "./tools/gateway";
import type {
  PermissionDecision,
  PreparedToolCall,
  WorkspaceInfo,
} from "./tools/gateway";
import "./App.css";

const OLLAMA_API_URL = "http://localhost:11434/api/chat";
const OLLAMA_TAGS_URL = "http://localhost:11434/api/tags";
const ORCAROUTER_API_URL = "https://api.orcarouter.ai/v1/chat/completions";
const ORCAROUTER_DEFAULT_MODELS = [
  "orcarouter/auto",
  "deepseek/deepseek-v4-pro",
  "deepseek/deepseek-v4-flash",
  "qwen/qianwen-3.8",
];

const ollamaProvider = createOllamaProvider(OLLAMA_API_URL);
const orcaRouterProvider = createOpenAiCompatibleProvider({
  chatUrl: ORCAROUTER_API_URL,
  referer: "https://github.com/luyao001/nebula-ai",
  title: "Nova",
});

type Provider = "ollama" | "orcarouter";
type WorkspaceMode = "web" | "code" | "writing" | "assistant";
type ExecutionMode = "generate" | "agent";
type GenerationStatus = "idle" | "generating" | "done" | "stopped" | "error";
type OllamaStatus = "checking" | "online" | "offline";

type ChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

type OllamaModel = {
  name?: unknown;
};

type PendingPermission = {
  request: PreparedToolCall;
  resolve: (decision: PermissionDecision) => void;
};

type CurrentTaskMeta = {
  taskId: string;
  title: string;
  createdAt: number;
};

const MODE_CONFIG: Record<
  WorkspaceMode,
  {
    label: string;
    systemPrompt: string;
    welcome: string;
    placeholder: string;
    outputLabel: string;
    language: string;
    fileName: string;
    extension: string;
  }
> = {
  web: {
    label: "网页构建",
    systemPrompt:
      "你是 Nova 的网页工程助手。生成完整、可直接运行的单文件 HTML，" +
      "代码必须放在一个 html Markdown 代码块中。确保页面响应式、具有基本无障碍支持，解释保持简短。",
    welcome: "网页工作区已就绪。\n\n描述页面、视觉风格和关键交互，我会生成可编辑、可即时预览的完整 HTML。",
    placeholder: "描述页面、风格和关键交互...",
    outputLabel: "网页画布",
    language: "html",
    fileName: "nova-page.html",
    extension: "html",
  },
  code: {
    label: "代码助手",
    systemPrompt:
      "你是 Nova 的资深软件工程助手。根据需求生成、解释、重构或修复代码。" +
      "把主要成果放在一个带准确语言标记的 Markdown 代码块中，说明保持简洁，并指出必要的运行方式。",
    welcome: "代码工作区已就绪。\n\n可以让我编写脚本、修复错误、重构代码，或解释一段实现思路。",
    placeholder: "描述要编写、修复或重构的代码...",
    outputLabel: "代码成果",
    language: "plaintext",
    fileName: "nova-output.txt",
    extension: "txt",
  },
  writing: {
    label: "内容创作",
    systemPrompt:
      "你是 Nova 的中文写作伙伴。根据目标读者、语气和用途输出结构清晰的 Markdown 文稿。" +
      "保留事实边界，不编造来源；需要信息时明确标注待核实项。",
    welcome: "写作工作区已就绪。\n\n告诉我文稿类型、读者和语气，我会产出可继续编辑和导出的 Markdown 内容。",
    placeholder: "描述文稿类型、读者、语气和要点...",
    outputLabel: "文稿",
    language: "markdown",
    fileName: "nova-draft.md",
    extension: "md",
  },
  assistant: {
    label: "通用问答",
    systemPrompt:
      "你是 Nova 的通用助理。直接、准确地回答问题；复杂任务使用清晰结构，" +
      "不确定的信息要明确说明，不能假装完成外部操作。",
    welcome: "通用工作区已就绪。\n\n可以用它梳理问题、制定方案、总结信息或进行开放式问答。",
    placeholder: "输入问题或需要梳理的任务...",
    outputLabel: "回答",
    language: "markdown",
    fileName: "nova-answer.md",
    extension: "md",
  },
};

const LANGUAGE_EXTENSIONS: Record<string, string> = {
  css: "css",
  html: "html",
  javascript: "js",
  json: "json",
  markdown: "md",
  plaintext: "txt",
  python: "py",
  typescript: "ts",
};

const normalizeLanguage = (language: string) => {
  const value = language.toLowerCase();
  if (value.includes("python") || value === "py") return "python";
  if (value.includes("typescript") || value === "ts" || value === "tsx") return "typescript";
  if (value.includes("javascript") || value === "js" || value === "jsx") return "javascript";
  if (value.includes("css")) return "css";
  if (value.includes("json")) return "json";
  return "html";
};

const extractCode = (text: string) => {
  const fencePattern = new RegExp(
    "\\x60{3}([^\\s\\x60]*)[^\\n]*\\n([\\s\\S]*?)(?:\\x60{3}|$)",
  );
  const fenced = text.match(fencePattern);
  if (fenced) {
    return {
      language: normalizeLanguage(fenced[1] || "html"),
      code: fenced[2].trimEnd(),
    };
  }

  const trimmed = text.trimStart();
  if (/^(<!doctype\s+html|<html|<head|<body)/i.test(trimmed)) {
    return { language: "html", code: trimmed };
  }

  return null;
};

const isAbortError = (error: unknown) =>
  error instanceof DOMException && error.name === "AbortError";

// Monaco is heavy; load it (and its worker wiring) in an async chunk so the
// app shell paints without waiting for the editor bundle.
const CodeEditor = lazy(async () => {
  await import("./lib/monaco");
  const { default: MonacoEditor } = await import("@monaco-editor/react");
  return { default: MonacoEditor };
});

export default function App() {
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>(() => {
    const savedMode = localStorage.getItem("nebula_workspace_mode");
    return savedMode && savedMode in MODE_CONFIG ? (savedMode as WorkspaceMode) : "web";
  });
  const modeConfig = MODE_CONFIG[workspaceMode];
  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: "assistant", content: modeConfig.welcome },
  ]);
  const [generationStatus, setGenerationStatus] = useState<GenerationStatus>("idle");
  const [activeTab, setActiveTab] = useState<"code" | "preview">("code");
  const [generatedCode, setGeneratedCode] = useState("");
  const [currentLanguage, setCurrentLanguage] = useState(() => modeConfig.language);

  const [provider, setProvider] = useState<Provider>(() => {
    return localStorage.getItem("nebula_provider") === "orcarouter" ? "orcarouter" : "ollama";
  });
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [currentModel, setCurrentModel] = useState(
    () => localStorage.getItem("ollama_model") || "",
  );
  const [ollamaStatus, setOllamaStatus] = useState<OllamaStatus>("checking");
  const [orcaRouterApiKey, setOrcaRouterApiKey] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [orcaRouterModel, setOrcaRouterModel] = useState(
    () => localStorage.getItem("orcarouter_model") || ORCAROUTER_DEFAULT_MODELS[0],
  );
  const selectedModel = provider === "ollama" ? currentModel : orcaRouterModel.trim();

  const [isSidebarOpen, setIsSidebarOpen] = useState(() => window.innerWidth >= 900);
  const [isCopied, setIsCopied] = useState(false);
  const [executionMode, setExecutionMode] = useState<ExecutionMode>(() =>
    localStorage.getItem("nebula_execution_mode") === "agent" ? "agent" : "generate",
  );
  const [workspaceInfo, setWorkspaceInfo] = useState<WorkspaceInfo | null>(null);
  const [workspaceError, setWorkspaceError] = useState("");
  const [agentState, setAgentState] = useState<AgentState>("idle");
  const [agentPlan, setAgentPlan] = useState<AgentPlanStep[]>([]);
  const [agentTimeline, setAgentTimeline] = useState<AgentTimelineItem[]>([]);
  const [pendingPermission, setPendingPermission] = useState<PendingPermission | null>(null);
  const [currentTaskMeta, setCurrentTaskMeta] = useState<CurrentTaskMeta | null>(null);
  const [taskSummaries, setTaskSummaries] = useState<TaskSummary[]>([]);
  const [taskHistoryError, setTaskHistoryError] = useState("");
  const [agentUsage, setAgentUsage] = useState<AgentUsage | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const streamBuffer = useRef("");
  const abortController = useRef<AbortController | null>(null);
  const lastAgentTaskRef = useRef<string | null>(null);
  const isLoading = generationStatus === "generating";

  const fetchLocalModels = useCallback(async () => {
    setOllamaStatus("checking");
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 5000);

    try {
      const response = await fetch(OLLAMA_TAGS_URL, { signal: controller.signal });
      if (!response.ok) throw new Error("Ollama not responding");

      const data = (await response.json()) as { models?: OllamaModel[] };
      const models = Array.isArray(data.models)
        ? data.models
            .map((model) => model.name)
            .filter((name): name is string => typeof name === "string" && Boolean(name))
        : [];

      setAvailableModels(models);
      setCurrentModel((selected) => {
        const nextModel = models.includes(selected) ? selected : models[0] || "";
        if (nextModel) localStorage.setItem("ollama_model", nextModel);
        return nextModel;
      });
      setOllamaStatus("online");
    } catch (error) {
      if (!isAbortError(error)) console.info("Ollama is unavailable.");
      setAvailableModels([]);
      setOllamaStatus("offline");
    } finally {
      window.clearTimeout(timeoutId);
    }
  }, []);

  useEffect(() => {
    void fetchLocalModels();
    return () => abortController.current?.abort();
  }, [fetchLocalModels]);

  useEffect(() => {
    localStorage.setItem("nebula_provider", provider);
  }, [provider]);

  useEffect(() => {
    localStorage.setItem("nebula_workspace_mode", workspaceMode);
  }, [workspaceMode]);

  useEffect(() => {
    localStorage.setItem("nebula_execution_mode", executionMode);
  }, [executionMode]);

  useEffect(() => {
    void getWorkspaceStatus()
      .then(setWorkspaceInfo)
      .catch(() => setWorkspaceInfo(null));
  }, []);

  const refreshTaskHistory = useCallback(async () => {
    try {
      setTaskSummaries(await listTaskSnapshots());
      setTaskHistoryError("");
    } catch (error) {
      setTaskHistoryError(error instanceof Error ? error.message : String(error));
    }
  }, []);

  useEffect(() => {
    void refreshTaskHistory();
  }, [refreshTaskHistory]);

  useEffect(() => {
    if (!currentTaskMeta) return;
    const timeoutId = window.setTimeout(() => {
      const finalArtifact =
        agentState === "completed" && generatedCode
          ? { language: currentLanguage, content: generatedCode }
          : null;
      void saveTaskSnapshot({
        schemaVersion: 1,
        taskId: currentTaskMeta.taskId,
        title: currentTaskMeta.title,
        mode: workspaceMode,
        provider,
        model: selectedModel,
        status: agentState,
        plan: agentPlan,
        toolLog: agentTimeline.map((item) => ({
          ...item,
          detail: item.detail?.slice(0, 1000),
        })),
        finalArtifact,
        usage: agentUsage,
        createdAt: currentTaskMeta.createdAt,
        updatedAt: Date.now(),
      })
        .then(() => {
          if (agentState === "completed" || agentState === "error" || agentState === "stopped") {
            void refreshTaskHistory();
          }
        })
        .catch((error) => setTaskHistoryError(error instanceof Error ? error.message : String(error)));
    }, 350);
    return () => window.clearTimeout(timeoutId);
  }, [
    agentPlan,
    agentState,
    agentTimeline,
    agentUsage,
    currentLanguage,
    currentTaskMeta,
    generatedCode,
    provider,
    refreshTaskHistory,
    selectedModel,
    workspaceMode,
  ]);

  useEffect(() => {
    if (currentModel) localStorage.setItem("ollama_model", currentModel);
  }, [currentModel]);

  useEffect(() => {
    localStorage.setItem("orcarouter_model", orcaRouterModel);
  }, [orcaRouterModel]);

  useEffect(() => {
    // Agent migration: API keys are memory-only. Remove values saved by older releases.
    localStorage.removeItem("orcarouter_api_key");
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: "smooth",
      });
    }
  }, [messages]);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && abortController.current) {
        abortController.current.abort();
      }
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, []);

  const canSend = Boolean(
    prompt.trim() &&
      !isLoading &&
      selectedModel &&
      (provider === "ollama" || orcaRouterApiKey.trim()) &&
      (executionMode === "generate" || workspaceInfo),
  );
  const canPreview =
    workspaceMode === "web" && currentLanguage === "html" && Boolean(generatedCode.trim());

  const statusLabel = useMemo(() => {
    if (generationStatus === "generating") {
      return executionMode === "agent" ? "Agent 执行中" : "正在生成";
    }
    if (generationStatus === "done") return "代码已就绪";
    if (generationStatus === "stopped") return "生成已停止";
    if (generationStatus === "error") return "生成失败";
    return "等待新构想";
  }, [executionMode, generationStatus]);

  const syncAssistantMessage = (content: string) => {
    setMessages((previous) =>
      previous.map((message, index) =>
        index === previous.length - 1 ? { ...message, content } : message,
      ),
    );

    const result = extractCode(content);
    if (result) {
      setGeneratedCode(result.code);
      setCurrentLanguage(result.language);
    } else if (workspaceMode === "writing" || workspaceMode === "assistant") {
      setGeneratedCode(content);
      setCurrentLanguage("markdown");
    } else if (workspaceMode === "code") {
      setGeneratedCode(content);
      setCurrentLanguage("plaintext");
    }
  };

  const handleCopy = async () => {
    if (!generatedCode) return;
    try {
      await navigator.clipboard.writeText(generatedCode);
      setIsCopied(true);
      window.setTimeout(() => setIsCopied(false), 1800);
    } catch {
      setIsCopied(false);
    }
  };

  const handleReset = () => {
    abortController.current?.abort();
    pendingPermission?.resolve("deny");
    setPendingPermission(null);
    setMessages([{ role: "assistant", content: modeConfig.welcome }]);
    setGeneratedCode("");
    setPrompt("");
    setGenerationStatus("idle");
    setActiveTab("code");
    setCurrentLanguage(modeConfig.language);
    setAgentState("idle");
    setAgentPlan([]);
    setAgentTimeline([]);
    setAgentUsage(null);
    setCurrentTaskMeta(null);
  };

  const handleModeChange = (nextMode: WorkspaceMode) => {
    abortController.current?.abort();
    const nextConfig = MODE_CONFIG[nextMode];
    setWorkspaceMode(nextMode);
    setMessages([{ role: "assistant", content: nextConfig.welcome }]);
    setGeneratedCode("");
    setPrompt("");
    setGenerationStatus("idle");
    setActiveTab("code");
    setCurrentLanguage(nextConfig.language);
    setAgentState("idle");
    setAgentPlan([]);
    setAgentTimeline([]);
    setAgentUsage(null);
  };

  const handleExport = async () => {
    if (!generatedCode) return;
    const extension =
      workspaceMode === "code"
        ? LANGUAGE_EXTENSIONS[currentLanguage] || "txt"
        : modeConfig.extension;
    const fileName =
      workspaceMode === "code" ? "nebula-output." + extension : modeConfig.fileName;

    try {
      const path = await save({
        defaultPath: fileName,
        filters: [{ name: modeConfig.outputLabel, extensions: [extension] }],
      });
      if (path) await writeTextFile(path, generatedCode);
      return;
    } catch {
      const blob = new Blob([generatedCode], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = fileName;
      anchor.click();
      URL.revokeObjectURL(url);
    }
  };

  const handleStop = () => {
    abortController.current?.abort();
    pendingPermission?.resolve("deny");
    setPendingPermission(null);
  };

  const handleSelectWorkspace = async () => {
    setWorkspaceError("");
    try {
      const selected = await selectWorkspaceRoot();
      if (selected) setWorkspaceInfo(selected);
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : String(error));
    }
  };

  const handleOpenTask = async (taskId: string) => {
    setTaskHistoryError("");
    try {
      const snapshot = await loadTaskSnapshot(taskId);
      abortController.current?.abort();
      setExecutionMode("agent");
      setWorkspaceMode(snapshot.mode);
      setProvider(snapshot.provider);
      if (snapshot.provider === "ollama") setCurrentModel(snapshot.model);
      else setOrcaRouterModel(snapshot.model);
      setAgentState(snapshot.status);
      setAgentPlan(snapshot.plan);
      setAgentTimeline(snapshot.toolLog);
      setAgentUsage(snapshot.usage ?? null);
      setCurrentTaskMeta({
        taskId: snapshot.taskId,
        title: snapshot.title,
        createdAt: snapshot.createdAt,
      });
      if (snapshot.finalArtifact) {
        setGeneratedCode(snapshot.finalArtifact.content);
        setCurrentLanguage(snapshot.finalArtifact.language);
        setActiveTab(snapshot.mode === "web" ? "preview" : "code");
      } else {
        setGeneratedCode("");
        setCurrentLanguage(MODE_CONFIG[snapshot.mode].language);
        setActiveTab("code");
      }
      setMessages([
        { role: "assistant", content: MODE_CONFIG[snapshot.mode].welcome },
        { role: "assistant", content: `已恢复任务快照：${snapshot.title}\n\n状态：${snapshot.status}` },
      ]);
      setGenerationStatus(snapshot.status === "completed" ? "done" : "idle");
    } catch (error) {
      setTaskHistoryError(error instanceof Error ? error.message : String(error));
    }
  };

  const handlePermissionDecision = (decision: PermissionDecision) => {
    const pending = pendingPermission;
    setPendingPermission(null);
    pending?.resolve(decision);
  };

  const handleSend = async (overrideText?: string) => {
    const requested = (overrideText ?? prompt).trim();
    if (!requested || isLoading) return;
    if (
      !selectedModel ||
      (provider === "orcarouter" && !orcaRouterApiKey.trim()) ||
      (executionMode === "agent" && !workspaceInfo)
    ) {
      return;
    }

    const userMessage: ChatMessage = { role: "user", content: requested };
    const requestMessages: ProviderMessage[] = [
      { role: "system", content: modeConfig.systemPrompt },
      ...messages.slice(1).filter((message) => message.content),
      userMessage,
    ];

    setMessages((previous) => [
      ...previous,
      userMessage,
      { role: "assistant", content: "" },
    ]);
    setPrompt("");
    setGenerationStatus("generating");
    if (executionMode === "agent") {
      lastAgentTaskRef.current = userMessage.content;
      const createdAt = Date.now();
      setCurrentTaskMeta({
        taskId: crypto.randomUUID(),
        title: `${modeConfig.label} Agent 任务`,
        createdAt,
      });
    } else {
      setCurrentTaskMeta(null);
    }
    streamBuffer.current = "";

    const controller = new AbortController();
    abortController.current = controller;

    const onContent = (content: string) => {
      streamBuffer.current += content;
      syncAssistantMessage(streamBuffer.current);
    };

    try {
      const activeProvider = provider === "ollama" ? ollamaProvider : orcaRouterProvider;
      if (executionMode === "agent") {
        setAgentPlan([]);
        setAgentTimeline([]);
        setAgentState("planning");
        setAgentUsage(null);
        let currentTurn = "";
        const result = await runAgentTask({
          provider: activeProvider,
          model: selectedModel,
          apiKey: provider === "orcarouter" ? orcaRouterApiKey : undefined,
          systemPrompt: modeConfig.systemPrompt,
          task: userMessage.content,
          history: requestMessages.slice(1, -1),
          webMode: workspaceMode === "web",
          signal: controller.signal,
          auditPreview: auditHtmlInPreview,
          requestPermission: (request) =>
            new Promise<PermissionDecision>((resolve) => {
              const handleAbort = () => {
                setPendingPermission(null);
                resolve("deny");
              };
              controller.signal.addEventListener("abort", handleAbort, { once: true });
              setPendingPermission({
                request,
                resolve: (decision) => {
                  controller.signal.removeEventListener("abort", handleAbort);
                  resolve(decision);
                },
              });
            }),
          onEvent: (event) => {
            if (event.type === "state") setAgentState(event.state);
            if (event.type === "plan") setAgentPlan(event.steps);
            if (event.type === "usage") setAgentUsage(event.usage);
            if (event.type === "timeline") {
              setAgentTimeline((previous) => [...previous, event.item]);
            }
            if (event.type === "model_started") {
              currentTurn = "";
              streamBuffer.current = "";
            }
            if (event.type === "content_delta") {
              currentTurn += event.content;
              streamBuffer.current = currentTurn;
              syncAssistantMessage(currentTurn);
            }
          },
        });
        if (result.content) syncAssistantMessage(result.content);
        if (result.artifact) {
          setGeneratedCode(result.artifact);
          setCurrentLanguage("html");
          setActiveTab("preview");
        }
      } else {
        await activeProvider.streamChat(
          {
            model: selectedModel,
            messages: requestMessages,
            apiKey: provider === "orcarouter" ? orcaRouterApiKey : undefined,
            signal: controller.signal,
          },
          (event) => {
            if (event.type === "content_delta") onContent(event.content);
          },
        );
      }

      if (!streamBuffer.current && executionMode === "generate") {
        throw new Error("模型没有返回内容，请重试。");
      }
      setGenerationStatus("done");
    } catch (error) {
      if (isAbortError(error)) {
        if (!streamBuffer.current) syncAssistantMessage("已停止生成。");
        setAgentState("stopped");
        setGenerationStatus("stopped");
        if (executionMode === "agent") {
          setAgentTimeline((previous) => [
            ...previous,
            {
              id: crypto.randomUUID(),
              kind: "stopped",
              title: "任务已中断",
              detail: "已完成步骤、时间线与产物已保留；可用下方按钮重试，或从任务历史恢复。",
              status: "error",
              timestamp: Date.now(),
            },
          ]);
        }
      } else {
        const detail = error instanceof Error ? error.message : "未知错误";
        const prefix =
          executionMode === "agent"
            ? "Agent 执行失败。\n\n"
            : provider === "ollama"
              ? "无法连接 Ollama。\n\n请确认服务已启动、模型可用，然后点击左侧刷新按钮重试。\n"
              : "OrcaRouter 请求失败。\n\n请检查 API Key、模型 ID 和网络连接。\n";
        syncAssistantMessage(prefix + detail);
        setAgentState("error");
        setGenerationStatus("error");
      }
    } finally {
      setPendingPermission(null);
      abortController.current = null;
    }
  };

  return (
    <div className="nf-app">
      <header className="nf-header">
        <div className="nf-header-left">
          <button
            className="nf-icon-button"
            onClick={() => setIsSidebarOpen((open) => !open)}
            aria-label={isSidebarOpen ? "收起设置" : "展开设置"}
            title={isSidebarOpen ? "收起设置" : "展开设置"}
          >
            <PanelLeftClose
              size={18}
              style={{ transform: isSidebarOpen ? "none" : "rotate(180deg)" }}
            />
          </button>
          <div className="nf-brand" aria-label="Nova">
            <span className="nf-brand-mark"><Sparkles size={17} /></span>
            <span className="nf-brand-copy">
              <strong>Nova</strong>
              <small>LOCAL · CLOUD · YOURS</small>
            </span>
          </div>
        </div>

        <div className="nf-header-right">
          <div className={"nf-status " + generationStatus} aria-live="polite">
            <span className="nf-status-dot" />
            <span>{statusLabel}</span>
          </div>
          <div className="nf-tab-group" aria-label="输出视图">
            <button
              className={activeTab === "code" ? "active" : ""}
              onClick={() => setActiveTab("code")}
              aria-pressed={activeTab === "code"}
            >
              <Code size={15} /> <span className="hide-sm">代码</span>
            </button>
            <button
              className={activeTab === "preview" ? "active" : ""}
              onClick={() => setActiveTab("preview")}
              aria-pressed={activeTab === "preview"}
              disabled={workspaceMode !== "web"}
              title={workspaceMode === "web" ? "预览网页" : "仅网页构建模式支持预览"}
            >
              <Eye size={15} /> <span className="hide-sm">预览</span>
            </button>
          </div>
          <button
            className="nf-export-button"
            onClick={() => void handleExport()}
            disabled={!generatedCode}
            title="导出成果"
            aria-label="导出成果"
          >
            <Download size={16} />
          </button>
          <button
            className="nf-copy-button"
            onClick={() => void handleCopy()}
            disabled={!generatedCode}
          >
            {isCopied ? <Check size={16} /> : <Copy size={16} />}
            <span className="hide-sm">{isCopied ? "已复制" : "复制代码"}</span>
          </button>
        </div>
      </header>

      <main className="nf-body">
        <aside className={"nf-sidebar " + (isSidebarOpen ? "open" : "closed")}>
          <div className="nf-sidebar-inner">
            <div className="nf-rail-heading">
              <div>
                <span className="nf-eyebrow">WORKSPACE</span>
                <h2>工作区设置</h2>
              </div>
              <ShieldCheck size={18} />
            </div>

            <div className="nf-model-box">
              <label className="nf-model-label" htmlFor="workspace-mode">
                <Braces size={13} /> Mode
              </label>
              <select
                id="workspace-mode"
                value={workspaceMode}
                onChange={(event) => handleModeChange(event.target.value as WorkspaceMode)}
                className="nf-select"
                disabled={isLoading}
              >
                {(Object.keys(MODE_CONFIG) as WorkspaceMode[]).map((mode) => (
                  <option key={mode} value={mode}>{MODE_CONFIG[mode].label}</option>
                ))}
              </select>

              <label className="nf-model-label" htmlFor="execution-mode">
                <Workflow size={13} /> Execution
              </label>
              <select
                id="execution-mode"
                value={executionMode}
                onChange={(event) => setExecutionMode(event.target.value as ExecutionMode)}
                className="nf-select"
                disabled={isLoading}
              >
                <option value="generate">普通生成 · 单轮</option>
                <option value="agent">Agent · 多步执行</option>
              </select>

              {executionMode === "agent" && (
                <div className="nf-workspace-auth">
                  <button type="button" onClick={() => void handleSelectWorkspace()} disabled={isLoading}>
                    <FolderOpen size={14} />
                    {workspaceInfo ? "更换工作目录" : "选择工作目录"}
                  </button>
                  {workspaceInfo && <small title={workspaceInfo.workspacePath}>{workspaceInfo.workspacePath}</small>}
                  {workspaceError && <small className="error">{workspaceError}</small>}
                </div>
              )}

              <label className="nf-model-label" htmlFor="provider">
                <Cloud size={13} /> Provider
              </label>
              <select
                id="provider"
                value={provider}
                onChange={(event) => setProvider(event.target.value as Provider)}
                className="nf-select"
                disabled={isLoading}
              >
                <option value="ollama">Ollama · 本地</option>
                <option value="orcarouter">OrcaRouter · 云端</option>
              </select>

              {provider === "ollama" ? (
                <>
                  <div className="nf-label-row">
                    <label className="nf-model-label" htmlFor="ollama-model">
                      <Cpu size={13} /> Model
                    </label>
                    <button
                      className="nf-refresh-button"
                      onClick={() => void fetchLocalModels()}
                      disabled={ollamaStatus === "checking" || isLoading}
                      aria-label="刷新 Ollama 模型"
                      title="刷新 Ollama 模型"
                    >
                      <RefreshCw
                        size={13}
                        className={ollamaStatus === "checking" ? "is-spinning" : ""}
                      />
                    </button>
                  </div>
                  <select
                    id="ollama-model"
                    value={currentModel}
                    onChange={(event) => setCurrentModel(event.target.value)}
                    disabled={ollamaStatus !== "online" || availableModels.length === 0 || isLoading}
                    className={"nf-select " + (ollamaStatus === "offline" ? "error" : "")}
                  >
                    {ollamaStatus === "checking" ? (
                      <option value="">正在探测...</option>
                    ) : ollamaStatus === "offline" ? (
                      <option value="">未连接 Ollama</option>
                    ) : availableModels.length === 0 ? (
                      <option value="">尚未安装模型</option>
                    ) : (
                      availableModels.map((model) => (
                        <option key={model} value={model}>{model}</option>
                      ))
                    )}
                  </select>
                  <div className={"nf-connection " + ollamaStatus}>
                    <span />
                    {ollamaStatus === "checking"
                      ? "正在检查本地服务"
                      : ollamaStatus === "online"
                        ? "本地连接可用"
                        : "服务离线，启动后刷新"}
                  </div>
                </>
              ) : (
                <>
                  <label className="nf-model-label" htmlFor="orcarouter-model">
                    <Cpu size={13} /> Model ID
                  </label>
                  <input
                    id="orcarouter-model"
                    className="nf-provider-input nf-utility"
                    list="orcarouter-models"
                    value={orcaRouterModel}
                    onChange={(event) => setOrcaRouterModel(event.target.value)}
                    placeholder="输入或选择模型 ID"
                    disabled={isLoading}
                  />
                  <datalist id="orcarouter-models">
                    {ORCAROUTER_DEFAULT_MODELS.map((model) => (
                      <option key={model} value={model} />
                    ))}
                  </datalist>

                  <label className="nf-model-label" htmlFor="orcarouter-key">
                    <KeyRound size={13} /> API Key
                  </label>
                  <div className="nf-secret-field">
                    <input
                      id="orcarouter-key"
                      className="nf-provider-input"
                      type={showApiKey ? "text" : "password"}
                      value={orcaRouterApiKey}
                      onChange={(event) => setOrcaRouterApiKey(event.target.value)}
                      placeholder="输入 OrcaRouter API Key"
                      autoComplete="off"
                      disabled={isLoading}
                    />
                    <button
                      type="button"
                      onClick={() => setShowApiKey((visible) => !visible)}
                      aria-label={showApiKey ? "隐藏 API Key" : "显示 API Key"}
                    >
                      {showApiKey ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                </>
              )}
            </div>

            {executionMode === "agent" && (
              <TaskHistory
                tasks={taskSummaries}
                error={taskHistoryError}
                onRefresh={() => void refreshTaskHistory()}
                onOpen={(taskId) => void handleOpenTask(taskId)}
              />
            )}

            <div className="nf-sidebar-spacer" />

            <div className="nf-privacy-note">
              <ShieldCheck size={15} />
              <p>
                {provider === "ollama"
                  ? "本地模式直接连接你的 Ollama 服务。"
                  : "密钥仅保留在当前应用内存中，关闭后即清除。"}
              </p>
            </div>

            <button className="nf-reset-button" onClick={handleReset}>
              <RotateCcw size={14} /> 清空当前任务
            </button>
          </div>
        </aside>

        <section className="nf-workspace">
          <div className="nf-chat">
            <div className="nf-panel-heading">
              <div>
                <MessageSquare size={14} />
                <span>{modeConfig.label}</span>
              </div>
              <small>{messages.filter((message) => message.role === "user").length} 条指令</small>
            </div>
            {executionMode === "agent" && (agentPlan.length > 0 || agentTimeline.length > 0) && (
              <AgentTimeline
                state={agentState}
                plan={agentPlan}
                items={agentTimeline}
                usage={agentUsage}
                canRetry={
                  (generationStatus === "error" || generationStatus === "stopped") &&
                  Boolean(lastAgentTaskRef.current)
                }
                onRetry={() => {
                  const retryTask = lastAgentTaskRef.current;
                  if (retryTask) void handleSend(retryTask);
                }}
              />
            )}
            <div className="nf-messages" ref={scrollRef} aria-live="polite">
              {messages.map((message, index) => (
                <article key={index} className={"nf-message " + message.role}>
                  <div className="nf-avatar">{message.role === "user" ? "YOU" : "NV"}</div>
                  <div className="nf-content">
                    {message.content ||
                      (isLoading && index === messages.length - 1 ? (
                        <span className="nf-thinking">
                          <LoaderCircle size={14} className="is-spinning" /> 正在组织代码
                        </span>
                      ) : null)}
                  </div>
                </article>
              ))}
            </div>
            <div className="nf-input-container">
              <label className="sr-only" htmlFor="forge-prompt">描述要构建的网页</label>
              <div className="nf-input-wrapper">
                <textarea
                  id="forge-prompt"
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void handleSend();
                    }
                  }}
                  placeholder={
                    !selectedModel
                      ? "先在左侧连接一个模型..."
                      : executionMode === "agent" && !workspaceInfo
                        ? "先为 Agent 选择一个工作目录..."
                      : provider === "orcarouter" && !orcaRouterApiKey.trim()
                        ? "先填写 OrcaRouter API Key..."
                        : modeConfig.placeholder
                  }
                  disabled={
                    !selectedModel ||
                    (provider === "orcarouter" && !orcaRouterApiKey.trim()) ||
                    (executionMode === "agent" && !workspaceInfo)
                  }
                  rows={4}
                />
                <div className="nf-input-footer">
                  <span>Enter 发送 · Shift+Enter 换行</span>
                  {isLoading ? (
                    <button className="nf-stop-button" onClick={handleStop} title="停止生成 (Esc)">
                      <Square size={13} fill="currentColor" /> 停止
                    </button>
                  ) : (
                    <button
                      className="nf-send-button"
                      onClick={() => void handleSend()}
                      disabled={!canSend}
                      aria-label="发送构想"
                    >
                      <Send size={17} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="nf-output">
            <div className="nf-panel-heading nf-output-heading">
              <div>
                <Braces size={14} />
                <span>{modeConfig.outputLabel}</span>
              </div>
              <div className="nf-output-meta">
                <span className="nf-language">{currentLanguage}</span>
                <span>{generatedCode.length.toLocaleString()} 字符</span>
              </div>
            </div>
            <div className={"nf-frame-container " + (isLoading ? "is-forging" : "")}>
              {activeTab === "code" ? (
                <Suspense
                  fallback={
                    <div className="nf-editor-loading">
                      <LoaderCircle size={16} className="is-spinning" /> 正在加载编辑器
                    </div>
                  }
                >
                  <CodeEditor
                    height="100%"
                    language={currentLanguage}
                    theme="vs-dark"
                    value={generatedCode}
                    onChange={(value) => setGeneratedCode(value || "")}
                    options={{
                      fontFamily: "'Cascadia Code', 'SFMono-Regular', Consolas, monospace",
                      fontSize: 13,
                      lineHeight: 21,
                      minimap: { enabled: false },
                      readOnly: isLoading,
                      wordWrap: "on",
                      padding: { top: 18, bottom: 18 },
                      renderLineHighlight: "line",
                      smoothScrolling: true,
                      scrollBeyondLastLine: false,
                      automaticLayout: true,
                    }}
                  />
                </Suspense>
              ) : canPreview ? (
                <iframe
                  srcDoc={generatedCode}
                  title="生成网页预览"
                  sandbox="allow-scripts"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="nf-empty-output">
                  <span><Code size={24} /></span>
                  <h3>还没有可预览的网页</h3>
                  <p>
                    {generatedCode
                      ? "当前输出不是 HTML；你仍可以在代码视图中编辑或复制。"
                      : "发送一个构想，生成结果会在这里实时出现。"}
                  </p>
                  {generatedCode && (
                    <button onClick={() => setActiveTab("code")}>返回代码</button>
                  )}
                </div>
              )}
            </div>
          </div>
        </section>
      </main>
      {pendingPermission && (
        <PermissionDialog
          request={pendingPermission.request}
          onDecision={handlePermissionDecision}
        />
      )}
    </div>
  );
}
