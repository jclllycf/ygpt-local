# RC3 continuation handoff

Current branch: `release/1.0.0-rc.3` in the private repository `jclllycf/ygpt-local`.

This candidate replaces the setup shell with an English-only eight-page Windows wizard and a separate silent Watchdog. The owner requested to perform remaining tests personally. Do not treat source compilation, local tests, or old RC2 host evidence as acceptance of the newest installer.

## Current status

- Source, setup guide, scheduler first-install fix, issue notes, brand assets and test sources belong in this branch.
- Latest installer binaries are distributed as a **draft owner-test release**, not in Git history. Draft release links require access to the private repository.
- Production remains RC2. The RC3 Secure Tunnel / ChatGPT first-use flow has not been cut over or claimed verified.
- The seven local handoff task files are intentionally excluded by `.gitignore`; this handoff and the public repository documentation preserve the continuing project context.
- Do not commit local `dist/api key.txt`, `dist/tunnel.txt`, user credentials, `.local`, build caches, or runtime state.

## Owner acceptance still to perform

Install the draft candidate in a separate directory and data profile. Follow `SETUP_GUIDE.md`; enter credentials only into its local masked fields. Do not reuse the active production Tunnel identity while another process owns it. Check installation and Repair, actual ChatGPT first read, approval scope, login start, network recovery, cleanup and later maintenance/restore. Report failures without replaying an operation whose result is unknown.

## Build from source

On Windows x64 with Node 24 and .NET Framework 4.8/WPF compiler, run `npm ci --ignore-scripts`, `node scripts/fetch-runtimes.mjs`, `npm run build`, then `npm run package`. The generated installer is unsigned. The current owner asked Codex not to run further functional tests; do not mark gates as passed without fresh evidence tied to the exact artifact digest.

See `RC3_DELIVERY_ZH.md`, `VALIDATION.md`, `RC3_CLEANUP_INVENTORY_ZH.md`, and `evidence/release-gates.json` before changing release status.
