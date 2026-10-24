# YGPT Local 1.0.7

This update fixes daily-browser profile selection and connection failures when an old YGPT group tab stops answering Chrome's debugging protocol.

- Profile selection now creates a private chat context before any tab opens. Retain its `contextToken` on the selection, open and later browser calls. Separate chats can select different paired profiles concurrently.
- Choosing another profile explicitly changes the destination for new tabs. Existing tab IDs keep their original profile and chat ownership. The tab list identifies each profile; detach releases only this chat across its selected profiles.
- Resolve old group tabs independently with bounded setup time. An unresponsive tab is temporarily skipped, preserved and reported by count, allowing healthy tabs and new tasks to work. Duplicate attachment notifications are suppressed.

Use the **Update** executable for an existing installation. Pairing, credentials, Tunnel identity, private data and snapshots are retained. A new browser extension installation is not required; its version stays 1.0.19.

Validation includes the actual broker/context path, independent Chrome-backed profile transports, cross-chat refusal, explicit switching with existing tabs and an injected unresponsive frame-tree request. Release verification records separate isolated tests, physical Chrome profile checks and Tunnel readiness. These checks do not constitute a new clean-VM or Android acceptance run.

Feedback and reproducible bug reports are welcome in [GitHub Issues](https://github.com/jclllycf/ygpt-local/issues). Please remove keys, pairing tokens, private URLs and personal data from attachments.
