# YGPT Local 1.0.8

This release reduces unnecessary approvals in Standard mode and adds owner-approved Full Access scoped to one development chat.

- All typed reads, including protected paths and dry-run patches, run automatically. Ordinary edits keep pre-write snapshots. Small cleanup is automatic with verified snapshots and the Recycle Bin; sensitive changes and major deletions still require review.
- Verified bundled runtime paths no longer trigger installation-path warnings by themselves. Arguments that reference protected data or destructive operations are still checked. Recognized read-only SSH diagnostics may use an identity file without an unnecessary approval.
- Shipped npm/npx Windows launchers run through their manifest-verified Node and CLI files with literal argv, fixing `spawn EINVAL` for process sessions and durable jobs without adding a shell fallback.
- Read-only desktop window binding and focus are automatic; desktop input remains reviewed in Standard mode.
- Use `y_chat_access` to request Full Access, inspect its status or revoke it. A dedicated card requires the owner's decision. Default duration is two hours, maximum twelve hours. Other chats and their resources remain isolated; pending actions are not automatically executed. Closing the context or revoking the mode restores Standard rules.

See [permissions and Full Access](CHAT_ACCESS.md) for usage, expiration and revocation behavior. Use the **Update** executable for an existing installation. Credentials, pairing, Tunnel identity, private data and snapshots are retained. The browser extension remains version 1.0.19 and needs no reinstall.

Automated validation covers isolated broker decisions, cross-chat isolation, revocation, expiry, protected reads, snapshot-backed changes, task tokens and responsive cards. Test card decisions are fixtures, not evidence of a new human click in ChatGPT or a physical Android acceptance run. The machine-readable release verification records the actual package and installed-runtime checks.

Feedback and reproducible bug reports are welcome in [GitHub Issues](https://github.com/jclllycf/ygpt-local/issues). Remove keys, capability tokens, private URLs and personal data from attachments.
