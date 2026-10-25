# YGPT Local current user guide

Read [Setup](SETUP_GUIDE.md) for installation and [Chat permissions](CHAT_ACCESS.md) for detailed access rules.

Use only the current tools/list catalog. Typed reads, ordinary changes and commands without explicit high-risk signals run automatically. File writes retain protected pre-write snapshots. Bulk or sensitive changes require review in Standard mode.

The first desktop binding or input displays one explicit ten-minute Full Access card for this chat. After confirmation, desktop operations across this chat's windows, files and commands need no repeated approval during that period. Revoke with y_chat_access action=revoke. Other chats retain their permissions and resources.

To enable development Full Access directly in ChatGPT, ask for Full Access in this conversation. y_chat_access action=request_full returns the confirmation card itself; Windows settings are not required. The optional duration defaults to 120 minutes. A status check alone does not request activation.

Show the current approval, then use bounded y_wait_approval to keep the task pending and retrieve its existing result after the person decides. Never resubmit an approved or unknown operation. If a client cannot mount the card, the same web conversation or Windows manual approval center is a fallback.

Desktop observations primarily use Windows UIA controls. Browser invoke uses a verified pointer click; keys supports window keyboard chords. Specific native errors describe execution conditions, not missing permission. Screenshots return inline and their local generated PNGs are removed before return. Images already delivered to the chat host follow its retention rules.

Browser work uses a disposable isolated browser unless the person selects a paired daily-browser profile. Preserve the returned contextToken on later calls. Never guess between profiles or touch another chat's tabs.

Unknown effects require inspection. Keep snapshots and credentials; use the signed installation cleanup records for installer leftovers instead of sweeping folders.
