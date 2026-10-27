# YGPT Local 1.0.19

Approval presentation now explicitly prefers inline mode before the component
loads. New resource identifiers separate this bundle from earlier cached cards;
previous resource addresses continue to serve the current bundle.

- A compatibility API that silently does nothing cannot suppress negotiation over
  the standard MCP Apps bridge after initialization.
- Display requests have a deadline and bounded recovery. A host-context change
  during a request receives its own negotiation.
- An inline acknowledgement does not override a still-expanded reported mode.
  Closing a reported expanded surface never submits an approval decision.
- Ordinary, desktop, Full Access and Administrator cards share this behavior.
  Permission scopes, six-hour request expiry and 100-minute desktop access stay
  unchanged.
- The browser extension adds an optional ChatGPT display helper. Enable it from
  the popup and grant `chatgpt.com` scripting access personally. It closes only
  viewers with both a known YGPT approval title and YGPT branding, even when the
  component failed to mount. It does not read chat bodies, send messages, submit
  approval decisions or expose personal tabs to the browser tool relay.

The existing ChatGPT web client was observed restoring a separate viewer after
refresh, including when the component could not load. A server-side component
cannot run code in that missing frame or directly clear the host's saved viewer.
The optional browser helper operates outside that missing frame. Fixture results
are still not proof that the host behavior is resolved. See the verification
record for the actual acceptance state. This helper applies to Chrome/Edge web
pages, not native ChatGPT mobile or desktop applications.
