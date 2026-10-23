<img src="assets/brand/ygpt-local.svg" width="72" alt="YGPT Local Y connection icon">

# YGPT Local

Connect ChatGPT to files and tools on your own Windows PC, with protected snapshots, conflict-aware recovery and scoped approval.

**1.0.0-rc.16 is the current candidate for owner testing, with English-only UI.** The repository is private; the installers are distributed through this repository's Releases page. Remaining tests are owner-run. What changed since rc.3: [CHANGELOG](CHANGELOG.md) · [upgrade guide](docs/UPGRADE_USER_GUIDE.md) · [security note](docs/UPGRADE_SECURITY_NOTE.md). [中文](README.zh-CN.md) · [Setup guide](docs/SETUP_GUIDE.md) · [Validation](docs/VALIDATION.md) · [Security](docs/SECURITY.md)

## Install

1. Obtain `YGPTLocal-Setup-1.0.0-rc.16-win-x64.exe` and compare its SHA-256 with `SHA256SUMS.txt`. This candidate is unsigned. Already installed? Run `YGPTLocal-Update-1.0.0-rc.16-win-x64.exe` instead: it updates in place and keeps your data folder, keys, connection identity, snapshots and ChatGPT plugin ([upgrade guide](docs/UPGRADE_USER_GUIDE.md)).
2. Run the eight-step native Windows wizard. Choose an application folder and an authorized working folder. Node, Python and the official Tunnel Client are bundled; normal installation needs no developer tools or administrator privileges.
3. Keep **OpenAI Secure MCP Tunnel** selected. Create a dedicated Tunnel in your eligible Platform organization and associate the intended ChatGPT workspace. Do not reuse a Tunnel already run by another installation.
4. Enter the full ID and a dedicated runtime API key in the masked local field. DPAPI encrypts it for your Windows user. It authenticates the Tunnel Client; setup does not call generation models or create keys.
5. Install and inspect the dashboard. Saved credentials, local readiness, Tunnel readiness and actual ChatGPT use are separate states. A private Tunnel can wait for its first remote handshake before creating a Broker.
6. In ChatGPT **Plugins → Add → Add custom MCP server**, choose **Tunnel**, enter its ID and use **No authentication** only for this dedicated private Tunnel. Read and accept the official risk warning yourself, then create and install the personal plugin. Public HTTPS still uses OAuth.
7. Select `@YGPT Local` in a new chat. Copy the wizard's first-task prompt to list the verification folder and read its random marker. Confirm the exact answer in ChatGPT.
8. Close setup. The connection runs independently. Authorized cleanup waits for the authenticated marker read and setup exit.

The [field guide](docs/SETUP_GUIDE.md) covers organizations/workspaces, key ownership, project, expiry, permissions and authentication. Availability depends on account eligibility and organization RBAC. **Never paste keys, approval tokens, profiles or private logs into chat or GitHub.**

## What stays running

```text
Windows user sign-in
  → one silent YGPTWatchdog.exe
    → official tunnel-client
      → Node Broker / Engine and necessary workers

YGPTLocal.exe: on-demand settings / repair / uninstall
```

Secure Tunnel uses stdio without an extra HTTP Supervisor. Advanced Cloudflare/local-only modes retain their HTTP gateway. A current-user, least-privilege logon task ignores duplicate task starts. Data-directory and Tunnel locks prevent two new Watchdogs from owning the same connection. Startup also checks legacy profile-based clients; it never kills another Tunnel.

The Watchdog backs off after its transport exits. The official client handles network reconnects. Invalid/expired credentials or permission denial stop repeated startup and leave an actionable status. No recovery replays uncertain writes, deletions or terminal commands. Actual login/network acceptance is listed separately in [validation](docs/VALIDATION.md).

## Cleanup, settings and updates

Automatic cleanup is enabled by default, explained before installation and cancellable. Only exact files in this generation's signed ownership manifest are eligible. A user-downloaded Setup needs an **additional explicit choice for that exact file**; location and matching names do not prove ownership.

