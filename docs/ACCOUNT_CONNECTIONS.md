# Multiple ChatGPT accounts, one installation

Open the installed **YGPT Local — Setup**, choose **Account connections**, then
**Add account**. Enter an account name, that account's dedicated **Tunnel ID**,
and its **Tunnel API key**. Choose **Save connection**. No second download,
application folder, runtime, browser extension or update installation is needed.

Sign in to the second ChatGPT account and open **Plugins → Add → Add custom MCP
server**. Select **Tunnel**, paste its own Tunnel ID, and use **No authentication**
for this dedicated private Tunnel. Read and confirm ChatGPT's installation steps
yourself. The runtime API key belongs only in local Setup, never in ChatGPT.
Each account must have its own eligible organization/workspace connection;
having a local configuration does not establish remote account eligibility.

Up to eight connections, including the original default, can run simultaneously.
The original connection and encrypted credentials stay in place. An additional
connection stores its own DPAPI-encrypted key under `data/connections/<id>/`;
the list in `data/connections.json` contains no API keys. Edit a saved account to
rename it, change its Tunnel or replace its key. A blank replacement-key field
keeps the saved key. **Connect** and **Stop connection** affect that additional
account only. They do not pause the entire application.

One Watchdog and one local engine serve all connections. Browser pairing, the
installed tool catalog, native desktop input serialization and application
updates are shared. Working folders and the ordinary Windows user's access are
also shared; profiles are not separate OS sandboxes. Each authenticated Tunnel
adapter supplies its connection identity independently of model arguments.
Chat capabilities, Full Access, approval decisions and retained operation/call
results cannot be reused through a different connection. Existing default-account
capabilities remain default-account capabilities after upgrade.

Adding a connection starts it without restarting the engine. Changing credentials
or stopping an existing connection waits until active calls, pending approvals,
Administrator executors and owned background work are idle. Setup reports the
pending change. Existing work is not replayed. An invalid key or a failed Tunnel
has its own retry/attention state and does not restart another account or the
shared engine. Enabled accounts use the installation's existing Windows startup
setting. Update once to update the application used by every connection.

The connection rows report actual local transport readiness. **Connected** is
not proof that the second ChatGPT account has installed the plugin or made a
real tool call; verify a read-only task from that account after installation.
Credentials, local connection lists and health records must never be published.
