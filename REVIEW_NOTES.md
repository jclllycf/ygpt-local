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

## In progress / next

- Take-over robustness (highest user impact, in progress):
  - Relay starts lazily on the first `y_browser_attach`, which then waits only
    ~4.7 s; the extension reconnects on a backoff/alarm of up to ~30 s, so the
    first attach after YGPT starts usually fails with a misleading "extension
    not installed" message.
  - No extension keepalive: the MV3 service worker can be stopped after ~30 s
    without WebSocket traffic, closing the socket; the relay unbinds and the
    chat loses its tabs.
  - `debugger.onEvent` awaits two Chrome API calls before forwarding each CDP
    event, so events can arrive after the response to the command that caused
    them (ordering Playwright relies on). Use the synchronous `attached` set.
  - `y_browser_detach` from any chat disconnects the shared take-over browser
    for every chat.
- Then: docs/packaging consistency (README, CHANGELOG, UPGRADE_USER_GUIDE,
  UPGRADE_SECURITY_NOTE vs. the code above), full-suite comparison.

## Open items (not changed; owner decision or later work)

- Owner question: should typed reads of the G: vault or credential files
  (`.ssh`, `.env`) need approval? Currently automatic per the shipped policy.
  If yes, it is one check in `authorize()`'s read fast path.
- Under the shipped rc9 config, non-literal / content searches are allowed
  (`authorizeRc9`), although the fast-path comment says they "fall through"
  to a gate. Behaviour matches "reads are automatic"; the comment misleads.
- `y_project_inspect` still gates protected/credential-adjacent targets
  (`native-extension.mjs`), unlike the other reads.
- Setup leaves `<install>.previous-<ticks>` folders after every successful
  update/repair (a full app copy each time); nothing removes them.
