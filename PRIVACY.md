# Privacy policy

Last updated: 2026-08-24

Nebula AI does not include analytics, advertising, user accounts, or background
telemetry. It only contacts model services as described below and only in
response to the user's configuration or actions.

## Ollama local mode

Nebula AI checks and uses the Ollama service at `http://localhost:11434`.
Prompts, conversations, and generated content stay on the device unless the
selected Ollama model or the user separately introduces an external service.

## OrcaRouter cloud mode

When the user explicitly selects OrcaRouter and starts a generation, Nebula AI
sends the selected model ID, the current conversation, and the API key to
`https://api.orcarouter.ai/v1/chat/completions`. OrcaRouter may route the
request to the model provider selected by the user. Processing by OrcaRouter
and the selected model provider is governed by their respective terms and
privacy practices.

The API key remains in application memory by default. If the user enables
"remember on this device", the key is stored in the application's local WebView
storage until the option is disabled or the application data is removed.

## Generated webpage preview

Web mode renders generated HTML in a sandboxed preview. Generated HTML can
reference remote images, fonts, scripts, or APIs; previewing such content may
therefore make network requests to those addresses. Users can inspect and edit
the generated HTML before keeping or sharing it.

## Files and retention

Nebula AI does not upload exported files. Files are written only to a location
selected by the user through the system save dialog. Conversation and generated
output are held in memory for the current session; only provider, mode, model,
and an optionally remembered OrcaRouter API key are stored locally.

## Uninstallation and deletion

Nebula AI can be removed from Windows under **Settings → Apps → Installed
apps → Nebula AI → Uninstall**. Application-local settings can be deleted by
removing Nebula AI's application data after uninstalling.

## Contact

Privacy or security questions can be reported through the project's
[GitHub Issues](https://github.com/luyao001/nebula-ai/issues).
