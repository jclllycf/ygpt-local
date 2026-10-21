# YGPT Local

Use ChatGPT to read, edit, search and work with files on your own Windows PC, with protected snapshots and scoped approval for high-risk actions.

**Release candidate under validation. No public installer release has been verified yet.** The download button will be added only after the release gates pass; there is no fabricated repository or download link.

[Quick start](#quick-start) · [中文安装说明](README.zh-CN.md) · [Security](docs/SECURITY.md) · [Troubleshooting](docs/TROUBLESHOOTING.md) · [Validation status](docs/VALIDATION.md)

One project contains the local MCP service, native Windows setup, connection guidance and optional browser/desktop workflows. You run the software on your own PC and connect your own personal ChatGPT plugin. No separate public plugin-directory submission or hosted SaaS is required.

## Quick start

1. When available, download `YGPTLocal-Setup-1.0.0-rc.1-win-x64.exe` from this repository's Releases and compare its SHA-256. Candidate installers are unsigned; do not assume a verified publisher signature.
2. Run the native setup wizard. Choose an empty application folder and the working folder you authorize. Node.js, embedded Python, cloudflared and the official OpenAI tunnel-client are bundled; no command-line setup is required.
3. Choose an existing Cloudflare Tunnel, create a **new dedicated** tunnel with an authorized Cloudflare API token, or use an eligible Secure MCP Tunnel. Configure only the credentials required by that mode.
4. Install, start the local service, then verify local health, the tool catalog, the remote endpoint and authentication separately. Local-only setup is deliberately reported as incomplete for ChatGPT.
5. Click **Connect ChatGPT**. In ChatGPT Plugins, use **+ → Add custom MCP server**, name it **YGPT Local**, enter the HTTPS endpoint ending in `/mcp` or select the dedicated Secure MCP Tunnel. For HTTPS choose OAuth and approve the connection with the owner pairing key shown by the Windows app. Install the personal plugin, then select `@YGPT Local` in a new chat and ask: “List the files in my authorized working folder.” Confirm the actual tool call and returned files.

**Never paste connector tokens, owner pairing keys, API credentials or private diagnostics into chats or GitHub Issues.**

## Connection choices

| Mode | Credentials | What setup does |
| --- | --- | --- |
| Existing Cloudflare Tunnel | Connector token + stable HTTPS hostname | Starts the bundled connector. The existing tunnel must route that hostname to the chosen local port. A connector token cannot create or change DNS. |
| New Cloudflare Tunnel | API token, account ID, zone ID, unused hostname | Uses official REST APIs to create a dedicated named tunnel, ingress and CNAME. Explicit confirmation is required; existing DNS records are never overwritten. |
| Secure MCP Tunnel (recommended for eligible accounts) | Dedicated tunnel ID and OpenAI API runtime key with Tunnels Read + Use | Uses the bundled official client for a private outbound connection, with no public Cloudflare URL. Setup never submits model-generation API requests. |

A Cloudflare API token, connector token, MCP owner credential and OpenAI tunnel runtime key have different purposes. A Cloudflare connection does **not** need an OpenAI API key or a model API subscription. Secure MCP Tunnel has its own Platform permissions and runtime credentials; availability is not universal.

ChatGPT cannot reach `127.0.0.1` on your PC directly. The local MCP HTTP listener binds to loopback only. Public HTTPS requires owner-bound OAuth with PKCE. An unauthenticated public terminal endpoint is never a supported setup.

## Using local tools

- “Read this local text file, then explain the second paragraph.” → `y_file_read`.
- “Replace this exact text and read it back.” → `y_file_edit` with `expectedSha256`, then `y_file_read`.
- “Inspect this SQLite database without modifying it.” → `y_sqlite_read`.
- “Show what changed and restore the saved version.” → `y_backup_diff` and `y_backup_restore`.
- “Build this authorized project and report the actual result.” → typed process/job tools.

The plugin instructions prefer real tools for local work. Host model selection is not enforceable by an MCP server: explicitly select `@YGPT Local` if tools are not being called. General knowledge questions should not probe your computer.

## Approval and file recovery

Ordinary development and typed reads run under the selected owner policy. Bulk deletion, system/security changes, disk operations and protected credential mutations require scoped approval. The embedded English approval card offers **Allow once**, **Always allow in this chat** and **Deny**. Chat scope is narrow: changed arguments, context or reviewed executable require fresh consent.

File writes retain encrypted preimages. Restore compares current content with the recorded post-edit hash. A conflict returns `CONFLICT`, `executed:false`, `filesRestored:0`; it preserves newer edits. Review the diff rather than retrying. Restore itself creates an undo snapshot. Batch editing is not an atomic transaction; inspect per-item results.

Terminal snapshots are bounded to selected existing files. They cannot undo arbitrary scripts' new files, external effects, databases or system-wide changes. The process environment is sanitized; desktop apps launched through terminal tools may not inherit your normal login/configuration profile. This release does not promise arbitrary desktop-session app launching.

## Data, startup, updates and uninstall

Default application: `%LOCALAPPDATA%\Programs\YGPTLocal`. Data and encrypted credentials: `%LOCALAPPDATA%\YGPTLocal`. The optional sign-in startup entry and Start menu shortcut belong only to this product. The tray can open setup or pause the service.

For repair/update, run the full installer against the same YGPT Local application and data folders. It refuses maintenance while owned jobs, processes or approvals remain active, preserves the previous program folder, and retains owner identity, security policy and file snapshots. Updates are explicit owner actions; no unattended download is enabled. Complete legacy-state migration is not yet released. Uninstall removes known application files and retains settings, credentials and snapshots by default. See [migration](docs/MIGRATION.md). Do not run two agents against the same tunnel or state directory.

## Build from source

Windows x64, Node.js 24.22.0 and Windows .NET Framework compiler/WPF references are needed by developers only. Git is optional for physical file snapshots. PowerShell is a Windows system dependency.

```powershell
npm ci --ignore-scripts
node scripts/fetch-runtimes.mjs
npm run build
npm test
npm run check:public
npm run package
```

Runtime versions and digests are recorded in `scripts/runtime-lock.json`. Browser workflows use installed Microsoft Edge with a separate context. Builds retain runtime and npm licenses.

## Honest validation

[Validation status](docs/VALIDATION.md) distinguishes source checks, real local MCP/HTTP integration, native GUI installation on this host, clean Windows VM testing and actual ChatGPT host use. A simulated client is never labelled ChatGPT. Twenty golden prompts are supplied for real host evaluation, with unrun entries explicitly pending.

The ChatGPT `Opened …` header and `CSP off` badge are host-owned UI. YGPT Local can style its own card and publish strict MCP App CSP metadata; it cannot guarantee removal or arbitrary placement of the surrounding host shell.

## License and support

MIT for project code; third-party components retain their licenses. See [notices](THIRD_PARTY_NOTICES.md). Use sanitized support summaries. Report vulnerabilities privately using the guidance in [Security](docs/SECURITY.md).

Official connection references: [Connect and test](https://developers.openai.com/plugins/deploy/connect-chatgpt), [custom MCP server](https://developers.openai.com/api/docs/guides/custom-mcp-server), [Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels).
