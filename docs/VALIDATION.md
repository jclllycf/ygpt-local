# Current validation: 1.0.9

Release 1.0.9 fixes command approvals based solely on a protected path reference or an unrecognized script shape. The actual reported request was evaluated without execution: the old policy required approval and the new policy allowed it. Broker fixtures execute the same directory-statistics shape with local variables, loops and arithmetic, while an explicit protected write remains suspended.

Regression coverage includes unknown/dynamic/encoded and multiline scripts, protected working directories, protected writes, credential uploads, disk/security/service changes, decoded destructive commands and existing Full Access isolation. Exact current test, package and installed-runtime results are in [machine-readable verification](../evidence/readonly-1.0.9-verification.json). No test decides or replays a live pending operation. This default-allow blacklist does not prove arbitrary scripts safe or create an OS sandbox.

The full local run passed 142 of 147 tests with five environment skips and no failures. After the runtime-path and fixture portability corrections, all 14 final access/command tests passed, including a real Windows 8.3 alias, linked-path refusal, npm/npx launch integrity, the actual local Recycle Bin and broker directory statistics. Hosted CI results are reported separately; the prior 1.0.8 CI had failed runtime-alias checks and timed out in its combined Recycle Bin fixture. The bin-dependent test is now separate and checks fixture-volume availability rather than skipping permission coverage.

## Previous 1.0.8 validation

Release 1.0.8 reduces unnecessary approvals and adds owner-approved, chat-scoped Full Access. See the [release notes](RELEASE_1.0.8.md), [permission guide](CHAT_ACCESS.md) and [machine-readable verification](../evidence/access-1.0.8-verification.json).

The final full local run covered 143 tests: 137 passed, five environment-specific checks skipped and one desktop UIA fixture initially failed after reading an extra character. That fixture and its companion approval test both passed on an isolated rerun without changing assertions or production UIA code. The resulting unique coverage is 138 passed and five skipped; the initial UIA discrepancy is recorded rather than hidden, and its cause is unconfirmed. An earlier complete run passed all 137 runnable checks before the additional npm/npx launch test.

Skips cover three POSIX-helper UIA fixtures, a `python3` alias fixture and a repo-local Roslyn compilation fixture. Actual native Windows state checks, compiled desktop UIA and the ordinary Windows build are separate checks. Focused runs also passed the access/card bridge, installer/updater/native and Windows approval-center checks. The npm/npx regression verifies literal arguments in a real process, the validated argv passed to durable jobs and pre-execution refusal after CLI tampering.

Coverage includes exact approval/duration/context binding, restart/expiry/revoke behavior, no pending-request replay, other-chat resource refusal, task output-token validation even in Full Access, manifest-hash runtime trust, protected reads/dry-run patches, snapshot-backed changes and small cleanup. Cards were checked at phone and desktop sizes with both standard and compatibility bridges. Test card decisions are isolated fixtures, not new trusted human-click attestation. Physical Android and a clean Windows VM were not rerun.

Package integrity, private-data exclusion and installed-runtime readiness are recorded separately in the release verification. Production maintenance waits for live requests and approvals to clear. No test enables Full Access in a live user chat or decides its pending operation.

## Previous 1.0.6 approval compatibility validation

The current release is 1.0.6. See the [release notes](RELEASE_1.0.6.md) and [machine-readable verification](../evidence/mobile-1.0.6-verification.json). It changes pending approvals to render and yield, handles delayed component metadata, refreshes cross-device state, deduplicates continuation messages and provides a manual Windows-owner approval center. The versioned resource keeps old URI aliases and restrictive CSP.

The local full run passed 126 of 131 tests, with five environment-specific skips. One additional bridge-error scenario passed separately: 132 unique tests, 127 passed, five skipped, zero unresolved failures. It verifies that an acknowledged decision with a lost reply is reconciled without replay. Browser checks use isolated phone/desktop viewports and protocol fixtures; WPF tests exercise the compiled window with a disposable transport. They are not physical Android ChatGPT acceptance or new trusted human-click attestation. The exact Android cause and the host's outer diagnostic-badge conditions remain unconfirmed.

Earlier 1.0.5 field evidence established recovered Windows readiness, Tunnel connectivity and successful host-requested file operations after the numbered-profile fix. That evidence and the owner's ChatGPT Free result remain separate from 1.0.6 acceptance. A production update preserves live pending decisions and is deferred while the maintenance guard reports active requests. Clean-Windows and Windows sign-in/reboot acceptance are not established here.

Earlier stable and RC records remain historical evidence. The table below describes RC3 only.

## Historical RC3 validation and owner handoff

The owner requested English-only UI, then asked to perform the remaining tests personally. Automated behavioral testing was stopped. The final RC3 package is compiled and supplied for owner acceptance; no final package, official Secure Tunnel, or ChatGPT acceptance is claimed. The existing RC2 production connection was preserved.

| Evidence | Actual scope and limit |
| --- | --- |
| Local compound regression | 12/12 passed during development before the final startup-task ownership guard; not ChatGPT |
| Native Windows checks | 2/2 passed separately for parse-only command classification and state ACL/link boundaries, before the final guard |
| Earlier packaged installer | 25 native lifecycle assertions passed on the development PC, advanced local-only mode, installer SHA daaa3193667e1715fc7fc7e47ccc4ef0fc60fb318f51efc153a454728a101dcc; earlier bilingual UI, not the final package |
| Cleanup fixture | Exact manifest, changed/open/replaced/foreign/reference/link safety and idempotent receipts exercised. Two owned fixture files, 16 bytes total reclaimed. Not real ChatGPT-triggered cleanup |
| Clean Windows Sandbox | Started and installed an earlier candidate; startup failed because PowerShell script execution was restricted. Replaced default startup scripts with a typed native Windows helper. The final fix was not retested in Sandbox at the owner's request; VM stopped |
| Scheduler first-install fix | The follow-up record documents 15/15 focused checks and a packaged UIA run for an earlier installer hash `8ad442d933d713d90bebf170c353b92b8f95b675f216a410fec56643ba5de843`. Those results do not apply to the newest package below |
| English-only final UI | Language switch and alternate UI strings removed; final native GUI and DPI/accessibility acceptance left to owner |
| Standalone Watchdog | Implemented. Earlier local-mode GUI-exit, single-owner and owned-child recovery checks passed. Actual Windows sign-in and network loss were not verified |
| Official Tunnel / ChatGPT | Owner deferred dedicated website steps. No new Tunnel, key, personal plugin or human risk confirmation created. RC2 evidence is historical and cannot satisfy RC3 gates |
| Final package | Built with bundled runtimes, original icon and native helper; SHA-256 listed alongside download. Unsigned |
| Public Release | Not published. Private development branch is the delivery target until owner acceptance |

See [RC3 development evidence](../evidence/rc3-development.json) and [release gates](../evidence/release-gates.json). A local marker read is not proof of a real ChatGPT user or physical human click. Unknown-result mutations must not be replayed.

## Prior resource measurement

A 15-second sample of an earlier advanced local-only chain measured 23,805,952 private bytes for the Watchdog (22.7 MiB), 202,407,936 private bytes for four processes (193.0 MiB), and 0.062% machine CPU across 32 logical processors. Some working sets were paged out. These are development observations, not a final Secure Tunnel resource budget.

## Owner acceptance still outstanding

Final English-only install/repair, official Secure Tunnel plus first ChatGPT marker read, authentic approval decisions, login/reconnect, cleanup then maintenance/read/restore, clean Windows 10/11 and DPI/accessibility. These were not rerun after the owner took over testing.
