# YGPT Local next upgrade — tool inventory and migration map

Status: engineering record for branch `upgrade/chat-only-isolation-20261022`, based on merge commit `4f2a07d` (RC3 line + First Light brand line). Production remains 1.0.0-rc.2; nothing here switches it.

## 1. Baseline inventory (merged tree, before this upgrade)

Derived by reading `runtime/enhanced-server.mjs#tools()`, `runtime/native-extension.mjs`, `engine/src/engine.mjs`, `runtime/compat-catalog.mjs` and `runtime/inline-approval.mjs` under the only configuration the installer writes (`service/configuration.mjs#makeConfig`: `rc10Candidate`, `chatAppConsent`, `blacklistDefaultAllow`, `readOnlyAutoAllow`, `localApprovalDisabled`).

| Source | Count | Names |
| --- | ---: | --- |
| Native typed engine (`engine/src/engine.mjs`, `y_ping` filtered out) | 40 | `y_engine_history`, `y_file_{list,info,read,read_bytes,write,edit,copy,move,mkdir,batch}`, `y_search_{text,files}`, `y_process_{run,start,poll,input,cancel,list}`, `y_job_{submit,status,logs,cancel,list}`, `y_browser_{open,tabs,snapshot,navigate,action,wait,screenshot,download,close}`, `y_desktop_{windows,bind,inspect,value,action,screenshot}`, `y_system_inspect` |
| RC10 UIA fixture launcher | 1 | `y_desktop_fixture` |
| Compat child (`runtime/compat-entry.mjs`, published as `y_local_*`) | 21 | `y_local_{get_config,read_file,read_multiple_files,write_file,create_directory,list_directory,move_file,start_search,get_more_search_results,stop_search,list_searches,get_file_info,edit_block,start_process,read_process_output,interact_with_process,force_terminate,list_sessions,list_processes,kill_process,get_usage_stats}` |
| Broker additions (published through `publicName`) | 27 | `y_sqlite_read`, `y_ping`, `y_pending_approvals`, `y_wait_approval`, `y_service_health`, `y_policy`, `y_permission_mode`, `y_workstation_health`, `y_dev_task`, `y_close_context`, `y_task_{submit,status,tail,cancel,list}` (from `job_*`), `y_run_trusted_workflow`, `y_download_file`, `y_inspect_download_status`, `y_verify_checksum`, `y_disk_inspect`, `y_call_status`, `y_call_result`, `y_recent_calls`, `y_backup_{list,diff,restore,accept}` (`job_recover` is hidden in this mode) |
| Approval surface | 5 | `y_show_approval`, `y_approval_center`, `y_review_approval` (legacy alias re-described as the primary card), `y_bar_decide` and `y_bar_status` (both app-only) |
| **Total served by `tools/list`** | **94** | |
| **Model-visible (excluding app-only `y_bar_*`)** | **92** | |

**Explaining 94 vs 92:** `y_service_health` counts every catalog entry (94). Two of them, `y_bar_decide` and `y_bar_status`, carry `_meta.ui.visibility=['app']` / `openai/visibility=private`, so the model sees 92. No function was lost.

Further routing found in the tree (not in the catalog):
- `compatibility/tool-names.mjs` rewrites any `yuki_*` call to `y_*`. `runtime/inline-approval.mjs` also serves `ui://yuki/...` resource aliases.
- The broker strips `y_local_` / `y_task_` / `y_` prefixes back to internal names, so it still dispatches unadvertised historical names. It also returns a fixed error for hidden Desktop Commander names (`set_config_value`, `get_recent_tool_calls`, …).
- `engine/src/compat-adapter.mjs` contains only throwing placeholders. `engine/src/engine.mjs` still has a dormant `legacyTools` branch that would publish a second set of `y_local_*` names.
- `runtime/approvals.mjs`, `runtime/approval-panel.ps1` and `runtime/approval-view.xaml` (local WPF approval portal) are only loaded when `localApprovalDisabled` is false. The installer never writes that configuration, so in this mode they are unreachable code (problem list item A.1).

