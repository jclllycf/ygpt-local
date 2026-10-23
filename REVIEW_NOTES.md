# rc.15 repository review handoff

Started 2026-10-23 at `959523b`, branch `review/rc15-repair-20261023`.
Scope: repository on this Linux machine only; production rc.2 is out of scope.
Keep version `1.0.0-rc.15`; no installer rebuilds, deployment, or GitHub pushes.
Owner directive overrides historical rc.3/taskbook restrictions: default ALLOW;
high-risk operations (including YGPT state/credentials and G: vault) use human
authorization gates. Do not add policy hard-deny categories or enrollment lists.
Browser take-over remains confined to its dedicated YGPT tab group.

History: Codex (GPT-6 Astra) ran the first part of this review and was stopped
mid-run by the owner. Claude (Opus 5.5) took over on 2026-10-23, audited every
Codex commit and the uncommitted diff, and continues below. Commits are local
only (nothing pushed).

## Verification

- Node `v24.22.1`. Untracked owner files left untouched: `CHATGPT_PROBLEMS.md`,
  `CLAUDE_DESIGN2_TASK.md`, `CLAUDE_REVIEW_BRIEF.md`, `NEW_ICON_REFERENCE.png`,
  `REVIEW_BRIEF.md`, `YGPT_LOCAL_NEXT_UPGRADE_TASKBOOK_20261022.md`.
- Required portable suites (`node --test tests/owner-model.test.mjs
  tests/upgrade-portable.test.mjs tests/upgrade-new-tools.test.mjs
  tests/brand-choice.test.mjs tests/blacklist-rc13.test.mjs
  tests/extension-takeover.test.mjs`):
  - Codex baseline at `c751ea7`: 36 tests, 35 pass, 1 skip.
  - Inherited state at takeover (Codex commits + uncommitted diff): 38 tests,
    37 pass, 0 fail, 1 skip.
  - After `848a9e7`: 38 tests, 37 pass, 0 fail, 1 skip.
  - The skip is the isolated-browser test (no bundled Playwright Chromium).
    It now PASSES when pointed at the host Chromium:
    `YGPT_TEST_CHROMIUM=/opt/meta-chromium/chrome node --test tests/upgrade-portable.test.mjs`.
- Full-suite baseline (Codex, `c751ea7`): 51 tests, 38 pass, 11 fail, 2 skip.
  Expected Linux-only failures: `core` catalog/snapshots; `http-auth` OAuth and
  12 handshakes; `oauth-state` DPAPI; `owner-control` actual broker drain; both
  `ui-csp` Edge fixtures; both `windows-native` tests; both `workflows`
  integration tests. Compare failure NAMES, not just the count.
- C# compile check: `.local/` holds a Roslyn SDK + net48 reference assemblies
  (git-ignored). `tests/csharp-langversion.test.mjs` compiles every shipped C#
  target at `-langversion:5` (what the Windows .NET Framework csc accepts) and
  skips when `.local/` is absent.
- Not certifiable here: native Windows installer/update, UIA, DPAPI, a real
  browser extension in Chrome/Edge, ChatGPT host acceptance.

## Audit of the inherited Codex work

| Commit | Verdict | Notes |
| --- | --- | --- |
| `c751ea7`, `0523cdf` docs | kept | Superseded by this file. |
| `e930aa9` reviewed snapshots | **kept** | Removes a de-facto refusal AFTER approval (protected snapshot threw on approved targets). Scoped with AsyncLocalStorage, so one approval cannot widen a concurrent call. |
| `b7ef7c3` updater binding | **kept, fixed in `ae6a9d5`** | Good: target captured at click, selector rebuilt without removing itself, picker reset per install, images released, resume after failed update. **Broke the Windows build**: `await` in a `catch` is C# 6; the .NET Framework csc is C# 5 (CS1985). Also trapped the owner: closing was blocked for the whole ≤10-minute wait for pending approvals. |
| `306f6cd` exact edits | **kept** | `$&`-safe replacement, UTF-8 BOM preserved, hash over exact bytes, unique `wx` temp names. |
| `2ed39e7` protected-target gates | **partially reverted in `848a9e7`** | Verified: it adds gates, never hard denies. But it narrowed the owner's read policy: typed reads of YGPT install/data folders, the G: vault and credential-adjacent names (.env, .env.example, .ssh, *.pem …) and read-only PowerShell naming them became approvals. That contradicts the owner policy in code since the rc.2 baseline, `docs/UPGRADE_SECURITY_NOTE.md` ("reads are automatic"; writes into state/vault gate) and `CHATGPT_PROBLEMS.md` A.2 (owner reports read approvals on the install folder as a defect). Reads cannot forge approvals (tokens hashed, payloads sealed). Also reverted: making every high-risk command once-only (the owner chooses chat-scope at approval time). **Kept**: G: signal for non-read-only commands; moving a folder that contains YGPT state gates; dev tasks and downloads follow the default-allow write policy (download source allowlist and private-address refusal removed — they were hard refusals); approved protected download/checksum targets work; reviewScope path normalisation; removal of the `DESKTOP_NOT_ENROLLED` refusal after an approved bind. |
| `ace08f7` process capacity | **kept** | Synchronous reservation closes the parallel-start fair-share bypass; `nextOffset` no longer skips output; job worker gets the broker-approved cwd (it hard-refused any cwd outside enrolled roots). |
| `e7fe6db` payload ownership | **kept** | Marker written into staging before the swap; staging always cleaned; rollback reports a retained folder. Manifest product/version check matches `scripts/package.mjs`. |
| uncommitted take-over diff | **kept, committed as `7427ee9`** | Closes a real hole: any web page could open `ws://127.0.0.1:19341/devtools/browser` and drive the YGPT group tabs in the logged-in daily profile, and DNS rebinding could read the pairing token. Personal tab metadata no longer leaves the extension. Drain called retired tools so it never reported safe-to-stop. `pending()` capped at 60 rows of any state. Follow-ups below. |