The cleaner checks identity, size, SHA-256, ancestry, links, open handles, process/startup/maintenance references. Changed, replaced, shared, in-use, linked, foreign or unknown files stay with reasons. It never sweeps folders or calls the uninstaller. Receipts record categories, counts, bytes and outcomes, without keys or user contents.

It keeps runtimes, Watchdog, Tunnel, dormant Settings/update/uninstall, DPAPI credentials, owner/OAuth state, databases, approval ledger, snapshots and rollback data. Installed Settings can reconfigure its verified runtime after Setup removal. A damaged runtime or version upgrade requires the full installer.

Default application: `D:\YGPTLocal` and private data `D:\YGPTLocalData` (or the same folders on the largest other non-system fixed drive when there is no D:), otherwise `%LOCALAPPDATA%\Programs\YGPTLocal` and `%LOCALAPPDATA%\YGPTLocal`. Open Settings from Start when needed; no tray GUI must remain running. Maintenance blocks new calls and checks owned work before replacement. Active jobs/approvals prevent unsafe maintenance. Updates preserve the previous program folder and private state. Uninstall is a separate confirmation that disconnects the service and retains private data, changed and unknown files. See [migration](docs/MIGRATION.md).

RC3 development leaves existing working production Tunnels running. Different Tunnel identities are separate owners, not automatic duplicate-cleanup targets.

## Tools and recovery

Prefer `y_file_read`, `y_file_edit`, `y_search_text`, `y_sqlite_read`, `y_backup_diff` and `y_backup_restore`. One canonical `y_` catalog is served; `y_ping` reports it by group, and retired names answer `NO_TOOL` with their replacement. Actual ChatGPT discovery needs independent verification.

Permission model (owner blacklist): everything is allowed by default — reads and clean writes need no approval. Destructive, privileged, system or credential-adjacent operations, batch/folder deletes and writes into YGPT's own state or the G: vault ask for a human decision instead of being refused; there are no hard-denied targets. Cards offer **Allow once**, **Always allow in this chat** and **Deny** where scope permits. Wait for the original result rather than replaying the operation. `y_policy` shows the active rules.

Browser: an isolated browser by default (fresh per chat, Chrome unless configured), or the owner's daily Chrome/Edge through the bundled YGPT extension (`extension/`, loaded unpacked), confined to a "YGPT" tab group. After updating YGPT, press **Reload** on the extension in `chrome://extensions` / `edge://extensions`; unpacked extensions do not pick up new files by themselves.

Restore refuses newer conflicting edits with `CONFLICT / executed:false / filesRestored:0` and creates an undo snapshot on success. Batch operations are not atomic. Terminal snapshots cannot undo every external effect, new file or database transaction. These protections are not an OS sandbox. The outer ChatGPT Opened/CSP shell is controlled by the host.

## Build and test

Developers need Windows x64, Node 24.x and the Windows .NET Framework/WPF compiler.

```powershell
npm ci --ignore-scripts
node scripts/fetch-runtimes.mjs
npm run build
npm test
npm run check:public
npm run package
node scripts/test-rc3-native.mjs --cleanup
node scripts/test-rc3-native.mjs
```

The native probe installs only in a new `.ygpt-local-tests` directory, drives the real WPF package, closes the GUI, checks local MCP reads and single ownership, faults its own transport, and checks Settings after download removal. It is **not ChatGPT or clean-VM evidence**. Runtime digests: [lock](scripts/runtime-lock.json). Original MIT icons: [assets](assets/brand). Third-party [licenses](THIRD_PARTY_NOTICES.md) remain applicable.

Official references: [Secure MCP Tunnels](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels), [custom MCP server](https://developers.openai.com/api/docs/guides/custom-mcp-server), [Windows logon tasks](https://learn.microsoft.com/en-us/windows/win32/taskschd/logon-trigger-example--scripting-). This independent project is not an OpenAI product.