Sampled usage (from the taskbook's own `y_recent_calls(limit=100)` sample, not re-measured here): `y_file_read` 36, `y_file_edit` 15, `y_file_list` 14, `y_process_run` 11, `y_search_files` 4, `job_submit` 4. Other tools: not measured.

## 2. Migration map (final)

Every retired name answers `NO_TOOL` with its replacement (code: `runtime/retired-tools.mjs`); nothing executes. The compat child process, `runtime/compat-catalog.mjs`, `runtime/compat-engine.mjs`, `engine/src/compat-adapter.mjs`, `compatibility/tool-names.mjs` and the `ui://yuki/` resource aliases are deleted, not deprecated.

| Retired | Replaced by | Notes |
| --- | --- | --- |
| `y_local_get_config` | `y_ping` (+ `y_policy`) | Health/catalog and roots/protections |
| `y_local_read_file` | `y_file_read` | Typed read with SHA-256 |
| `y_local_read_multiple_files` | `y_file_read_many` | New in P1-C: per-file limits, partial failures |
| `y_local_write_file` | `y_file_write` | `expectedSha256` guarded |
| `y_local_create_directory` | `y_file_mkdir` | |
| `y_local_list_directory` | `y_file_list` | |
| `y_local_move_file` | `y_file_move` | |
| `y_local_get_file_info` | `y_file_info` | |
| `y_local_edit_block` | `y_file_edit` / `y_file_patch` | Patch = multi-hunk, dry-run, snapshot |
| `y_local_start_search`, `y_local_get_more_search_results`, `y_local_stop_search`, `y_local_list_searches` | `y_search_text` / `y_search_files` | Searches are bounded and return inline with offset paging; no search sessions |
| `y_local_start_process` | `y_process_start` / `y_process_run` | Typed executable + argv, no shell strings |
| `y_local_read_process_output` | `y_process_poll` | Output token stays scoped to the owning chat |
| `y_local_interact_with_process` | `y_process_input` | Own sessions only |
| `y_local_force_terminate`, `y_local_kill_process` | `y_process_cancel` | Arbitrary PIDs are never signalled |
| `y_local_list_sessions`, `y_local_list_processes` | `y_process_list` (+ `y_system_inspect`) | Own sessions; system list is read-only |
| `y_local_get_usage_stats` | `y_usage_report` | New in P1-C: real ledger aggregation |
| `y_task_submit/status/tail/cancel/list` | `y_job_submit/status/logs/cancel/list` | One canonical durable-job family (engine) |
| `y_task_recover` | `y_job_status` + `y_call_status` / `y_call_result` | Unknown work is recovered by query, never replayed |
| `y_run_trusted_workflow` | `y_job_submit` | Owner workflow hashes still honoured by job policy |
| `y_inspect_download_status` | `y_job_status` | Download progress is merged into job status |
| `download_file` (unprefixed) | `y_download_file` | |
| `verify_checksum` (unprefixed) | `y_verify_checksum` | |
| `call_status` / `call_result` / `recent_calls` (unprefixed) | `y_call_status` / `y_call_result` / `y_recent_calls` | |
| `y_disk_inspect` | `y_system_inspect` kind=`physical-disks` | Broker-supplied native inventory |
| `y_workstation_health` | `y_system_inspect` kind=`health` | Health now includes CPU threads and free disk |
| `y_service_health`, `y_permission_mode` | `y_ping` / `y_policy` | `y_ping` carries the catalog summary; `y_policy` carries the permission mode |
| `y_engine_history` | `y_recent_calls` (+ `y_usage_report`) | One call store: the broker ledger |
| `y_review_approval` | `y_show_approval` | The current card; the alias never approved anything |
| `yuki_*` (any) | the `y_` name in the answer | Name routing deleted |

New tools with no retired predecessor: `y_file_trash` (human-gated Recycle Bin move, snapshot-backed), `y_resource_owner` (read-only ownership view), `y_project_inspect` (bounded structure + manifests + read-only Git).

## 3. Final catalog (installer configuration, after the upgrade)

| Source | Count | Contents |
| --- | ---: | --- |
| Native typed engine (via the in-process extension, `y_ping` filtered — the broker's `y_ping` is the public one) | 42 | `y_file_{list,info,read,read_bytes,read_many,write,edit,patch,copy,move,mkdir,batch}`, `y_search_{text,files}`, `y_project_inspect`, `y_process_{run,start,poll,input,cancel,list}`, `y_job_{submit,status,logs,cancel,list}`, `y_browser_{open,tabs,snapshot,navigate,action,wait,screenshot,download,close}`, `y_desktop_{windows,bind,inspect,value,action,screenshot}`, `y_system_inspect` |
| RC10 UIA fixture launcher | 1 | `y_desktop_fixture` |
| Broker tools | 19 | `y_sqlite_read`, `y_ping`, `y_policy`, `y_dev_task`, `y_close_context`, `y_pending_approvals`, `y_wait_approval`, `y_download_file`, `y_verify_checksum`, `y_call_status`, `y_call_result`, `y_recent_calls`, `y_usage_report`, `y_resource_owner`, `y_file_trash`, `y_backup_{list,diff,restore,accept}` |
| Approval surface | 4 | `y_show_approval`, `y_approval_center`, `y_bar_decide`, `y_bar_status` (both app-only) |
| **Total served by `tools/list`** | **66** | |
| **Model-visible (excluding app-only `y_bar_*`)** | **64** | |

94 → 66 served (−28): engine 40 → 42 (+3 new tools, −1 `y_engine_history`), broker 27 → 19 (−11 served duplicates/aliases, +3 new tools), compat child 21 → 0, approval surface 5 → 4 (−1 `y_review_approval`), fixture unchanged. Every removed name maps to exactly one canonical replacement above, and the approval main chain (`y_show_approval` → `y_wait_approval` → `y_call_status` / `y_call_result`) is the same code path the retired alias rendered.