## Fixes committed (Claude)

1. `ae6a9d5` fix(setup): updater compiles as C# 5 again; close allowed during
   the idle wait for pending approvals; resume when this run left the
   connection paused (incl. a pause that timed out). Test:
   `tests/csharp-langversion.test.mjs` (fails on `b7ef7c3`, passes now).
2. `7427ee9` Codex's uncommitted take-over/drain/ledger work, unchanged.
3. `11f69bf` fix(browser): isolated-context URL guard uses `route.fallback()`
   (identical in production; made the isolated-browser test fail with a real
   Chromium).
4. `848a9e7` fix(policy): partial revert of `2ed39e7` (see table).
5. `b356368` fix(extension): 20 s keepalive (MV3 worker otherwise stops after
   ~30 s idle, the socket closes and the chat loses its tabs); CDP events
   forwarded synchronously again (7427ee9's async check let responses overtake
   events); per-tab command dispatch in arrival order.
6. `67a39d5` fix(relay): per-tab in-order check + dispatch (the per-command
   group round trip let mouse released overtake pressed); unknown CDP session
   ids get Chrome's -32001 error instead of `{}`.
7. `71f31d9` fix(take-over): live service starts the relay with the engine;
   first attach waits up to 15 s while the relay is fresh; accurate
   "still reconnecting" error; `y_browser_detach` is per chat (shared
   connection closes with the last chat); attach while connected adopts
   unowned group tabs; `y_close_context` releases the chat's daily-browser tabs.
8. `f4c19e8` fix(relay): CDP endpoint requires a per-process secret header
   (memory only), so other local programs cannot drive the owner's logged-in
   group tabs while bound.

9. `2487467` fix(snapshots): restores kept lowercased paths (canonical() is
   the lowercase comparison key) and NTFS replace-renames take the supplied
   case, so `y_backup_restore` renamed `MyFile.md` → `myfile.md`; the Git
   checkpoint skipped every path with a capital; the Recycle Bin recorded
   lowercased locations. New `resolvedPath()` (case-preserving) for writers.
   Folder deletes had NO snapshot content (entries store file contents only)
   although approval text/docs promised restore: `trashPlan()` now snapshots
   folder trees file by file within bounds and reports Recycle-Bin-only items;
   a single >32 MB file or link now asks a human instead of failing.
   Windows-only end-to-end restore-case test added (skipped on Linux).

10. `45e4b9c` docs(readme): the interrupted README edit (found uncommitted
    after the machine restart) was verified claim by claim against the code
    and committed, with the default-drive wording made exact (D:, else the
    largest other non-system fixed drive).
11. `ad01bc7` docs: UPGRADE_USER_GUIDE was headed rc.12 and still said Agent
    windows are always refused, the isolated browser is "Playwright Edge" and
    YGPT state / G: vault are hard denies — all contradicted by the code
    since rc.13 (gates, Chrome default). Security note scoped to rc.15 with
    the relay access controls. zh README synced. CHANGELOG entry for this
    pass; `scripts/package.mjs` now ships CHANGELOG.md (both READMEs link it;
    the manifest is generated from the stage folder, installers not rebuilt).

12. `42d651a` fix(take-over): Chrome-ended debugger sessions (owner presses
    Cancel on the "started debugging" bar, or a tab becomes undebuggable)
    were never reported: the relay kept the session and the next command
    silently re-attached a blank one without Playwright's enabled domains
    (calls time out). Extension reports `detached`; relay ends that tab's
    sessions (`Target.detachedFromTarget`, Playwright drops the page, the
    tab is re-adopted fresh); Cancel ends the take-over (unbind; tabs, group,
    pairing stay). Popup Save with an empty token field wiped the pairing
    (the token is never shown) — empty now keeps it. New group tabs ask for
    the last focused NORMAL window and group where Chrome placed the tab
    (a focused popup made y_browser_open fail). 5 tests, each failing before.

13. `c9b9bf3` fix(take-over): pages appearing after attach (popup from a
    group tab, re-adopted tab, tab moved into the group) all went to the
    FIRST attaching chat (closure) — chat B's popup went to chat A, and after
    A detached new pages still went to A and could never be adopted. Now:
    extension reports `openerTabId` (only when the opener is a group tab),
    relay maps it to CDP `openerId`; engine tracks the chats holding the
    shared connection — new page → opener's chat, else the only holder,
    else unowned until a chat's attach adopts it. Detach keeps the
    connection while any chat holds it. 5 tests, each failing before
    (incl. a real-Playwright popup e2e).

