# YGPT Local 1.0.10

This release improves desktop control, in-chat permission activation, approval continuation and screenshot cleanup.

- The first desktop binding or input asks once for **10 minutes of Full Access in this chat**. That explicit confirmation covers desktop windows, files and commands for the period. Other chats retain their permissions. Expiry or revoke restores review before another input.
- Asking for Full Access uses `y_chat_access action=request_full` and returns its confirmation card directly in the conversation. Windows settings are not required. The development mode keeps its optional duration (default 120 minutes).
- Chrome/Edge UIA invoke uses a verified pointer click without invoking first. Window focus, selectors, owned popups and negative multi-monitor coordinates are handled explicitly. Keyboard navigation is available through `y_desktop_action action=keys`.
- Desktop errors preserve their native code and HRESULT. Uncertain effects remain unknown and are never automatically replayed.
- Approval renders use separate widget instances at the current tool step and request picture-in-picture while pending when the host supports it, returning inline after the decision. Bounded waits keep the task pending and return the original result. If no wait is active, the card requests a follow-up. A safe read-only bridge fallback restores controls without retrying a decision.
- Screenshots return inline and their generated local PNG is deleted before return. Image payloads are excluded from local result history. Startup removes old generated screenshots; unrelated images and private state are preserved.
- Removed tool aliases, their resolver and the duplicate approval-center tool are gone. Production does not expose the desktop test fixture. Current instructions replace an outdated skill reference, and historical tool-migration plans are excluded from installed packages.

Actual Chrome/Win32 and disposable desktop tests are distinct from ChatGPT host acceptance. The host controls iframe placement and whether components mount while a response is running; the plugin cannot force a floating composer menu or guarantee identical client behavior. Images already delivered to ChatGPT follow the host's retention rules.

Use Update for an existing installation. The verification attachment records tests, installed state, package hashes and the observed scope. Feedback is welcome in [GitHub Issues](https://github.com/jclllycf/ygpt-local/issues); remove credentials and private data from attachments.
