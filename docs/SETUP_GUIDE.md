# Windows setup guide

[中文安装说明](SETUP_GUIDE.zh-CN.md) · [Release notes](RELEASE_1.0.4.md) · [Upgrade guide](UPGRADE_USER_GUIDE.md)

The English Windows wizard has nine steps. Back and the next action stay visible; version information stays at the lower left. Longer pages scroll from the top when you enter them.

Run **YGPTLocal-Setup-1.0.4-win-x64.exe** for a first installation, or **YGPTLocal-Update-1.0.4-win-x64.exe** to update. Compare SHA-256 with the same release's SHA256SUMS.txt. Installers are unsigned.

## 1. Choose folders

Choose an empty **Application folder**, for example D:\YGPTLocal. Product data, caches, snapshots and update files stay inside it. Choose an existing Projects or test **Working folder** for initial file tasks, then review the local-access consent.

**Appearance and approval preview** opens by default. Choose the icon and preview the approval strip. This does not reduce the quality of application or approval artwork.

**Installation cleanup** also opens by default. Both safe cleanup and **Auto remove this exact downloaded Setup** are checked; you can turn either off before installing. The exact download path and size are shown. Downloads and Temp are never swept.

## 2. Check this PC

Review Windows x64, available storage and Windows-user encryption. Node, Python and the official Tunnel Client are bundled. **Connect automatically when I sign in** starts one quiet connection. Port and proxy fields remain optional advanced settings.

## 3. Connection method

Keep **Secure MCP Tunnel** for a supported OpenAI organization and associated ChatGPT workspace. Open the official Tunnels page. The **field by field** guide is already open: copy the suggested name and description using the button beside each field, choose the organization owning your runtime key, and select the ChatGPT workspace where the plugin will be installed. Create a dedicated tunnel, copy its entire tunnel_… ID and paste it below.

The Tunnel ID is not an API key. Do not reuse another installation's active tunnel. Cloudflare and local-only routes remain under advanced methods; public HTTPS uses OAuth, and local-only mode is not directly reachable by remote ChatGPT.

## 4. Runtime key

Open the official API Keys page. The expanded guide provides a suggested key name beside its Copy button and explains organization, project, permission and expiry choices. Paste the secret only into the masked local field. Windows DPAPI encrypts it for your user. Setup runs the Tunnel Client without calling generation models. Saved credentials are kept unless you choose to replace them.

## 5. Review & install

Review all paths, connection settings and cleanup choices, then choose **Install YGPT Local**. The success banner confirms installation separately from remote verification.

Going Back and returning with unchanged settings shows **Continue to connection check** and does not install again. If you change installation settings, **Apply changed settings** applies the new choices once.

## 6. Check connection

| Row | Meaning |
| --- | --- |
| Local tools | Whether the local engine responded |
| Private tunnel | Whether the Tunnel Client has a current connection |
| First ChatGPT task | Whether the marker was read over the authenticated connection |

A connected Tunnel can wait for ChatGPT's first request before starting the engine. Continue to plugin creation in that case. **Connection details** provides measured errors and next actions. A local green status does not prove a real ChatGPT answer or human approval.

## 7. Add to ChatGPT

Open **Plugins → Add → Add custom MCP server**. Follow the visible numbered fields and adjacent Copy buttons.

| Field | Dedicated private tunnel |
| --- | --- |
| Icon | Matching PNG in assets/plugin-icons; **Open plugin icons folder** opens only that folder |
| Name | YGPT Local; copy beside the field |
| Description | Copy beside the description field |
| Connection | Tunnel |
| Tunnel ID | Copy beside the connection field |
| Authentication | No authentication, for this dedicated private Tunnel only |

All five upload PNGs are 256 × 256 and below 10,000 bytes. App, approval, browser-extension and Windows icons use their separate HD assets. The plugin upload size limit does not apply to those surfaces.

Keep the runtime key in YGPT. No authentication omits additional application OAuth only; Tunnel credentials, organization/workspace restrictions and local protections remain. Public HTTPS uses OAuth. Read the official risk warning and create/install the plugin yourself.

## 8. Browser (optional)

Choose your default browser, Chrome or Edge for the final ChatGPT draft. Daily-browser pairing is optional: **Skip for now** continues without it.

To pair, select **Connect my daily Chrome or Edge**. Choose **Open Chrome extensions** or **Open Edge extensions**, turn on Developer mode in the intended profile and use Load unpacked. Copy/open the installed extension folder. Then choose **Open pairing page** in that same browser and enter its token in the extension. Each browser profile pairs separately; YGPT uses its own tab group and preserves personal tabs. You can continue without pairing.

The isolated browser needs no extension. Default reads close it and remove its temporary profile before returning. Multi-step work explicitly uses keepAlive=true and closes when finished; an idle lease releases abandoned contexts.

## 9. Verify & finish

Choose **Open ChatGPT with the check ready**. A new conversation opens with an English prompt in the composer. Review it, select @YGPT Local if needed and send it yourself. Setup does not send the message or select approvals. The link uses OpenAI's [documented unsent-draft pattern](https://developers.openai.com/training/walkthroughs/building-a-shareable-site).

The request checks the application location and file sizes, lists the verification marker before reading it, reports its exact text, and requests cleanup only through the signed ownership plan. Confirm the same marker in the ChatGPT answer. **Check verification result** refreshes local evidence.

With both default cleanup choices kept on, after you open the draft and the authenticated read succeeds, this downloaded Setup closes for cleanup even if you have not clicked **Finish setup**. A hash-verified helper inside the installation waits for Setup to exit, removes eligible exact files and exits. Private data, Settings, runtimes, credentials, snapshots and the retained rollback stay. In-use, changed, referenced or unknown files stay with reasons. The receipt distinguishes completed from deferred removal. You can also finish manually; the connection runs independently.

## Copying and completion feedback

Windows can temporarily lock the clipboard for another program. Copy/Paste buttons retry that contention, then show a recoverable message if it persists. Your setup progress stays available. Close the competing clipboard/remote-session overlay and retry the same button.

Installation, authenticated marker verification and update completion have separate banners. A replaced payload whose connection is still starting is reported separately. File replacement prevents closing the window mid-operation; failures expose a retry action.

Uninstall reports deleted, already absent, changed and blocked files separately, with **Open retained folder**, **Copy details** and data/uninstall-report.json. Private state, snapshots, recovery records and unregistered files are retained intentionally.

**Advanced maintenance → Review installation leftovers** audits contained update caches and obsolete registrations. Cleanup verifies current integrity and connection health, retains one complete rollback, and backs up obsolete registrations before removing them. Developer folders, private data and protected recovery records are not swept.

## Cross-device approvals

When YGPT requests a decision, let the response finish so the client can display its card. The card checks the saved request and follows decisions made on another device. Do not repeatedly ask it to wait or resubmit the original action. If a client shows no buttons, open the same conversation on the web or use **Verify & finish → Advanced maintenance → Open approval center** on the Windows PC. Return to the same chat to retrieve the original result. The Windows center is manual and local; it does not expose a public approval website. See the [1.0.6 notes](RELEASE_1.0.6.md) for verification limits.

## Account field result and feedback

On October 23, 2026, the owner reported successful real use with a ChatGPT Free account. This is a user-reported field result, separate from automated fixture tests; availability and permissions can vary by account and workspace.

[Feedback is welcome](https://github.com/jclllycf/ygpt-local/issues/new): version, steps, expected/actual result and sanitized screenshots help reproduce a problem. Leave out keys, tokens and private contents.
