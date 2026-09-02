# Privacy policy

Last updated: 2026-08-24

Nova does not include analytics, advertising, user accounts, or background
telemetry. It only contacts model services as described below and only in
response to the user's configuration or actions.

## Ollama local mode

Nova checks and uses the Ollama service at `http://localhost:11434`.
Prompts, conversations, and generated content stay on the device unless the
selected Ollama model or the user separately introduces an external service.

## OrcaRouter cloud mode

When the user explicitly selects OrcaRouter and starts a generation, Nova
sends the selected model ID, the current conversation, and the API key to
`https://api.orcarouter.ai/v1/chat/completions`. OrcaRouter may route the
request to the model provider selected by the user. Processing by OrcaRouter
and the selected model provider is governed by their respective terms and
privacy practices.

The API key remains in application memory only. It is not written to WebView
storage, application files, task snapshots, or logs, and is cleared when the
application closes. Releases that previously supported optional local storage
remove that legacy value when the application starts.

## Generated webpage preview

Web mode renders generated HTML in a sandboxed preview. Generated HTML can
reference remote images, fonts, scripts, or APIs; previewing such content may
therefore make network requests to those addresses. Users can inspect and edit
the generated HTML before keeping or sharing it.

Agent self-check previews use a separate opaque-origin iframe with network
access disabled by Content Security Policy. The self-check reports bounded DOM,
accessibility, console, and runtime diagnostics back to the selected model.

## Local Agent tools

Agent file tools are limited to a directory selected through the system folder
picker and a per-session temporary sandbox. Paths are canonicalized by the Rust
gateway before use. Workspace writes, external URL fetches, and every command
require an explicit permission decision. Commands run without an interactive
shell, with a cleared environment, a restricted executable/subcommand list,
bounded output and timeout, and a working directory inside the temporary
sandbox. Workspace file content must first be staged in that sandbox.

The URL tool accepts public HTTP(S) text resources only. It rejects credentials,
redirects, loopback, private, CGNAT, IPv4-mapped private, link-local, multicast,
and reserved addresses and limits response size and duration.

Agent sandboxes are removed on normal application shutdown. UUID-named sandbox
directories left by an abnormal termination are pruned after seven days when a
new workspace session is initialized.

## Agent task snapshots

Agent tasks store versioned JSON snapshots in Nova's application data
directory. A snapshot contains the execution plan, status, provider/model names,
bounded and redacted tool timeline metadata, and an optional final artifact. It
does not contain API keys, authorization headers, environment variables, raw
conversation messages, or complete tool outputs. Snapshots are created only for
tasks started in Agent mode and can be viewed from the task history panel.

## Files and retention

Nova does not upload exported files. Files are written only to a location
selected by the user through the system save dialog. Conversation and generated
output are held in memory for the current session; only non-secret settings such
as provider, mode, and model plus the explicitly described Agent task snapshots
are stored locally.

## Uninstallation and deletion

Nova can be removed from Windows under **Settings → Apps → Installed
apps → Nova → Uninstall**. Application-local settings can be deleted by
removing Nova's application data after uninstalling.

## Contact

Privacy or security questions can be reported through the project's
[GitHub Issues](https://github.com/luyao001/nova/issues).
