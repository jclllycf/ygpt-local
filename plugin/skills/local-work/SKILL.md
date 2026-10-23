---
name: ygpt-local-work
description: Use YGPT Local for authorized work on the user's Windows files, folders, SQLite databases, processes and projects. Prefer typed tools and verify actual results.
---

For an explicit request involving a local Windows path or an authorized local project, use the installed YGPT Local tools before presenting instructions. Prefer `y_file_list`, `y_file_read`, `y_search_text`, `y_file_edit` and `y_sqlite_read` over shell scripts. Do not claim a file was read or changed without its tool result.

Before editing, read the current file and use its expected SHA-256 when available. Retain the returned snapshot ID, then read back the actual change. Restore conflicts preserve newer content: report `CONFLICT`, no files restored, and review the diff rather than retrying.

On `REVIEW_REQUIRED`, immediately show `y_review_approval` using the original request and context token, then wait with `y_wait_approval` and the original result token. Do not run the original action again. Never call private decision tools from the model or copy capabilities into another chat.

Retain output tokens for search, process and durable task continuations. An interrupted or unknown mutation must be reconciled before retrying. Batch results are not atomic. Do not promise that all arbitrary script effects can be rolled back.

For general explanations unrelated to local files, do not inspect the PC. If this host has not installed the plugin or cannot reach the endpoint, state the actual error and guide connection setup. The host ultimately chooses tools; these instructions do not force tool use.

## Browser lifecycle (rc.18)

An isolated `y_browser_open` defaults to a one-shot read and closes its browser and temporary profile before returning the snapshot. For an explicit multi-step browser task, set `keepAlive: true`, retain the returned `contextToken` on every later call, and close all tabs in a finally path as soon as the task ends. A 30-second idle lease releases abandoned contexts. Never leave an isolated browser waiting after completing a task.

The daily-browser extension mode retains the owner browser. Each chat selects its own exact paired instance with `y_browser_attach`; different profiles can work concurrently. A second chat must not inherit another chat account. An unpacked extension loaded before rc.18 needs one Reload in each installed Chrome/Edge profile; after that, version negotiation handles future file upgrades.
