# YGPT Local 1.0.12

Desktop inspection now reaches deep Chrome/Edge controls instead of silently stopping at depth 8. The reported field attempt ran on 1.0.10: desktop approval and subsequent keyboard calls succeeded; a selector-free `type` call failed with `SELECTOR_REQUIRED`. No corresponding keyboard policy rejection was recorded. The old depth cap hid the extension card's Reload button while reporting `truncated: false`.

`y_desktop_inspect` defaults to depth 32 and 600 nodes. It reports depth, node and changing-tree truncation, supports a current control selector to inspect just a subtree, and accepts bounded `maxDepth`/`maxNodes` adjustments. Toggle state is included, so Developer mode can be checked before an authorized unpacked-extension reload. Missing selectors now return an actionable explanation.

The tool guide distinguishes an extension card's Reload from the browser toolbar Reload and requires actual tool evidence before reporting a safety block. One chat-scoped desktop Full Access grant remains sufficient for subsequent actions during its lifetime. Administrator access is unnecessary for ordinary browser extension reloads.

An actual Windows/Chrome fixture reproduced the depth-8 omission, selected the deeper Reload control, and verified a disposable extension changed from version 1.0 to 1.1, restarted its worker and remained enabled. This fixture does not attest the user's Obsidian Chat Sync reload or its P3R acceptance; those require verification in the original task. Refresh the plugin's tool catalog or start a new conversation after updating if the host retains an older schema.

Use the Update executable for an existing installation. Feedback is welcome in [GitHub Issues](https://github.com/jclllycf/ygpt-local/issues).
