# Upgrading and using YGPT Local

[中文升级说明](UPGRADE_USER_GUIDE.zh-CN.md) · [Setup](SETUP_GUIDE.md) · [Release notes](RELEASE_1.0.0.md)

## Update in place

Run the Update EXE from the latest release. It finds the existing installation, lets you choose the intended one if several exist, waits for owned work and replaces the program payload. The update button stays visible while optional appearance settings scroll. Settings, encrypted keys, connection identity, snapshots, private data and the ChatGPT plugin are preserved.

All product data lives in `<chosen application folder>\data`. Staging and rollback members live in `.updates`. Legacy external data is moved inside the chosen application folder; two private state trees are never merged. Unknown user files remain untouched.

If a browser extension from rc.17 or earlier remains loaded, click Reload once in each profile's extension manager. Keep the pairing token. Extension 1.0.19 includes version negotiation for subsequent resource reloads.

## Understand permission prompts

Ordinary file reads and routine work follow local policy. Higher-risk operations ask for approval for the exact action. Review the target and details before choosing **Allow once** or **Deny**. An eligible **Always allow in this chat** grant covers only the displayed scope for up to two hours. It does not grant another conversation access.

Desktop window binding, clicks, typing and focus changes require approval by default. Desktop ChatGPT Agent windows are ordinary targets under the same rules. Credential-adjacent or system changes, broad searches and bulk deletion require their applicable local approval. Malformed requests are rejected.

## Work in several conversations

Each conversation keeps its own context token and owns its tabs, window bindings, jobs and processes. Keep that token with the task. Concurrent writes to the same file use preimage hashes; a `STALE_PREIMAGE` response means read the current file before trying a new change. One conversation cannot take another's resources by guessing an ID.

## Browser choices

- **Isolated browser:** a default open returns a snapshot, closes the browser and removes its temporary profile before returning. For several interactions, explicitly use `keepAlive=true`, keep the original context token and close the tabs when done. Closing the last tab closes its browser; a 30-second idle lease cleans up abandoned work.
- **Daily Chrome or Edge:** load and pair the extension in the intended profile. Each profile has a separate relay; each chat selects its own profile. When several are connected, select the intended one. YGPT works within its own tab group. Personal tabs and the user's browser remain open after detach.

The last setup page includes optional extension and pairing shortcuts. A profile without the extension must first be installed and paired by its owner.

## Recover without repeating work

If a mutation's result is unknown, retrieve the existing request with `y_call_status` / `y_call_result` instead of submitting it again. Check an existing job with `y_job_status`. Use `y_backup_list` and `y_backup_restore` for protected file snapshots. Restore conflicts preserve newer content.

Single ordinary file deletion uses a protected snapshot and the Recycle Bin. Bulk, directory and system deletion require approval. Snapshot limits are reported; do not assume every terminal command is fully reversible. See the [security note](UPGRADE_SECURITY_NOTE.md).

## Check connection status

**Local tools**, **Private tunnel** and **First ChatGPT task** describe different checks. A connected private tunnel can wait for a first remote request before starting the local engine. Expand connection details for actual errors. A saved key or successful local fixture is not proof of a real ChatGPT answer or physical human approval.
