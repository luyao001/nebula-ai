import { useState, useRef, useEffect } from "react";
import Editor from "@monaco-editor/react";
import { Send, Code, Eye, Cpu, Sparkles, MessageSquare, PanelLeftClose, Copy, Check, Cloud, KeyRound } from 'lucide-react';
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

type Provider = "ollama" | "orcarouter";
type ChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

export default function App() {
  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([{ 
    role: "assistant", 
    content: "星云锻造炉已就绪。\n\n你可以使用本地 Ollama，也可以切换到 OrcaRouter 调用云端模型。" 
  }]);
  const [isLoading, setIsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<"code" | "preview">("code");
  const [generatedCode, setGeneratedCode] = useState("");
  const [currentLanguage, setCurrentLanguage] = useState("html");
  
  const [provider, setProvider] = useState<Provider>("ollama");
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [currentModel, setCurrentModel] = useState("");
  const [isOllamaRunning, setIsOllamaRunning] = useState(true);
  const [orcaRouterApiKey, setOrcaRouterApiKey] = useState(() => localStorage.getItem("orcarouter_api_key") || "");
  const [orcaRouterModel, setOrcaRouterModel] = useState(() => localStorage.getItem("orcarouter_model") || ORCAROUTER_DEFAULT_MODELS[0]);

  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isCopied, setIsCopied] = useState(false);
  
  const scrollRef = useRef<HTMLDivElement>(null);
  const streamBuffer = useRef("");

  useEffect(() => {
    const fetchLocalModels = async () => {
      try {
        const response = await fetch(OLLAMA_TAGS_URL);
        if (!response.ok) throw new Error("Ollama not responding");
        
        const data = await response.json();
        const models = data.models.map((m: any) => m.name); // 提取模型名称
        
        setAvailableModels(models);
        if (models.length > 0) {
          setCurrentModel(models[0]); // 默认选中第一个本地模型
        }
        setIsOllamaRunning(true);
      } catch (error) {
        console.error("无法连接到本地 Ollama:", error);
        setIsOllamaRunning(false);
        setAvailableModels([]);
      }
    };

    fetchLocalModels();
  }, []);

  useEffect(() => {
    localStorage.setItem("orcarouter_api_key", orcaRouterApiKey);
  }, [orcaRouterApiKey]);

  useEffect(() => {
    localStorage.setItem("orcarouter_model", orcaRouterModel);
  }, [orcaRouterModel]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  const extractCodeStreaming = (text: string) => {
    const regex = /```(\w*)\n?([\s\S]*?)(?:```|$)/;
    const match = text.match(regex);
    if (match) {
      return { lang: match[1] || "html", code: match[2] };
    }
    return null;
  };

  const handleCopy = async () => {
    if (!generatedCode) return;
    await navigator.clipboard.writeText(generatedCode);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000); 
  };

  const getSelectedModel = () => provider === "ollama" ? currentModel : orcaRouterModel.trim();
  const canSend = Boolean(prompt.trim() && !isLoading && getSelectedModel() && (provider === "ollama" || orcaRouterApiKey.trim()));

  const syncAssistantMessage = (content: string) => {
    setMessages(prev => {
      const newMsgs = [...prev];
      newMsgs[newMsgs.length - 1].content = content;
      return newMsgs;
    });

    const result = extractCodeStreaming(content);
    if (result) {
      setGeneratedCode(result.code);
      const lang = result.lang.toLowerCase();
      if (lang.includes('py') && currentLanguage !== 'python') setCurrentLanguage('python');
      else if ((lang.includes('html') || lang === '') && currentLanguage !== 'html') setCurrentLanguage('html');
      else if (lang.includes('js') && currentLanguage !== 'javascript') setCurrentLanguage('javascript');
    }
  };

  const readOllamaStream = async (response: Response) => {
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Ollama stream unavailable");

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = new TextDecoder().decode(value);
      const lines = chunk.split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;
        const json = JSON.parse(line);
        if (json.message?.content) {
          streamBuffer.current += json.message.content;
          syncAssistantMessage(streamBuffer.current);
        }
      }
    }
  };

  const readOpenAICompatibleStream = async (response: Response) => {
    const reader = response.body?.getReader();
    if (!reader) throw new Error("OrcaRouter stream unavailable");

    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split("\n\n");
      buffer = events.pop() || "";

      for (const event of events) {
        const dataLines = event
          .split("\n")
          .filter(line => line.startsWith("data:"))
          .map(line => line.replace(/^data:\s*/, ""));

        for (const data of dataLines) {
          if (data === "[DONE]") return;
          const json = JSON.parse(data);
          const content = json.choices?.[0]?.delta?.content;
          if (content) {
            streamBuffer.current += content;
            syncAssistantMessage(streamBuffer.current);
          }
        }
      }
    }
  };

  const handleSend = async () => {
    if (!canSend) return;
    
    const userMsg: ChatMessage = { role: "user", content: prompt };
    setMessages(prev => [...prev, userMsg, { role: "assistant", content: "" }]);
    setPrompt("");
    setIsLoading(true);
    streamBuffer.current = ""; 

    try {
      const requestMessages = [...messages.filter(m => m.content), userMsg];

      if (provider === "ollama") {
        const response = await fetch(OLLAMA_API_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: currentModel, messages: requestMessages, stream: true })
        });
        if (!response.ok) throw new Error("Ollama request failed");
        await readOllamaStream(response);
      } else {
        const response = await fetch(ORCAROUTER_API_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${orcaRouterApiKey.trim()}`,
            "HTTP-Referer": "https://github.com/luyao001/nebula-forge",
            "X-Title": "Nebula Forge"
          },
          body: JSON.stringify({ model: orcaRouterModel.trim(), messages: requestMessages, stream: true })
        });
        if (!response.ok) throw new Error("OrcaRouter request failed");
        await readOpenAICompatibleStream(response);
      }
    } catch (error) { 
        setMessages(prev => {
          const newMsgs = [...prev];
          newMsgs[newMsgs.length - 1].content = provider === "ollama"
            ? "⚠️ 连接 Ollama 失败，请检查模型服务是否启动。"
            : "⚠️ 连接 OrcaRouter 失败，请检查 API Key、模型名称或网络连接。";
          return newMsgs;
        });
    } finally { 
        setIsLoading(false); 
    }
  };

  return (
    <div className="nf-app">
      <header className="nf-header">
        <div className="nf-header-left">
          <button className="nf-toggle-btn" onClick={() => setIsSidebarOpen(!isSidebarOpen)}>
            <PanelLeftClose size={18} style={{ transform: isSidebarOpen ? 'none' : 'rotate(180deg)' }} />
          </button>
          <div className="nf-brand">
            <Sparkles size={18} color="#a855f7" />
            <span>Nebula Forge</span>
          </div>
        </div>

        <div className="nf-header-right">
          <div className="nf-tab-group">
            <button className={activeTab === 'code' ? 'active' : ''} onClick={() => setActiveTab('code')}>
              <Code size={16} /> <span className="hide-sm">代码</span>
            </button>
            <button className={activeTab === 'preview' ? 'active' : ''} onClick={() => setActiveTab('preview')}>
              <Eye size={16} /> <span className="hide-sm">预览</span>
            </button>
          </div>
          <div className="nf-action-group">
            <button className="nf-btn-copy" onClick={handleCopy}>
              {isCopied ? <Check size={16} color="#10b981" /> : <Copy size={16} />}
              <span>{isCopied ? "已复制" : "复制代码"}</span>
            </button>
          </div>
        </div>
      </header>

      <main className="nf-body">
        <aside className={`nf-sidebar ${isSidebarOpen ? 'open' : 'closed'}`}>
          <div className="nf-sidebar-inner">
            <div className="nf-section"><MessageSquare size={14} /> <span>当前任务</span></div>
            <div className="nf-history-item active">index.workspace</div>
            <div className="nf-sidebar-spacer"></div>
            
            <div className="nf-model-box">
              <div className="nf-model-label"><Cloud size={12} /> PROVIDER</div>
              <select
                value={provider}
                onChange={(e) => setProvider(e.target.value as Provider)}
                className="nf-select"
              >
                <option value="ollama">Ollama 本地</option>
                <option value="orcarouter">OrcaRouter 云端</option>
              </select>

              <div className="nf-model-label"><Cpu size={12} /> MODEL</div>
              <select 
                value={provider === "ollama" ? currentModel : orcaRouterModel} 
                onChange={(e) => provider === "ollama" ? setCurrentModel(e.target.value) : setOrcaRouterModel(e.target.value)}
                disabled={provider === "ollama" && (!isOllamaRunning || availableModels.length === 0)}
                className={`nf-select ${provider === "ollama" && !isOllamaRunning ? "error" : ""}`}
              >
                {provider === "ollama" ? !isOllamaRunning ? (
                  <option value="">未连接 Ollama</option>
                ) : availableModels.length === 0 ? (
                  <option value="">请先拉取模型</option>
                ) : (
                  availableModels.map(m => <option key={m} value={m}>{m}</option>)
                ) : (
                  ORCAROUTER_DEFAULT_MODELS.map(m => <option key={m} value={m}>{m}</option>)
                )}
              </select>

              {provider === "orcarouter" && (
                <>
                  <div className="nf-model-label"><KeyRound size={12} /> API KEY</div>
                  <input
                    className="nf-provider-input"
                    type="password"
                    value={orcaRouterApiKey}
                    onChange={(e) => setOrcaRouterApiKey(e.target.value)}
                    placeholder="输入 OrcaRouter API Key"
                  />
                  <input
                    className="nf-provider-input"
                    value={orcaRouterModel}
                    onChange={(e) => setOrcaRouterModel(e.target.value)}
                    placeholder="自定义模型 ID"
                  />
                </>
              )}
            </div>

          </div>
        </aside>

        <section className="nf-workspace">
          <div className="nf-chat">
            <div className="nf-messages" ref={scrollRef}>
              {messages.map((msg, i) => (
                <div key={i} className={`v3-msg ${msg.role}`}>
                  <div className="v3-avatar">{msg.role === 'user' ? 'ME' : 'NF'}</div>
                  <div className="nf-content" style={{whiteSpace: 'pre-wrap'}}>{msg.content}</div>
                </div>
              ))}
            </div>
            <div className="nf-input-container">
                <div className="nf-input-wrapper">
                  <textarea 
                    value={prompt} 
                    onChange={e => setPrompt(e.target.value)} 
                    onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSend()} 
                    placeholder={!getSelectedModel() ? "请先在左侧选择模型..." : provider === "orcarouter" && !orcaRouterApiKey.trim() ? "请先填写 OrcaRouter API Key..." : "在此输入你的构想..."} 
                    disabled={!getSelectedModel() || (provider === "orcarouter" && !orcaRouterApiKey.trim())}
                  />
                  <button className="nf-send-btn" onClick={handleSend} disabled={!canSend}>
                    <Send size={18} />
                  </button>
                </div>
            </div>
          </div>

          <div className="nf-viewport">
            <div className="nf-frame-container">
              {activeTab === 'code' ? (
                <Editor 
                    height="100%" 
                    language={currentLanguage} 
                    theme="vs-dark" 
                    value={generatedCode} 
                    options={{ 
                        fontSize: 13, 
                        minimap: { enabled: false },
                        readOnly: isLoading,
                        wordWrap: 'on',
                        padding: { top: 15 }
                    }} 
                />
              ) : (
                <iframe srcDoc={generatedCode} title="preview" />
              )}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
