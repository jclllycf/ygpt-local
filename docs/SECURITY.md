# Security model

The intended principal is one Windows owner connecting a client they trust. YGPT Local executes with that user's Windows permissions. Sanitized environment variables and path checks are **not an OS sandbox** and do not undo arbitrary subprocess effects.

The HTTP server listens only on loopback. A public Cloudflare hostname must use HTTPS and owner-bound OAuth authorization code flow with PKCE S256, exact redirect allowlisting, one-use expiring codes and revocable, scoped access tokens. An explicit owner pairing confirmation is required. Tokens are not accepted from URL query strings. Secrets are DPAPI-encrypted at rest; diagnostics must never contain them. The owner pairing key belongs only in the OAuth confirmation page, never in a model message.

Secure MCP Tunnel is an optional private transport, subject to Platform/workspace permissions. Its runtime credential and the local MCP transport key are distinct from the operator health key. Existing production tunnels must not be reused by two runtimes.

High-risk operations pause for a one-request App capability. The private decision capability is carried only in App metadata. The model must not call decision tools. Decision replay reads existing status; it does not run the action again. Unknown effects remain unknown and must be reconciled before retrying.

Snapshots cover actual listed preimages, with size/depth limits. Restore conflicts preserve newer content. Batch operations are not atomic. Old user state, credentials, databases and approval capabilities are not part of the public source tree or the release payload.

Before publication: review source and clean Git history, runtime hashes and notices, install/uninstall boundaries, OAuth negative tests, the built archive, and actual host evidence. The included automated scanner is a scoped aid, not a claim of exhaustive security audit or legal review.

Do not open public issues containing tokens, keys, cookies, private file content or raw state. Describe the issue without secrets first; arrange a private disclosure channel with the repository maintainer before sharing sensitive details.
