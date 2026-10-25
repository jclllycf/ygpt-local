# YGPT Local: current development entry point

This directory is the canonical source checkout. Read `package.json`, `README.md`,
`plugin/skills/local-work/SKILL.md`, and the current runtime tool descriptors for
the active version and behavior. The installed application is `D:\YGPTLocal`;
its private data directory is `D:\YGPTLocal\data`.

Use `runtime/enhanced-server.mjs` and the current `tools/list` response as the tool
contract. Historical release notes and evidence document previous behavior; they
are not current operational instructions. Old approval resource addresses serve
the current component for existing conversations; they do not enable old tools.

Do not use build payloads, `.local` helpers, downloaded installers, or recovery
directories as an alternative source tree. Generated artifacts are not source.
Keep Git metadata in this checkout, independently of temporary recovery folders.
Before deleting an old checkout, inspect Git common-directory/worktree references
as well as running processes, path containment, and filesystem links.

Preserve private settings, encrypted credentials, browser pairing, databases and
user snapshots during engineering and cleanup. Only owner-confirmed decisions
may approve production operations or Windows UAC. Report actual host acceptance
separately from fixtures and local readiness.
