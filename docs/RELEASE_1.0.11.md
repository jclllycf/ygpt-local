# YGPT Local 1.0.11

Ordinary approvals stay in the conversation. Only an explicit Full Access request may automatically open its separate panel; it returns inline after the decision. The two surfaces use separate versioned resources and declared display modes.

Full Access has an optional **Administrator** mode. Ask for Full Access with Administrator access, or use `y_chat_access` with `action: "request_full"`, `administrator: true` and the desired duration. Confirm the chat card, then Windows UAC on the PC. Ordinary Full Access never requests UAC.

Use `y_admin_run` for explicit elevated commands. The temporary executor belongs only to that chat and lasts no longer than its Full Access grant. Normal typed file and desktop tools retain their ordinary Windows token. Commands have a 25-second limit and bounded output; specify an executable and literal arguments. Administrator commands can change protected files and system settings. Completed changes are not undone on expiry.

Expiry, revoke, context close or broker disconnect closes the executor and its job-owned process tree. A connection interrupted after dispatch is recorded as unknown, never as proof that nothing ran. Re-enabling requires another card and UAC confirmation; Administrator access does not survive broker restart. Cancelling UAC keeps ordinary Full Access active and reports Administrator access as inactive. A same-account elevated Windows token is required; switching to another administrator identity is not supported.

The owner reported successful mobile Full Access use on 1.0.10. That is separate from this release's automated phone/desktop fixtures. Native transport and cleanup tests do not attest real UAC acceptance; no live chat was elevated by tests. Windows UAC remains an OS interaction on the PC and cannot be approved by the model or replaced by the phone card.

Use Update for an existing installation. Checksums and verification accompany the downloads. Feedback is welcome in [GitHub Issues](https://github.com/jclllycf/ygpt-local/issues); remove credentials and private data from attachments.
