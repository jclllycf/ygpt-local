# YGPT Local 1.0.14

An approval card needs the original chat context associated with its saved request. Previously, a missing or different context could leave disabled buttons under an “Awaiting approval” label, while the assistant still asked the user to click.

The tool schema now requires the original `contextToken`. Missing, different or expired contexts return explicit recovery errors with `approvalEnabled: false`, `continueWaiting: false` and no decision capability. The card shows **Refresh approval** and hides unavailable buttons. Recover the original request ID, result token and context token from the same conversation, then refresh only the card. A newer browser context cannot substitute for the original one. The original operation is preserved and never replayed. If the context is lost, the Windows approval center remains an owner-only fallback.

The ordinary approval resource has a new versioned URI; earlier URIs serve the current bundle. A corrected card can recover for the same request. Desktop-triggered Full Access defaults to **100 minutes** after confirmation, only for that chat, with expiry and revocation. Updating does not extend an old grant.

Use Update for an existing installation. Feedback is welcome in [GitHub Issues](https://github.com/jclllycf/ygpt-local/issues).
