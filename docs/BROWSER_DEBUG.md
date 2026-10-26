# Browser development through YGPT

All capabilities use the normal YGPT catalog. Retain the returned context token; tab IDs and developer browsers belong to that context.

| Task | Tool and action |
| --- | --- |
| Discover paired daily Chrome/Edge profiles | `y_browser_attach action=profiles` |
| Choose one paired profile | `y_browser_attach` with its exact instance |
| Start bounded page diagnostics | `y_browser_debug action=status` on an owned tab |
| Inspect recent observations | `console` or `network`; logs stay in memory and are bounded |
| Read a response body | `cdp`, method `Network.getResponseBody`, with a captured requestId |
| Evaluate page code | `evaluate`, with expression; a timeout is uncertain and must not be replayed |
| Inspect/change a tab through CDP | `cdp` in the supported page domains; Browser/Target are excluded |
| List/install/reload/trigger/uninstall extensions | `y_browser_extensions` |
| Release a developer connection | extension action `close`, or `y_close_context` |

Extension `target=developer` creates a private headless Chrome profile for this chat. Install an absolute unpacked extension folder, retain its returned ID, and use that exact ID for later actions. It neither copies nor signs into a personal profile.

Extension `target=existing` uses the official Chrome DevTools connection. The person must enable remote debugging in `chrome://inspect/#remote-debugging` and confirm Chrome's connection request. This is independent of the paired YGPT page relay. A relay label such as luoyu/jcll is not proof that the official connection is the same Profile. Confirm the intended browser before a mutation. Browser version, channel and platform restrictions may make some extension operations unavailable; report the actual error and do not switch to desktop clicks automatically.

`status` lists adapter capabilities; it does not verify a browser connection. `list` actually connects. Chrome Use remains a separate installed product and is not upgraded or replaced by YGPT.

Network capture starts at debug status, so reproduce the issue afterwards. Automatic records omit headers and URL query strings; explicit evaluate/CDP results may contain requested page data. Close tabs or use clear after debugging. A browser wait result of timeout means the condition was not observed and can be checked again. A mutation with an uncertain result requires inspecting actual state rather than replaying it.
