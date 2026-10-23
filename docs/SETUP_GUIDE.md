# Windows setup guide

[中文安装说明](SETUP_GUIDE.zh-CN.md) · [Release notes](RELEASE_1.0.3.md) · [Upgrade guide](UPGRADE_USER_GUIDE.md)

The application is English-only. The next action stays at the bottom of the native window; optional settings expand when needed.

## Before you start

Run **YGPTLocal-Setup-1.0.3-win-x64.exe** for your first installation, or **YGPTLocal-Update-1.0.3-win-x64.exe** to update in place. Compare the download's SHA-256 with `SHA256SUMS.txt` from the same release. Installers are unsigned.

## 1. Choose folders

Choose an empty **Application folder**, such as `D:\YGPTLocal`. Product data, caches, snapshots and update files stay inside it. **Working folder** is where initial file tasks run; use a Projects or test folder rather than a whole drive. Review the local-access consent before continuing.

**Appearance and approval preview** and **Installation cleanup** are optional. Safe cleanup keeps private data and unknown files. Deleting the exact downloaded Setup requires its own checkbox; Downloads is never swept.

## 2. Check this PC

Review Windows x64, drive space and Windows-user encryption. Node, Python and the official Tunnel Client are included. **Connect automatically when I sign in** starts one quiet connection at Windows sign-in. Advanced port and proxy fields are optional.

## 3. Choose a connection

**Secure MCP Tunnel** is the default for an eligible OpenAI organization and associated ChatGPT workspace. Open the official Tunnels page from the guide, create a dedicated tunnel and paste the complete `tunnel_…` ID. Copy buttons provide its suggested name and description. The expandable guide explains organization and workspace fields.

A Tunnel ID is not an API key. Use the organization that owns the runtime credential and the workspace where you will install the plugin. Do not reuse another installation's active tunnel.

Cloudflare and local-only routes remain under **Advanced connection methods**. Public HTTPS uses OAuth; local-only mode cannot be reached directly by remote ChatGPT.

## 4. Add the runtime key

Choose **Open official API Keys** and create a dedicated key in the intended organization. Follow its permission and expiry policy. Paste the secret only into the masked **OpenAI Tunnel runtime key** field. DPAPI encrypts it for your Windows user. It runs the Tunnel Client; setup does not invoke generation models.

A saved key is kept unless you expand **Replace the saved credential**. A saved label establishes that encrypted data exists; connection checks establish whether the connection works.

## 5. Review and install

Check the application folder, internal data path, working folder, connection method and preferences. Choose **Install YGPT Local**. Setup verifies the payload, protects configuration and starts this installation's connection. Repair waits for owned work and preserves connection identity.

## 6. Check connection

| Row | Meaning |
| --- | --- |
| Local tools | Whether the local tool engine has responded |
| Private tunnel | Whether the Tunnel Client reports a current connection |
| First ChatGPT task | Whether the verification file was read over the authenticated connection |

A connected tunnel may wait for ChatGPT's first request before starting the engine; continue to the next step in that case. Expand **Connection details** for diagnostics and use **Run connection checks** to refresh. Local status does not prove a real ChatGPT answer or human approval.

## 7. Add to ChatGPT

Open **ChatGPT Plugins → Add → Add custom MCP server**.

| Field | Dedicated private tunnel |
| --- | --- |
| Icon | `assets/brand/plugin-icon-256.png`, under 10 KB |
| Name | **Copy name** |
| Description | **Copy description** |
| Connection | **Tunnel** |
| Tunnel ID | **Copy Tunnel ID** |
| Authentication | **No authentication**, for this dedicated private tunnel only |

Keep the runtime key in YGPT; do not paste it into the plugin form or chat. No authentication omits extra application OAuth for this private tunnel. Runtime credentials, organization/workspace restrictions and local protections still apply. Public HTTPS uses **OAuth**.

Read the official risk warning yourself, then create and install the personal plugin. YGPT does not accept those human confirmations for you. Platform labels and account availability may vary.

## 8. Try your first task

Select `@YGPT Local` in a new conversation. Choose **Copy first-task prompt**, paste it into the chat and confirm the exact random marker returned. Choose **Check first real tool result** to refresh the local status.

You may close setup after copying the prompt; the connection stays active. Eligible cleanup waits for verified first use and setup exit. Settings contains receipts and maintenance actions.

## Completion and uninstall feedback

Installation and authenticated file-read verification have separate completion banners. Connection checks may report **Connection checks complete** while the first ChatGPT task is still pending. An installed update whose connection is starting is shown separately from **Update complete**; failures offer **Try update again**. The window prevents closing during file replacement.

Uninstall stops this installation and removes unchanged application files. Its result window lists deleted, already absent, changed and blocked files separately. Private settings, encrypted credentials, snapshots, recovery records and unregistered user files remain intentionally. **Open retained folder** and **Copy details** help review them. The private receipt is `data/uninstall-report.json`. The contained `.updates` folder retains recovery records and the uninstall helper; no helper process remains after closing the result window. Changed or locked files are reported instead of being silently forced away.

## Installation leftovers

Open **Advanced maintenance → Review installation leftovers** to inspect cache and registration cleanup. After current payload integrity and connection health are verified, the automatic policy retains one complete rollback and removes surplus verified program copies and redundant contained installers. Old YGPT registrations are backed up before removal. Unknown, changed, linked, shared or referenced files remain with reasons. Private data, snapshots, migration/recovery records and developer directories remain untouched. The updater's optional download checkbox authorizes only that exact external file; Downloads is never swept.

## Optional: your daily browser

Expand **Use your daily Chrome or Edge** on the last page. In the intended profile, enable Developer mode, load the installed `extension` folder, open the pairing page and copy its token into the extension. Each profile pairs separately. Tasks choose the intended profile if several are connected. YGPT works in its own tab group and preserves personal tabs.

The isolated browser works without this extension. A default isolated read closes the browser and deletes its temporary profile before returning. Multi-step work explicitly uses `keepAlive=true`, keeps its context token and closes its tabs when done; a 30-second idle lease cleans up abandoned work.

Background references: [Secure MCP Tunnels](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels), [custom MCP servers](https://developers.openai.com/api/docs/guides/custom-mcp-server). Local fixtures do not replace real account acceptance.