All take-over fixes have regression tests in `tests/extension-safety.test.mjs`
(each verified to fail before the fix) and the real-Chromium e2e test
`tests/extension-takeover.test.mjs` passes. A real Chrome/Edge with the
unpacked extension is still NOT verified here. After updating YGPT the owner
must press Reload on the extension in chrome://extensions (unpacked
extensions do not pick up new files on their own) — to document.

## In progress / next

- Approval path reviewed (callTool/executeApproved, ledger create/decide/
  claim, in-chat strip `handleBar`, owner-control drain): no defect found.
  The owner-control drain sets `ownerDraining` after its inventory, but the
  watchdog-provided `maintenance-request` barrier already rejects new calls
  before drain runs, so there is no race in production.
- Docs/packaging consistency: done (`45e4b9c`, `ad01bc7`). Portable suites
  at `7c73fcc`: 54 tests (incl. extension-safety, csharp-langversion), 53
  pass, 1 skip.
- Extension robustness: done (`42d651a`).
- Full suite at `42d651a`: 88 tests, 72 pass, 11 fail, 5 skip. Failure
  NAMES identical to the baseline list above (no new failures). Skips:
  4 Windows-only setup/restore tests + the bundled-Chromium browser test.
  Recorded in `docs/UPGRADE_TEST_RESULTS.md`.
- Portable set after `c9b9bf3`: 64 tests, 63 pass, 1 skip; the skipped
  isolated-browser test passes with `YGPT_TEST_CHROMIUM`.
- Next: updater (`setup/UpdateWindow.cs`) end to end, then service
  lifecycle (`service/`, relay start/stop with the engine).
- Reviewed, no defect: file engine write path (per-file lock chain cannot
  cycle; preimage hash re-checked inside the atomic writer before rename;
  `move` refuses to overwrite and keeps the source snapshot) and the vendored
  atomic writer (exclusive temp names, fsync before rename).

## Open items (not changed; owner decision or later work)

- Owner question: should typed reads of the G: vault or credential files
  (`.ssh`, `.env`) need approval? Currently automatic per the shipped policy.
  If yes, it is one check in `authorize()`'s read fast path.
- Under the shipped rc9 config, non-literal / content searches are allowed
  (`authorizeRc9`), although the fast-path comment says they "fall through"
  to a gate. Behaviour matches "reads are automatic"; the comment misleads.
- `y_project_inspect` still gates protected/credential-adjacent targets
  (`native-extension.mjs`), unlike the other reads.
- Setup keeps `<install>.previous-<ticks>` after every successful
  update/repair. README says this is intended ("Updates preserve the previous
  program folder"), but nothing ever removes older copies (a full app copy per
  update). Suggest keeping only the newest; needs a Windows test.
- `executeApproved` throws a plain error when the policy turns `deny` between
  approval and execution; the operation stays `approved` (later `unknown`)
  without a recorded reason. Only malformed requests deny now, so rare.
- A partially failed multi-path `y_file_trash` returns `unknown`; the message
  now lists the paths already moved.

## Assistant completion pass (2026-10-23, after Claude's session limit)

Claude's continuation run ended on its session limit at `4fcfa94` with a clean
tree. The owner directed the assistant to finish the pass along the same line:

- Baselines re-verified at `4fcfa94`: portable set 64 tests, 63 pass, 0 fail,
  1 skip; full suite 93 tests, 77 pass, 11 fail, 5 skip — the 11 failure
  NAMES are identical to the recorded Windows-only baseline. No new failures.
- Updater end to end (the remaining "next" item): `UpdateWindow.cs`,
  `YGPTApp.InstallPayload`, `HostCore.PrepareOwnedRepair`/`Pause`/`Start`
  reviewed. Pause is fail-closed (drain, then health + owned-process proof;
  the barrier is removed when the pause itself refuses); the payload swap is
  integrity-verified with the ownership marker committed before the move and
  a rollback path that reports a retained folder; the brand save cannot fail
  the core update; restart is verified against watchdog health (ownerId,
  version, freshness, not stopped); failure recovery only resumes a pause
  this run created. Discovery stays adaptive (registry, Start Menu shortcut,
  defaults, fixed-drive roots). No defect found that warrants a change.
- Service lifecycle (the other remaining item): `supervisor.mjs` stop path
  (interval cleared, tunnel killed, gateway and broker closed, stopped
  health written) and the relay lifecycle in `browser-engine.mjs`
  (`ensureRelay` memoizes and resets on failure, `prestart` warms it in the
  live service only, `close()` settles attach, disconnects and stops the
  relay; `ExtensionRelay.stop()` rejects pending calls and closes both
  servers) reviewed. No defect found.
- The two open items above stay open as owner decisions (vault/credential
  read approvals; `.previous-*` retention). Neither blocks this release.
- Owner then directed: version bump to `1.0.0-rc.16`, installer rebuild,
  full GitHub push and a GitHub Release with the Setup and Update packages.
