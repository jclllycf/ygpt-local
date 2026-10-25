---
name: ygpt-local-work
description: Use YGPT Local for authorized work on the user's Windows files, folders, SQLite databases, processes and projects. Prefer typed tools and verify actual results.
---

For an explicit request involving a local Windows path or an authorized local project, use the installed YGPT Local tools before presenting instructions. Prefer `y_file_list`, `y_file_read`, `y_search_text`, `y_file_edit` and `y_sqlite_read` over shell scripts. Do not claim a file was read or changed without its tool result.

Before editing, read the current file and use its expected SHA-256 when available. Retain the returned snapshot ID, then read back the actual change. Restore conflicts preserve newer content: report `CONFLICT`, no files restored, and review the diff rather than retrying.

Use only the current `tools/list` catalog. There are no historical aliases or alternative tool prefixes.

Ordinary approvals stay inline. Only explicit Full Access requests may automatically open a panel. For Full Access plus Administrator access, use y_chat_access action=request_full with administrator=true only at the user's request. The owner must confirm both the chat card and Windows UAC on the PC; never decide UAC for them. Check administrator.active separately from mode=full. Use y_admin_run for commands that need elevation; ordinary typed file and desktop tools retain their normal token. Cancelling UAC leaves ordinary Full Access active. Expiry, revoke, context close or bridge disconnect stops the temporary executor. Never replay an elevated command whose outcome is unknown.

On `APPROVAL_REQUIRED`, show `y_show_approval` at the current conversation step using the original requestId, resultToken and contextToken. Then keep the task pending with bounded `y_wait_approval` calls. A decision returns the existing result automatically; do not end the task as blocked or run the original action again. Never call private decision tools from the model or copy capabilities into another chat.

The first desktop binding or input asks once for temporary Full Access to this chat for 10 minutes. After the owner confirms, desktop actions across this chat's windows, files and commands need no additional approval within that period. Preserve its contextToken. Expiry or y_chat_access action=revoke restores review before another input. A failed UIA action is not evidence that permission was denied: inspect its specific native error and the actual window. Browser invoke uses a verified pointer click. Use y_desktop_action action=keys with value such as CTRL+L, CTRL+T or ENTER for browser navigation.

Desktop interaction primarily uses the Windows control tree. Screenshots are separate observations, returned inline to the model. Their generated PNGs are deleted before the response returns; screenshot image bytes are excluded from the local result ledger. Do not promise removal of images already retained by the chat host.

Retain output tokens for search, process and durable task continuations. An interrupted or unknown mutation must be reconciled before retrying. Batch results are not atomic. Do not promise that all arbitrary script effects can be rolled back.

For general explanations unrelated to local files, do not inspect the PC. If this host has not installed the plugin or cannot reach the endpoint, state the actual error and guide connection setup. The host ultimately chooses tools; these instructions do not force tool use.

## Browser lifecycle (rc.18)

An isolated `y_browser_open` defaults to a one-shot read and closes its browser and temporary profile before returning the snapshot. For an explicit multi-step browser task, set `keepAlive: true`, retain the returned `contextToken` on every later call, and close all tabs in a finally path as soon as the task ends. A 30-second idle lease releases abandoned contexts. Never leave an isolated browser waiting after completing a task.

The daily-browser extension mode retains the owner browser. Each chat selects its own exact paired instance with `y_browser_attach`; different profiles can work concurrently. A second chat must not inherit another chat account. An unpacked extension loaded before rc.18 needs one Reload in each installed Chrome/Edge profile; after that, version negotiation handles future file upgrades.
