# YGPT Local — Cloud Claude Development Handoff

This is a **private Windows MCP application**, not a deployable cloud service. Cloud Claude can modify the repository and run portable Node checks; native Win32/WPF, installation, Tunnel, UIA, and host approval behavior require an isolated authorized Windows test environment. Never describe a source-only test as a real ChatGPT-host acceptance.

## Primary specification

Read **[docs/YGPT_LOCAL_NEXT_UPGRADE_TASKBOOK_20261022.md](docs/YGPT_LOCAL_NEXT_UPGRADE_TASKBOOK_20261022.md)** completely before changing code. It is the newest owner-approved upgrade brief: ChatGPT conversation-only YGPT Local, no interference with ChatGPT Desktop Agent; Desktop UIA stays available but defaults to verified human consent; Playwright Edge Browser remains isolated; multiple simultaneous conversations work independently; old duplicate compatibility interfaces may be removed after replacement; stronger provenance, resource ownership, file conflict handling, and recovery.

Also read `docs/RC3_HANDOFF.md`, `docs/VALIDATION.md`, `docs/SECURITY.md`, `evidence/RC3_SECURE_TUNNEL_REAL_WINDOWS_VERIFICATION_20261022.md`, and `evidence/release-gates.json`.

## Actual status at sync

- Source baseline: 1.0.0-rc.3 candidate. The user's **currently connected production** remained 1.0.0-rc.2 when last verified; this repository is not a production cutover.
- Most recent local Windows fix: official Secure Tunnel Client incorrectly parsed backslash-based Windows paths inside `--mcp.command`; `setup/Watchdog.cs` now supplies forward-slash absolute paths, improves error classification and reports tunnel-ready-before-first-MCP-call. Regression and isolated Windows verification records are committed in `tests/` and `evidence/`.
- This fix's Windows Tunnel Ready is **not** proof of an authenticated first ChatGPT tool call. Remaining release gates are not automatically passed.
- Last local full `npm test` rerun in an active multi-session Windows workstation returned failures with `STARTUP_FAILED A bridge already owns this state; second instance refused` from test helpers. Treat that as an **unresolved test-environment state-ownership conflict**, not established success or an automatically established source-code bug. Re-run under an isolated test profile, inspect exact ownership, and fix safely if reproducible. **Do not terminate any existing Agent, production, or unknown process to force a pass.**
- The source-focused public audit ran successfully with no reported findings; the audit scope excludes binaries and complete Git history.

## Cloud workflow

1. Check `git status`, commit HEAD, and the taskbook before starting. Create a new feature branch for next-stage work.
2. Keep all credentials and local private data out of commits, logs, issues, patches and artifacts. The `dist/`, `.local/`, `node_modules/`, `build/`, and credential files are deliberately ignored. No `api key.txt`, `tunnel.txt`, DPAPI state, runtime secrets or user data in source control.
3. Use Node 24 and the lockfile: `npm ci --ignore-scripts`. Windows CI specification is `.github/workflows/build.yml`; on Windows, `node scripts/fetch-runtimes.mjs`, `npm run build`, `npm test`, `npm run check:public`, `npm run package`. Cloud Linux cannot certify Windows native behavior.
4. Reuse the source and tests committed here. Implement P0 isolation, UIA consent, cross-conversation capability ownership, concurrency, then new tools and compatible API consolidation.
5. Never access or interrupt the live rc.2 Tunnel or ChatGPT Desktop Agent, never alter the private production user's credentials, and do not deploy or publish a release without user approval.
6. Deliver source changes, explicit test PASS/FAIL/NOT VERIFIED evidence, dependency-aware tool migration, build output and hash, and a complete cloud-to-Windows acceptance handoff.

The owner will perform final acceptance. This document is developer guidance, not evidence that any unexecuted tests passed.
