# YGPT Local 1.0.9

This update fixes an unnecessary approval for a read-only directory-size inventory. Its variables, loop and arithmetic were outside the narrow read-only parser, and a reference to the installation folder then triggered the old protected-path command rule.

In owner default-allow mode, unknown scripts, dynamic/encoded code, multiline arguments, protected-folder references and protected working directories are no longer approval reasons by themselves. A script does not need to prove that it is read-only before it can run. Explicit destructive actions, system/privilege changes, protected writes and credential uploads still require review. Encoded PowerShell bodies receive the same concrete risk checks after decoding.

The actual reported request was evaluated against old and new policy without executing it: approve became allow. Isolated broker tests execute the same statistics shape against disposable files and verify that an explicit private write remains suspended. Existing pending requests are retained; the update does not decide or replay them.

Use the Update executable for an existing installation. Credentials, pairing, private data and snapshots are retained. Full Access remains scoped to one chat. See the [permission guide](CHAT_ACCESS.md) and the machine-readable verification attached to the release for measured scope and limitations.

Windows short-path aliases now use the same canonical comparison on both sides of runtime verification. Exact manifest hashes and rejection of linked ancestors remain enforced. The Recycle Bin integration fixture is separate from permission tests and reports a skip on fixture volumes without an existing bin.

Feedback is welcome in [GitHub Issues](https://github.com/jclllycf/ygpt-local/issues). Remove credentials, capability tokens and private data before sharing attachments.
