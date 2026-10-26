# YGPT Local 1.0.18

ChatGPT conversations can now discover and dispatch existing local MCP services,
CLI tools and Agent profiles through YGPT, without manually switching applications.

- Five unified tools cover capability discovery, source management, MCP routing,
  CLI tasks and Agent delegation. Existing tools and inline approvals are retained.
- MCP clients connect lazily, paginate tools/resources/prompts, validate input
  schemas and keep per-chat/source connections and environments separate.
- CLI/Agent work uses persistent Windows jobs, encrypted payloads/logs, fair-share
  limits, cancellation and a private task/session index. Codex stdin is closed so
  non-interactive runs do not wait indefinitely for input.
- Codex keeps its selected account home, model/provider and native permissions.
  There is no silent switch to a paid provider or transfer of Full Access.
- Tool scratch is separate from protected credentials/state and reclaimed after
  completion. Uncertain calls are never replayed automatically.

See [local tools](LOCAL_TOOLS.md) for supported discovery locations, extra account
sources, non-Codex wrapper requirements and operational limits. Discovery does not
guarantee every installed program is found or every configured server is running.
This release does not certify a new real ChatGPT/mobile host interaction or a live
paid Agent run; those require user task acceptance after installation.
