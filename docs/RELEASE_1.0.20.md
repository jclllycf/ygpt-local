# YGPT Local 1.0.20

Setup now includes **Account connections**. Add another ChatGPT account using
its name, dedicated Tunnel ID and API key, with no second application download.
Up to eight connections share one installation, engine, browser relay and update.

- Separate encrypted keys and authenticated transport identities per connection.
- Account-bound contexts, approvals, Full Access and retained call results.
- Independent Tunnel failures/retries; configuration changes wait for idle work.
- The original default connection and its existing credentials remain in place.
- Native Setup list/editor, measured status, key replacement and connect/stop.

See [account setup and isolation](ACCOUNT_CONNECTIONS.md). This release includes
the 1.0.19 inline-display changes. The owner confirms the optional browser helper
closes restored YGPT viewers without disrupting conversation content and has
authorized release. This is user-reported web acceptance, not native-app coverage.

Browser tools cover owned-tab interaction, console/network observations,
JavaScript evaluation and tab-scoped CDP. A real private developer-browser check
passed extension install/list/reload/trigger/uninstall. Managing extensions in an
existing personal browser still needs Chrome's separate debugging confirmation;
it does not follow automatically from YGPT relay pairing or Full Access.

The released installers are the exact locally installed and verified candidate
artifacts recorded in `evidence/multi-connections-1.0.20.json`, built before this
documentation promotion. No runtime code changed during promotion. Full local
suite: 196 passed, 14 skipped, 0 failed; a later browser-depth check passed 8/8.
Second-account real ChatGPT use, native-app presentation, Administrator/UAC and
clean-VM acceptance remain separately unverified. They are not represented as
passed by fixtures or the owner's browser-helper confirmation.
