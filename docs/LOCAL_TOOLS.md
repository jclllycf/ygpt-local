# Local tools and Agent dispatch

YGPT can discover existing local MCP configurations, route calls to their servers,
inventory installed CLI programs, and delegate work to local Agents from a normal
ChatGPT conversation. The ChatGPT model chooses the capability; it is not necessary
to say “use my local MCP” on every task. Host tool selection still depends on the
model and client, so automatic routing is a capability, not a guarantee.

## The five interfaces

| Tool | Purpose |
| --- | --- |
| `y_capabilities` | Search/paginate local MCP, CLI and Agent entries. |
| `y_capability_sources` | Add a configuration source or include/exclude an entry in YGPT. |
| `y_mcp` | Inspect tools, call an exact tool, read resources/prompts, or close a connection. |
| `y_cli` | Run an inventoried CLI with argv/stdin; list, inspect, read logs or cancel its task. |
| `y_agent` | Delegate a prompt to an exact Agent profile and track its task/session. |

Discovery runs when the engine starts and refreshes on demand, with a one-minute
cache. It reads recognized Codex, Claude, VS Code, Cursor, Windsurf and Gemini
configuration locations, project `.mcp.json` / `.vscode/mcp.json`, and the owner's
`.ygpt/local-tools.json`. CLI discovery inventories bounded PATH directories and
known Codex installation locations. It never executes version probes, installs
packages, starts every discovered server, or scans every disk recursively.
Programs outside these locations need an additional configuration source.

The catalog contains paths, names, descriptions and configured model/profile
metadata. It excludes source argv, environment values, HTTP headers and credentials.
Two servers named `rea` in different source files have different IDs. Discovery
does not prove that either server is running. Disabled entries remain disabled;
configured `enabled_tools` and `disabled_tools` filters also remain effective.

## Using a local MCP service

1. Search `y_capabilities kind=mcp` for the task, for example `rea` or `voicestudio`.
2. Call `y_mcp action=tools serverId=<returned ID>` to connect and inspect schemas.
3. Call `y_mcp action=call serverId=... name=<exact tool> arguments={...}`.
4. Close with `action=close` when finished; idle connections close after five minutes.

The MCP client supports stdio, Streamable HTTP and existing legacy SSE sources.
HTTP credentials stay with the configured origin; redirects and origin changes are
rejected. There is no automatic OAuth login or browser confirmation. Missing
credentials and unsupported input-variable configurations produce a setup error.
The original server's authentication and permissions still apply. Descriptions,
resource text and prompt templates are untrusted data, never authority to grant access.

Tool arguments are validated against the server's input schema. Catalogs are
paginated and bounded; repeated cursors are rejected. Stateful calls queue within
one chat/server, while independent servers and chats can work concurrently. Clients
are separate per chat and source, with at most four per chat and sixteen overall.
An interrupted tool invocation is reported as an unknown outcome and never replayed.
Inspect the server's existing state before issuing any further mutation.

## Agent and CLI tasks

Search `kind=agent`, then call `y_agent action=run entryId=... prompt=... cwd=...`.
Use a concise label. The response returns immediately with a persistent `taskId`.
Read `status` and `logs`, or request `cancel` for that same ID and chat context.
There are at most two active or unresolved dispatch tasks per chat and six durable
jobs across the bridge. Independent Agents should use separate working directories;
YGPT does not merge conflicting edits or share conversation memory between them.

The Codex adapter uses `codex exec --json -`, sends the task on stdin and closes
stdin. It preserves the exact account home and its configured model, provider,
MCP tools and permission defaults. It does not add model overrides, ignore user
configuration, forward Full Access, bypass native approvals or silently switch
accounts. A CLI task is not a Codex Desktop conversation. Its actual CLI session ID
is recorded from the JSONL stream, including when early lines scroll out of the log
tail. `resumeTaskId` can continue only a finished Codex task owned by the same chat,
account and working directory.

Other installed Agents appear in discovery. Their CLI contracts vary: inspect the
installed CLI's help through `y_cli`, then provide its documented non-interactive
arguments and prompt stdin. YGPT does not guess model or permission flags. Configure
an argv prefix and `adapter: "stdin"` for a reusable custom wrapper. Programs that
require an interactive TTY need an appropriate non-interactive wrapper; the task
runner uses pipes. Existing Agent approvals may still need that Agent's own UI.

CLI dispatch accepts an argv array and optional stdin. Windows command shims use a
fixed bundled escaped launcher; PowerShell scripts use an explicit `-File` invocation.
No prompt is assembled into shell command text. Returning the same task ID with the
same request retrieves the existing task; different arguments reject as a collision.
If submission has an unknown outcome, query that ID instead of launching again.

## Additional sources and account profiles

Use `y_capability_sources action=add_source source=<absolute config file>` for an
additional Agent account's `config.toml` or another MCP JSON/TOML source. YGPT stores
only source paths and exclusions in its private source index; it does not rewrite
the source, copy credentials, merge login homes or change the Agent's own tools.
Exclusions affect future launches; they do not cancel already running tasks.

For an independent YGPT configuration, create `.ygpt/local-tools.json` in the owner
profile. Use actual installed paths in place of these examples:

```json
{
  "sources": ["D:/AgentProfiles/Account2/codex-home/config.toml"],
  "mcpServers": {
    "my-local-service": {
      "command": "C:/Tools/node.exe",
      "args": ["D:/Tools/my-mcp/server.mjs"],
      "cwd": "D:/Tools/my-mcp"
    }
  },
  "agents": {
    "my-agent": {
      "executable": "C:/Tools/my-agent.exe",
      "adapter": "stdin",
      "args": ["run", "--non-interactive"],
      "description": "My configured local development Agent"
    }
  },
  "cli": {
    "my-tool": {"executable": "C:/Tools/my-tool.exe", "args": []}
  }
}
```

These are illustrative wrapper arguments, not verified flags for a particular
vendor. The source environment supports configured string values and `${NAME}` /
`${env:NAME}` references. Ambient service secrets and YGPT control variables are
not forwarded. A required named variable that is unavailable fails explicitly.
Secrets should remain in the existing source/account's supported credential store.

## Storage and limits

Command payloads, stdin and logs use the existing Windows CurrentUser DPAPI durable
job storage; logs are bounded and completed jobs expire after fourteen days. The
private task index stores ownership, profile ID, request digest, label, directory
and session ID. MCP result payloads and task log observations are delivered live
without duplicating them in the general call ledger. General result retrieval may
therefore require sampling a read again; never replay a mutation to retrieve output.

Tool scratch lives outside YGPT's credential/approval state tree. MCP scratch is
reclaimed on close; completed Agent scratch is reclaimed on status checks or the
periodic sweep. Retained project artifacts must be written to the requested project
directory. Active or uncertain tasks retain scratch for reconciliation. Normal
shutdown closes MCP connections and leaves durable jobs running. Closing the chat
context revokes its ability to control them; cancel jobs first if that is intended.
These boundaries are application ownership and environment isolation, not an OS
sandbox against malicious local software running as the Windows owner.

References: [MCP SDK client documentation](https://github.com/modelcontextprotocol/typescript-sdk/blob/1.32.1/docs/client.md),
[Codex non-interactive mode](https://developers.openai.com/codex/noninteractive).
