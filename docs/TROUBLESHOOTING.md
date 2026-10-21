# Troubleshooting / 故障排查

| Symptom | Meaning and recovery |
| --- | --- |
| Local service not ready | Check the selected port and bundled runtime files. Use Start service, then retry the same diagnostic. Do not repeat a write of unknown outcome. |
| Tunnel disconnected | Check the connector token, outbound HTTPS/proxy, route and credentials. A Cloudflare connector token cannot create DNS. Do not replace an unrelated tunnel. |
| Authentication failed | Distinguish Cloudflare API token, connector token, OAuth pairing key and Secure MCP Tunnel runtime key. Use the exact MCP resource URL and callback URI. |
| Session terminated / not initialized | The client may reconnect after a process restart. Query existing operation/job state and reinitialize; never automatically resend a mutation. |
| SQLite tool missing | Compare the public catalog with ChatGPT's refreshed plugin tools. `y_sqlite_read` is public; two approval tools are App-only. Refresh the personal connection if needed. |
| Approval pending | Show the card with original request/context, then wait with the original result token. A finished response is not proof that a pending action ran. |
| Restore conflict | `CONFLICT`, `executed:false`, `filesRestored:0` preserves newer content. Review the diff and restore in the correct order. Do not retry the stale restore. |
| Desktop app has no login | Terminal processes use a sanitized HOME/APPDATA. This is different from your normal interactive app profile. No Windows account switch is implied. |
| Opened / CSP off | The outer shell belongs to the host. The internal card has CSP metadata and hashed inline scripts. Never disable authentication or CSP to hide a badge. |
| Setup succeeds, ChatGPT not connected | Complete the official plugin creation/install confirmation and an actual tool call. Local health alone does not satisfy host acceptance. |
| Setup retry after partial install | Retain existing files and credentials. The candidate currently refuses in-place overwrite; use a new empty candidate directory. Do not delete snapshots to force a reinstall. |

The default route needs a stable HTTPS hostname ending in `/mcp`; Quick Tunnel URLs are not recommended as persistent plugin endpoints. For new Cloudflare provisioning, grant only the necessary account Tunnel Edit and zone DNS Edit rights. Existing hostnames are never overwritten.

Connection steps: ChatGPT Plugins → + → Add custom MCP server → YGPT Local → HTTPS `/mcp` or eligible Tunnel → authentication → review → create → install → `@YGPT Local` read test. Follow the current official interface if labels change.
