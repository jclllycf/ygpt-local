# YGPT Local 1.0.4 — clearer setup and exact-file cleanup

[中文说明](RELEASE_1.0.4_ZH.md) · [Setup guide](SETUP_GUIDE.md) · [Verification](../evidence/setup-1.0.4-verification.json)

The Windows setup now has nine guided steps, a fixed lower-left version footer, clearer Segoe UI typography and field-level actions. Returning to Review & install after installing continues without a second installation unless settings changed.

- Clipboard actions retry temporary Windows contention and give recoverable feedback when busy.
- Five plugin-only 256×256 PNGs live in `assets/plugin-icons`, each below 10,000 bytes. The guide copies the matching icon path and opens only that folder. Other UI and Windows icons stay HD.
- Appearance, approval previews and field-by-field guides open by default. Copy buttons sit beside their fields. Exact downloaded Setup/updater removal is checked by default and can be cancelled.
- A separate **Browser (optional)** step can be skipped. It offers Chrome/Edge extension-manager links, the extension folder and the pairing page.
- **Open ChatGPT with the check ready** opens an English installation/size/cleanup request as an unsent draft in the selected browser. The user reviews and sends it.
- After that draft is opened and its marker is authenticated, default cleanup can close the downloaded Setup even without clicking Finish setup. A hash-verified installed helper waits for its exit, deletes only signed-plan exact files and exits. Verification-marker cleanup removes its empty owned folder. Installed Settings, private data, credentials, runtimes, snapshots and the retained rollback stay.

The prompt asks for installation paths and sizes before reading the marker, then requests bounded cleanup. Receipts distinguish actual deletion from deferred or skipped work. Existing integrity, file identity, reference and live-connection checks remain in force.

## Product field milestone

On October 23, 2026, the owner reported successful real use with a **ChatGPT Free account**. This expands the observed feasibility of using local Windows tools from the ChatGPT account people already have. It is a user-reported field result, separate from automated tests, and does not establish universal availability across Free accounts or workspaces.

## Validation scope

The compiled WPF wizard, transient clipboard retry, draft URL encoding, unchanged-settings navigation, optional browser actions and after-exit cleanup are exercised in disposable fixtures. Tests do not access the owner's clipboard, send a ChatGPT message, choose an approval, or modify the production installation. The final draft-composer behavior still needs verification in the user's selected logged-in browser.

The owner's local upgrade remains deferred at their request. Clean-Windows installation, Windows sign-in recovery and every account/browser workflow remain separate acceptance checks. This release preserves the existing contained data/update layout and browser lifecycle behavior.

## Downloads and feedback

Use Setup for a first install, Update for an existing installation, or Portable for manual deployment. Compare each artifact with `SHA256SUMS.txt`; installers are unsigned.

[Feedback is welcome](https://github.com/jclllycf/ygpt-local/issues/new). Include versions, reproducible steps, expected/actual results and sanitized screenshots. Leave out keys, tokens and private contents.
