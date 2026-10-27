# YGPT Local 1.0.20 — candidate

Setup now includes **Account connections**. Add another ChatGPT account using
its name, dedicated Tunnel ID and API key, with no second application download.
Up to eight connections share one installation, engine, browser relay and update.

- Separate encrypted keys and authenticated transport identities per connection.
- Account-bound contexts, approvals, Full Access and retained call results.
- Independent Tunnel failures/retries; configuration changes wait for idle work.
- The original default connection and its existing credentials remain in place.
- Native Setup list/editor, measured status, key replacement and connect/stop.

See [account setup and isolation](ACCOUNT_CONNECTIONS.md). This is a development
candidate; isolated regression evidence and actual account acceptance are reported
separately. It also includes the 1.0.19 inline-display changes and their documented
ChatGPT-host limitations.
