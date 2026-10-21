# Validation status

This is an implementation candidate, not an accepted public release.

| Gate | Current evidence |
| --- | --- |
| Renamed local MCP, snapshots and exact restore conflict | Real local integration test implemented and passed on the development host |
| HTTP OAuth PKCE, owner consent, discovery, tools and revocation | Real local HTTP + SDK client test passed; the client is explicitly not ChatGPT |
| Native Windows setup build | Compiles with Windows .NET Framework compiler |
| Dependency redistribution inventory | 106 npm package license declarations checked; excluded unresolved old dependency tree |
| Packaged GUI fresh install | Pending packaged installation test |
| Clean Windows 10/11 VM without developer tools | Not executed; no substitute claim from the development host |
| Real Cloudflare existing/new Tunnel | Pending dedicated user credentials and remote validation |
| New-brand ChatGPT plugin, real tool calls and App clicks | Pending actual host connection; old-brand results do not count |
| Twenty natural-language host prompts | Pending; see golden prompts |
| Sanitized public source/archive/history | Source scan and final archive/history review required before publication |
| Public GitHub repository and Release download | Not published or verified |

Remaining product work includes robust in-place updates, complete optional legacy-state migration, automatic official Secure MCP Tunnel client installation, fuller connection diagnostics, credential visibility/rotation UX and clean VM acceptance. A compiled candidate must not be presented as completion of these gates.
