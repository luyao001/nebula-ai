export type PreviewIssue = {
  severity: "error" | "warning";
  message: string;
};

export type PreviewReport = {
  passed: boolean;
  title: string;
  textLength: number;
  nodeCount: number;
  issues: PreviewIssue[];
};

const PREVIEW_TIMEOUT_MS = 7000;

const buildAuditedDocument = (html: string, token: string) => {
  const documentValue = new DOMParser().parseFromString(html, "text/html");
  documentValue.querySelectorAll('meta[http-equiv="Content-Security-Policy" i]').forEach((node) => node.remove());

  const csp = documentValue.createElement("meta");
  csp.httpEquiv = "Content-Security-Policy";
  csp.content =
    "default-src 'none'; img-src data: blob:; media-src data: blob:; font-src data:; " +
    "style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'none'; frame-src 'none';";
  documentValue.head.prepend(csp);

  const bridge = documentValue.createElement("script");
  bridge.textContent = `(() => {
    const token = ${JSON.stringify(token)};
    const runtimeErrors = [];
    const pushError = (value) => runtimeErrors.push(String(value && value.message ? value.message : value));
    addEventListener("error", (event) => pushError(event.error || event.message));
    addEventListener("unhandledrejection", (event) => pushError(event.reason));
    const originalError = console.error.bind(console);
    console.error = (...args) => { runtimeErrors.push(args.map(String).join(" ")); originalError(...args); };
    addEventListener("load", () => setTimeout(() => {
      const issues = runtimeErrors.map((message) => ({ severity: "error", message: "运行错误：" + message }));
      const bodyText = (document.body?.innerText || "").trim();
      const nodeCount = document.querySelectorAll("*").length;
      if (!document.title.trim()) issues.push({ severity: "warning", message: "页面缺少 title。" });
      if (!bodyText && !document.querySelector("canvas,svg,img,video")) issues.push({ severity: "error", message: "页面没有可见内容。" });
      if (document.documentElement.scrollWidth > document.documentElement.clientWidth + 2) issues.push({ severity: "warning", message: "页面存在横向溢出。" });
      document.querySelectorAll("button").forEach((node) => {
        if (!(node.textContent || "").trim() && !node.getAttribute("aria-label") && !node.getAttribute("title")) {
          issues.push({ severity: "warning", message: "存在无可访问名称的按钮。" });
        }
      });
      document.querySelectorAll("img").forEach((node) => {
        if (!node.hasAttribute("alt")) issues.push({ severity: "warning", message: "存在缺少 alt 的图片。" });
      });
      if (nodeCount > 5000) issues.push({ severity: "warning", message: "DOM 节点超过 5000，可能影响性能。" });
      parent.postMessage({ source: "nebula-preview-audit", token, report: {
        passed: !issues.some((issue) => issue.severity === "error"),
        title: document.title,
        textLength: bodyText.length,
        nodeCount,
        issues: issues.slice(0, 30),
      } }, "*");
    }, 350), { once: true });
  })();`;
  csp.after(bridge);
  return `<!doctype html>\n${documentValue.documentElement.outerHTML}`;
};

export const auditHtmlInPreview = (html: string, signal?: AbortSignal) =>
  new Promise<PreviewReport>((resolve, reject) => {
    const token = crypto.randomUUID();
    const iframe = document.createElement("iframe");
    iframe.title = "Nova Agent 自检预览";
    iframe.sandbox.add("allow-scripts");
    iframe.referrerPolicy = "no-referrer";
    iframe.style.cssText = "position:fixed;width:1280px;height:720px;left:-10000px;top:0;border:0;";

    let timeoutId = 0;
    const cleanup = () => {
      window.clearTimeout(timeoutId);
      window.removeEventListener("message", handleMessage);
      signal?.removeEventListener("abort", handleAbort);
      iframe.remove();
    };
    const handleAbort = () => {
      cleanup();
      reject(new DOMException("Agent preview aborted", "AbortError"));
    };
    const handleMessage = (event: MessageEvent) => {
      if (
        event.source !== iframe.contentWindow ||
        !event.data ||
        event.data.source !== "nebula-preview-audit" ||
        event.data.token !== token
      ) {
        return;
      }
      cleanup();
      resolve(event.data.report as PreviewReport);
    };

    if (signal?.aborted) return handleAbort();
    window.addEventListener("message", handleMessage);
    signal?.addEventListener("abort", handleAbort, { once: true });
    timeoutId = window.setTimeout(() => {
      cleanup();
      resolve({
        passed: false,
        title: "",
        textLength: 0,
        nodeCount: 0,
        issues: [{ severity: "error", message: "沙盒预览在限定时间内未完成加载。" }],
      });
    }, PREVIEW_TIMEOUT_MS);
    iframe.srcdoc = buildAuditedDocument(html, token);
    document.body.append(iframe);
  });
