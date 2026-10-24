# Permissions and chat-scoped Full Access

Standard mode permits typed reads on all valid local paths, including protected locations, under your Windows account permissions. Ordinary file edits keep protected pre-write snapshots. Small cleanup can run automatically through `y_file_trash`: up to 64 entries and 16 MiB, or one ordinary file up to 32 MiB. Cleanup retains a verified snapshot and uses the Windows Recycle Bin.

Sensitive file changes, major deletions, system/privileged changes and desktop input still require review. Window inventory, binding, inspection and focus are automatic. Commands and scripts default to allow unless an explicit high-risk signal is identified. Unknown scripts, local variables, loops, dynamic/encoded code, multiline arguments and references to protected folders are not approval reasons by themselves. An unrecognized script is allowed without claiming that its effects have been proven read-only or safe.

Bundled Node, npm, npx and Python executable paths are trusted only when their exact shipped path, size and SHA-256 match the installed manifest. Their arguments are still checked. An unrelated executable in the same folder does not inherit trust.

On Windows, shipped npm/npx `.cmd` launchers are translated to the equivalent manifest-verified Node executable and CLI script, keeping each argument literal in both process sessions and durable jobs. Changed launch dependencies stop execution. This avoids the direct-script limitation documented in [Node.js](https://nodejs.org/docs/latest-v24.x/api/child_process.html#spawning-bat-and-cmd-files-on-windows); arbitrary scripts do not gain a shell fallback.

## Enable Full Access for one development chat

1. Ask YGPT in that chat: **Request Full Access for this chat for 120 minutes.** The tool call is `y_chat_access` with `action: "request_full"` and optional `durationMinutes` (1–720; default 120).
2. Review the dedicated **Enable Full Access for this chat** card. Choose **Enable Full Access** or **Deny**. The model cannot activate the mode by passing a flag or treating a text reply as a card decision.
3. Keep the returned `contextToken` private in this conversation and include it on later YGPT calls. Check the mode and expiration with `y_chat_access` and `action: "status"`, or `y_policy`.
4. End it with `y_chat_access` and `action: "revoke"`. `y_close_context` also revokes it and releases this chat's browser and desktop bindings.

While active, this chat may read private files, modify files, run commands and operate desktop windows without further YGPT policy approvals. Other chats retain Standard mode. Requests already waiting for a decision remain pending; enabling Full Access does not execute them. Retrieve any existing approved result instead of replaying the operation.

The mode does not elevate Windows privileges. Schema, valid local paths, preimage checks, task output tokens, resource ownership and engine limits remain enforced. Other chats' browser tabs, windows, processes and jobs remain inaccessible. Revocation affects subsequent authorization checks; it does not cancel a running process or undo completed actions. Renewal requires another explicit card decision.

A chat context is a server-issued capability, not an authenticated OpenAI conversation identity. Do not copy its token into another conversation, public logs or GitHub. A restarted broker may retain the grant until its original expiration while that context remains live. If a host does not report conversation closure, the fixed expiration and explicit revoke action provide the end boundary.

If a mobile client does not display the card, open the same conversation in ChatGPT on the web, or use the computer's manual Windows approval center. Missing UI never activates Full Access. No new public approval service is required.
