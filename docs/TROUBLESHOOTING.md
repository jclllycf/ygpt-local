# Troubleshooting

| Symptom | Meaning and recovery |
| --- | --- |
| Local service not ready | Open Settings from Start, inspect separate local/Tunnel/first-use states. A private Secure Tunnel may wait for a host handshake before creating a Broker. Do not repeat a write of unknown outcome. |
| Saved credential detected | Keep preserves the encrypted value. Test verifies connection status; it never displays the key. Replace is explicit. |
| Runtime key invalid or expired | Replace or rotate the dedicated runtime key locally. The Watchdog stops repeated authentication failures instead of creating new keys or Tunnels. |
| Tunnel permission or workspace denied | Check organization, associated ChatGPT workspace and Tunnels Read + Use permission. Do not switch an unrelated installation's identity. |
| Tunnel already owned | The same data or Tunnel identity has another owner. Close that installation through maintenance only after work is idle. Other Tunnel identities are independent. |
| Session terminated / not initialized | Reinitialize and inspect original operation/job state. Never automatically repeat a mutation. |
| Watchdog task failed | Compare task status with fresh owner health. Last task result alone does not establish live connectivity. Settings can start the owned connection. |
| Restricted PowerShell script policy | RC3 default state checks and Tunnel inventory use NativeWindows.exe; command classification only parses text. Do not change execution policy. A missing helper requires the full installer. |
| Stale or missing health | Status is unknown until the owned Watchdog updates health; absence is not green readiness. Check bundled runtime integrity. |
| Approval pending | Show the original request/card and wait for its original result token. Finished prose is not proof of execution. Expired or unavailable scope remains disabled. |
| Opened / CSP off | The outer shell belongs to ChatGPT. Internal approval resources retain CSP metadata. Do not weaken security to hide a host badge. |
| Setup succeeds, ChatGPT not connected | Complete the official personal plugin installation and risk confirmation, then run the wizard's marker task. Local checks do not establish host acceptance. |
| Cleanup waiting | It requires informed consent, authenticated generation-bound marker proof, setup exit and fresh live health. Source Setup deletion has an additional exact-file choice. |
| Cleanup skipped | Inspect the receipt. Changed, linked, open, unknown, referenced or foreign files are preserved. Do not sweep Downloads or Temp. |
| Settings after Setup deletion | Start menu Settings uses the installed verified runtime without the download. Damaged files or version upgrade require a full installer. |
| Maintenance refused | Active work, pending approvals or unknown task state prevent replacement. The application does not kill uncertain work. |
| Restore conflict | CONFLICT / executed:false / filesRestored:0 preserves later edits. Review the diff; do not repeat the stale restore. |
| Desktop app lacks your login | Tool processes use a sanitized HOME/APPDATA; they are not your normal interactive profile. |

OpenAI Secure MCP Tunnel is the default. For a dedicated private Tunnel, No authentication means no additional ChatGPT application OAuth; the Tunnel runtime key and identity still apply. Advanced public HTTPS/Cloudflare retains OAuth. Local-only is a development route, not a ChatGPT connection.

The final RC3 candidate is unsigned and awaits owner testing. Never share keys, private profiles, raw logs or approval tokens in issues. See [setup guide](SETUP_GUIDE.md).
