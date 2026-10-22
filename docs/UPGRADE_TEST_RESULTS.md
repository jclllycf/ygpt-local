# YGPT Local chat-only upgrade — test results

Candidate: 1.0.0-rc.4, branch `upgrade/chat-only-isolation-20261022` (HEAD at writing: the P1-C commit plus this deliverables commit).
Environment for everything below: Linux VM (Ubuntu 24.04), Node 24, Roslyn csc from the repo-local .NET SDK with net48 reference assemblies. Date: 2026-10-22. **Nothing in this document is a ChatGPT-host or real-Windows result unless it says so.**

## Automated results

| Check | Result |
| --- | --- |
| `tests/upgrade-portable.test.mjs` (chat contexts, ownership, Agent boundary, UIA consent, browser isolation, ledger) | **21 pass, 1 skipped, 0 fail** |
| `tests/upgrade-new-tools.test.mjs` (y_file_read_many, y_file_patch incl. STALE_PREIMAGE/PATCH_NOT_FOUND, y_project_inspect, retired map, usage/ownership data layer) | **5 pass, 0 fail** |
| Full suite `npm test`, upgraded tree | 42 tests: **29 pass, 11 fail, 2 skipped** |
| Full suite `npm test`, merge baseline `4f2a07d` (same machine) | 16 tests: 3 pass, 12 fail, 1 skipped |
| Regression diff | **No pass→fail regressions.** All 11 upgraded-tree failures also fail at baseline (Windows-only: DPAPI, Edge channel for the CSP browser test, native/WPF helpers, `py` launcher, host HTTP fixtures). Name deltas are intentional: the compat-layer test was deleted with the layer it tested, and the ui-csp browser test was renamed when the legacy metadata variant was removed (it fails on both trees for the missing Edge channel). The pass count rises because the upgrade added the two portable suites. |
| C# compiles (Roslyn, net48 refs, sprout ICO) | setup (HostCore+YGPTLocal+SetupWindow) ✅, watchdog ✅, YDesktop ✅ |
| `setup/NativeWindows.cs` compile | ✅ Compiled against the official Microsoft PowerShell 5.1 reference assemblies (NuGet `Microsoft.PowerShell.5.1.ReferenceAssemblies`) — the payload includes `runtime/NativeWindows.exe` |
| `node --check` on all runtime/service/engine/scripts `.mjs` | ✅ clean |
| `node scripts/csp.mjs` | ✅ hashes match |
| `node scripts/public-audit.mjs` | ✅ 204 source files, 0 findings |
| Icon regeneration (`scripts/make-icons.mjs` twice, md5 compare) | ✅ deterministic (verified at the brand commits; icon inputs unchanged since) |

## Taskbook §4 matrix — coverage map

| Matrix row | Status here |
| --- | --- |
| A/B/C chats read different files in parallel | Portable tests: per-context ownership + engine concurrency model; host run pending on Windows |
| Near-simultaneous same read tool from two chats | Covered by design (no global lock; idempotency scoped per context) + portable idempotency test |
| A/B write the same file; external change in between | ✅ Unit-proven pattern: `expectedSha256`/`STALE_PREIMAGE` (file engine + `y_file_patch` tests) |
| Long job in A does not block B | Fair job shares (P0-D) + per-file locks; host run pending |
| A uses B's browser tab id | ✅ Portable: browser engine ownership, `SESSION_FOREIGN`/`NO_TAB` |
| A cancels B's process/job | ✅ Portable: ownership violation checks in the broker + token scoping tests |
| YGPT targets Agent window/process/browser | ✅ Portable: classification + `TARGET_FOREIGN` refusals, isolated-browser assertion |
| Whitelisted window, no approval → no UIA control | ✅ Portable: `uiaDecision` requires approval for bind/action |
| Allow once → exactly one execution | Approval claim is atomic in the broker ledger (portable); real click path is a Windows host test |
| Deny / timeout → no execution, no replay | ✅ Portable ledger semantics; host click path pending |
| Playwright Edge launch reuses no foreign profile/CDP | ✅ Portable: `assertIsolatedBrowserConfig` |
| UIA and Browser simultaneously | Independent engines; host run pending |
| Fresh chat after compat cleanup sees only canonical API | ✅ Static catalog count 66/64 (`docs/UPGRADE_TOOL_MAPPING.md` §3); the retired-name test proves `NO_TOOL` answers |
| Lost job-submit response → query, never re-run | ✅ Durable job + `y_call_status` semantics (portable) |
| Install / offline / recover / uninstall affect only this install | **Windows-only — not run here** (owner acceptance) |
| High-risk approval and revocation intact; model cannot self-approve | ✅ Portable consent model; host attestation limits stated in the security note |
| Usage report is real and attributed | ✅ Data-layer test (usage rows, error codes, context labels, transports); unattested provenance is labelled `unverified` |

## What the owner still needs to run on Windows (acceptance)

1. Install the candidate (`dist/YGPTLocal-Setup-1.0.0-rc.4-win-x64.exe`, SHA-256 in `dist/SHA256SUMS.txt`) in an isolated profile. The package is complete — runtimes, `NativeWindows.exe` and the Windows ripgrep binary included; rebuilding from source with `npm run build && npm run package` on Windows remains the fallback.
2. The §4 rows marked "host run pending": three-chat concurrency in real ChatGPT, UIA Allow-once/Deny against a real third-party app, Agent-window refusal against the real Desktop Agent, installer lifecycle.
3. Confirm the sprout icon in Explorer/taskbar/tray and the wizard end-to-end.

## Owner blacklist model (1.0.0-rc.5), 2026-10-22

- `tests/owner-model.test.mjs`: 2 pass — the file engine writes/reads an absolute path outside its root (a stand-in AppData config on a second volume) while relative escapes still fail `OUT_OF_SCOPE`; the access policy (run against a Windows-shaped owner config) allows the Clash-style AppData write and ordinary document writes, gates credential-adjacent writes, tiers `y_file_trash` (single file allow / batch approve / system path approve / YGPT state deny), gates downloads outside project folders, and flags wildcard and pipelined bulk deletes as high-risk.
- Portable suites unchanged: `upgrade-portable` 21 pass + 1 skipped, `upgrade-new-tools` 5 pass. Full suite: 44 tests, 31 pass, 11 fail, 2 skipped — the 11 failures are the same Windows-only set as the rc.4 baseline comparison (no regressions). CSP check and public audit pass (211 files).
- Still owner-only on Windows: the tiered trash executing end-to-end (snapshot -> Recycle Bin -> restore) and an actual AppData config edit through a real chat.
