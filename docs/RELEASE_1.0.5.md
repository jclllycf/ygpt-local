# YGPT Local 1.0.5 — Chrome profile startup fix

[中文说明](RELEASE_1.0.5_ZH.md) · [Setup guide](SETUP_GUIDE.md) · [Verification](../evidence/startup-1.0.5-verification.json)

An isolated Chrome profile named `Profile 1` could prevent the local engine from starting after setup. The private Tunnel could remain connected while tool calls timed out. The Windows state audit recognized Chrome's network-service capability on `Default` caches but incorrectly rejected the same capability on numbered profiles.

The audit now recognizes `Default` and numbered `Profile N` directories only inside YGPT's isolated Chrome tree. The capability SID, Windows owner and allowed cache/storage paths remain restricted. Unrelated SIDs, credential directories, misleading profile names and unexpected links remain rejected. Existing profiles, permissions and credentials do not need to be deleted or weakened.

The browser picker now matches the setup wizard: a clean pale-blue surface, rounded border, clearer arrow, readable menu rows, selected/hover states and a visible keyboard-focus ring. It continues to use native ComboBox selection and keyboard behavior.

![The browser picker in the compiled Windows wizard](images/browser-picker-1.0.5.png)

## Browser groups

Daily-browser automation keeps its live YGPT tab group. Chrome's saved-group entry in the bookmarks bar is available after closing a group; closing it removes the live tabs the agent needs. This release therefore does not close or hide active groups in the bookmarks bar. New YGPT tabs continue to open without becoming active.

## Updating and validation

Use `YGPTLocal-Update-1.0.5-win-x64.exe` for an existing installation. Keep the same application folder, data and Tunnel identity. Compare the download with `SHA256SUMS.txt`. Windows installers remain unsigned.

Regression checks exercise numbered-profile ACLs and rejected unsafe cases, native picker selection, the existing installer flow and cleanup safeguards. Local Windows checks and project-owner field evidence are reported separately in the verification record. They do not constitute clean-VM, reboot or every-account acceptance.

[Feedback is welcome](https://github.com/jclllycf/ygpt-local/issues/new). Include versions and reproduction steps; omit keys, pairing tokens and private contents.
