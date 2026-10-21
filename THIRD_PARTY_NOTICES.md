# Third-party software

YGPT Local integrates existing open-source components. It is not affiliated with OpenAI, Microsoft or Cloudflare.

| Component | License | Distribution |
| --- | --- | --- |
| MCP TypeScript SDK 1.32.1 | MIT | MCP protocol and HTTP transport |
| Playwright 1.62.1 | Apache-2.0 | Isolated installed Edge automation; no personal browser profile |
| @vscode/ripgrep 1.18.0 | MIT / binary notices | Bounded native search |
| Ajv, Zod, zod-to-json-schema, proper-lockfile, https-proxy-agent | MIT | Schema, state coordination and networking |
| Desktop Commander 0.3.0 atomic-write, rename and process-tree primitives | MIT | Vendored source and original LICENSE in engine/vendor/desktop-commander |
| Node.js 24.22.0 | Node.js license and bundled notices | Official Windows distribution, original LICENSE retained |
| CPython 3.14.8 | Python Software Foundation license | Official embeddable distribution, LICENSE.txt retained |
| cloudflared 2026.10.2 | Apache-2.0 | Official publisher binary, checksum verified |
| OpenAI tunnel-client 0.0.16 | Apache-2.0 and dependency notices | Official Windows binary, release digest verified; LICENSE, NOTICE, binary license inventory and SPDX retained |
| Windows .NET Framework, UI Automation, Edge | Windows system components | Not redistributed |

Desktop Commander primitives retain Copyright (c) 2024-2025 Eduard Ruzga and Desktop Commander Contributors. The full Desktop Commander npm dependency is deliberately excluded: its previous dependency tree contained unresolved license declarations. Compatibility tools use this project's small broker-owned adapter instead. Original licenses remain with the vendored primitives.

See [the installed dependency inventory](docs/dependency-licenses.json). Npm packages keep their own LICENSE/NOTICE files in the portable distribution. The compiled approval bundle's third-party notices are preserved at runtime/ui-third-party-notices.txt.

Secure MCP Tunnel uses the bundled, unmodified official OpenAI tunnel-client. Its original LICENSE, NOTICE, binary license inventory and SPDX are under `runtimes/licenses` in the distribution. No OpenAI API keys or tunnel identities are bundled. Release digests are pinned in `scripts/runtime-lock.json`; no Sigstore verification is claimed.

cloudflared: <https://github.com/cloudflare/cloudflared/blob/master/LICENSE>. Node.js: <https://github.com/nodejs/node/blob/v24.22.0/LICENSE>. Python: <https://docs.python.org/3/license.html>.
