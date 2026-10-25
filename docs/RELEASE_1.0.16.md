# YGPT Local 1.0.16

Approval cards now default to inline presentation with details collapsed, including Full Access and Administrator requests. The component no longer requests PiP or fullscreen. It requests inline once per fresh card to clear an expanded surface inherited from an earlier version, then preserves a later manual details choice. New versioned resources and compatibility resources all advertise inline only.

Pending approval and approved-but-running responses explicitly retain `taskPending`, `continueWaiting`, `shouldEndTurn: false` and the next wait action. The assistant is instructed to keep waiting with the original arguments instead of treating a bounded timeout as completion or asking for another user message.

The card also distinguishes an active wait, a result already returned and a wait that ended without returning a result. It continues checking even after the action becomes terminal when continuation is still pending, sends one continuation notification when needed, and avoids duplicate messages or operation replay. Server-supplied instance markers now use an app-owned field rather than ChatGPT's host-owned widget session ID.

ChatGPT controls exact placement and response lifecycle. Its current [UI guidelines](https://developers.openai.com/plugins/concepts/ui-guidelines) place inline cards before the generated response; this update cannot insert cards between arbitrary paragraphs or guarantee an uninterrupted host generation. A cached old panel may need to be closed once. Fresh real-host acceptance remains separate from fixture and installed-backend validation.

Desktop Full Access still defaults to **100 minutes**. The earlier development-PC input refusal during a fullscreen game remains a separate, unresolved desktop acceptance check; this release does not operate or close the game.

Use Update for an existing installation. Feedback is welcome in [GitHub Issues](https://github.com/jclllycf/ygpt-local/issues).
