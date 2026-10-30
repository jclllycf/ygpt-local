# Permissions and chat-scoped Full Access

Standard mode permits typed reads on all valid local paths, including protected locations, under your Windows account permissions. Ordinary file edits keep protected pre-write snapshots. Small cleanup can run automatically through `y_file_trash`: up to 64 entries and 16 MiB, or one ordinary file up to 32 MiB. Cleanup retains a verified snapshot and uses the Windows Recycle Bin.

Sensitive file changes, major deletions and system/privileged changes require review in Standard mode. Window inventory and inspection of a chat-owned bound window are automatic. The first desktop binding or input asks once for 100-minute Full Access to this chat; within that period all desktop windows, files and commands need no further YGPT approval. Commands and scripts otherwise default to allow unless an explicit high-risk signal is identified. Unknown scripts, variables, loops, dynamic/encoded code, multiline arguments and protected-folder references alone do not require approval.

Bundled Node, npm, npx and Python executable paths are trusted only when their exact shipped path, size and SHA-256 match the installed manifest. Their arguments are still checked. An unrelated executable in the same folder does not inherit trust.

On Windows, shipped npm/npx `.cmd` launchers are translated to the equivalent manifest-verified Node executable and CLI script, keeping each argument literal in both process sessions and durable jobs. Changed launch dependencies stop execution. This avoids the direct-script limitation documented in [Node.js](https://nodejs.org/docs/latest-v24.x/api/child_process.html#spawning-bat-and-cmd-files-on-windows); arbitrary scripts do not gain a shell fallback.

## Enable Full Access for one development chat

All approvals, including Full Access and Administrator requests, prefer inline with details collapsed. The resource declares both inline-only support and an explicit inline preference. The standard bridge negotiates after initialization even if a compatibility method silently ignores the request. Presentation requests have deadlines and bounded recovery; later status updates preserve a manual details choice.

For the optional Administrator executor, ask **Enable Full Access with Administrator access for this chat for 120 minutes**. Use `action: "request_full"`, `administrator: true` and `durationMinutes: 120`. Confirm the chat card and then Windows UAC on the PC. Check `administrator.active`, not only `mode: "full"`. Cancelling UAC leaves ordinary Full Access active.

Use `y_admin_run` with an explicit `.exe`, literal `args`, absolute `cwd` and optional `timeoutMs` up to 25,000. Normal typed file and desktop tools remain unprivileged. Expiry, revoke, context close or broker disconnect ends the executor and its job-owned process tree; completed changes remain. Interrupted dispatched commands have unknown effects and must not be replayed automatically. Administrator access requires the same Windows account's elevated token and is not restored after bridge restart. Never approve Windows UAC for the person.

1. Ask YGPT in that chat: **Request Full Access for this chat for 120 minutes.** The tool call is `y_chat_access` with `action: "request_full"` and optional `durationMinutes` (1–720; default 120).
2. That tool request directly returns the **Enable Full Access for this chat** card in this conversation. Choose **Enable Full Access** or **Deny**; Windows settings are not required. Checking status alone does not request activation. The model cannot activate the mode by passing a flag or treating a text reply as a card decision.
3. Keep the returned `contextToken` private in this conversation and include it on later YGPT calls. Check the mode and expiration with `y_chat_access` and `action: "status"`, or `y_policy`.
4. End it with `y_chat_access` and `action: "revoke"`. `y_close_context` also revokes it and releases this chat's browser and desktop bindings.

While active, this chat may read private files, modify files, run commands and operate desktop windows without further YGPT policy approvals. Other chats retain Standard mode. Requests already waiting for a decision remain pending; enabling Full Access does not execute them. Retrieve any existing approved result instead of replaying the operation.

Desktop consent and the selected window step have separate outcomes. From
1.0.21, if that window disappears or changes while waiting, the confirmed
100-minute grant remains active, but the old step returns
`DESKTOP_TARGET_STALE` without execution. Keep the original contextToken, read
the current windows and bind the intended target; no new approval is needed
while the grant is active. The card reports “Access granted” with the desktop
error. Upgrading never reactivates failed historical requests or replays them.

The mode does not elevate Windows privileges. Schema, valid local paths, preimage checks, task output tokens, resource ownership and engine limits remain enforced. Other chats' browser tabs, windows, processes and jobs remain inaccessible. Revocation affects subsequent authorization checks; it does not cancel a running process or undo completed actions. Renewal requires another explicit card decision.

A chat context is a server-issued capability, not an authenticated OpenAI conversation identity. Do not copy its token into another conversation, public logs or GitHub. A restarted broker may retain the grant until its original expiration while that context remains live. If a host does not report conversation closure, the fixed expiration and explicit revoke action provide the end boundary.

If a mobile client does not display the card, open the same conversation in ChatGPT on the web, or use the computer's manual Windows approval center. Missing UI never activates Full Access. No new public approval service is required.

## Desktop tasks and screenshots

If a card shows **Refresh approval** or a tool returns `APPROVAL_CONTEXT_*`, its original context is missing, different or expired. Do not click or wait on that unavailable card. Ask the assistant to recover the original `requestId`, `resultToken` and `contextToken` from the same conversation and refresh only the card. If the context was lost, resolve the saved request yourself in the Windows approval center. Do not repeat the desktop action or borrow another chat's context.

The first desktop-control card explicitly grants Full Access for 100 minutes and executes that one requested desktop step after confirmation. Later bindings, clicks, keyboard chords and commands within this chat reuse the grant. Other pending operations are not replayed. Expiry or revoke restores review before another input. `y_desktop_action action=keys` accepts a chord such as `CTRL+L`, `CTRL+T` or `ENTER`; selectors, native errors and unknown outcomes must still be checked.

Desktop automation primarily reads Windows UIA control trees. Screenshots are separate image observations. Generated PNGs are sent inline and removed locally before return; local result history retains metadata, not image bytes. Startup reclaims old generated screenshots. Unrelated images, credentials and snapshots stay intact. Images already delivered to ChatGPT follow the host's retention rules.

Keyboard chords are submitted as one ordered batch, including modifier releases. Input failures report `inputDiagnostics`: actual requested/inserted events, Win32 error and the observed process integrity levels. A zero return does not establish UIPI; see [Microsoft SendInput](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-sendinput). `INPUT_INTEGRITY_MISMATCH` checks for a higher-integrity target before injection. Other failures must not trigger repeated approvals or automatic elevation. A partial delivery or earlier successful input leaves an unknown outcome: inspect the window and keyboard state without replaying the action. After a service restart, refresh and bind the current window; old desktop target IDs are not restored.

Display one fresh approval card at the current request step, then call bounded `y_wait_approval`. While `taskPending` or `continueWaiting` is true, wait again with the original arguments; this includes approved operations still running. A timeout is not completion and should not cause a final answer asking for another user message. A decision resumes the saved result automatically. If a wait ends without delivering the result, the card reconciles status and sends one continuation message; a result already returned by a wait does not trigger a duplicate message. Unknown deliveries retain the message-only Resume chat fallback.

An app-owned render marker distinguishes approval renders without supplying ChatGPT's host-owned widget session ID. The host controls mounting, exact placement and response lifecycle. Its current [UI guidelines](https://developers.openai.com/plugins/concepts/ui-guidelines) place inline cards before the generated response, so a plugin cannot insert a card between arbitrary paragraphs or guarantee that a host response remains open. A host can restore a separate viewer before loading the component; if the component fails to mount, none of its display negotiation can execute. Closing that viewer once is not proof that refresh will keep it closed. Real host acceptance must check that behavior separately from component fixtures.

For Chrome/Edge web pages, the extension popup offers **Keep YGPT approvals in chat**. This is disabled until the owner explicitly enables it and grants optional scripting access to `https://chatgpt.com/*`. The helper checks only known YGPT viewer titles, YGPT branding and the host's Close viewer control. It never reads conversation bodies, posts messages, changes permissions or presses approval buttons. The browser tool relay keeps its existing tab-group isolation. Disable the helper in the popup at any time; site permission can also be removed in the browser's extension settings. Native ChatGPT applications do not run this browser helper.
