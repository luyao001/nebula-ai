import type { FunctionTool } from "../providers";

export const AGENT_TOOLS: FunctionTool[] = [
  {
    type: "function",
    function: {
      name: "report_plan",
      description: "Create or replace the concise execution plan for the current task. Call this before other tools.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["steps"],
        properties: {
          steps: {
            type: "array",
            minItems: 1,
            maxItems: 12,
            items: { type: "string", minLength: 1, maxLength: 160 },
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read one UTF-8 text file from the authorized workspace or the temporary sandbox.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["path"],
        properties: {
          path: { type: "string", description: "Safe relative path inside the selected scope." },
          scope: { type: "string", enum: ["workspace", "sandbox"], default: "workspace" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_dir",
      description: "List at most 200 direct children of a directory in the authorized workspace or sandbox.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          path: { type: "string", default: "." },
          scope: { type: "string", enum: ["workspace", "sandbox"], default: "workspace" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description: "Write UTF-8 text inside the authorized workspace or sandbox. This requires user approval.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["path", "content"],
        properties: {
          path: { type: "string", description: "Safe relative destination path." },
          content: { type: "string", description: "Complete file content, limited to 1 MiB." },
          scope: { type: "string", enum: ["workspace", "sandbox"], default: "workspace" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_command",
      description:
        "Run one approved validation command in the temporary sandbox. Use structured program and args; shell syntax is unavailable.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["program", "args"],
        properties: {
          program: { type: "string", description: "Whitelisted executable such as cargo, node, or python." },
          args: { type: "array", maxItems: 32, items: { type: "string" } },
          cwd: { type: "string", default: ".", description: "Relative directory inside the temporary sandbox." },
          timeout_ms: { type: "integer", minimum: 1000, maximum: 120000, default: 30000 },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "fetch_url",
      description: "Fetch a public HTTP(S) text resource with no custom headers, cookies, redirects, or private-network access.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["url"],
        properties: { url: { type: "string", format: "uri" } },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "open_in_preview",
      description: "Render complete HTML in the isolated, network-disabled preview and return DOM/runtime diagnostics.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["html"],
        properties: { html: { type: "string", description: "Complete single-file HTML document." } },
      },
    },
  },
];
