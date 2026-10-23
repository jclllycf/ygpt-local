# Brand assets and plugin upload icons

The current identity preserves the owner's sprout-Y and golden sunrise. HD application artwork and size-limited plugin uploads are separate.

| Surface | Asset |
| --- | --- |
| Application / setup rail / README | assets/brand/ygpt-local-512.png; 256/1024 versions also retained |
| Current approval strip | Matching 512 px design embedded by runtime/inline-approval.mjs |
| Five appearance choices | Current sprout, green y_, sky y_, classic green Y, signature; HD 512 px sources |
| ChatGPT plugin upload | assets/plugin-icons/01…05 PNGs, each 256×256 and strictly below 10,000 bytes |
| Plugin package logo | plugin/assets/logo.png; matches 01-sprout-256.png |
| Browser extension | extension/icons/ygpt-256.png; separate full-color asset |
| Windows executable | assets/brand/ygpt-local.ico, seven frames from 16 through 256 px |
| Installed shortcut | assets/ygpt-VERSION.ico, refreshed by registration to avoid stale shell caching |

The setup opens only the plugin-icons folder for uploads. It copies the path of the design matching the selected approval icon. The older assets/brand/plugin-icon-256.png remains a compatibility asset; it is not the wizard's upload target.

Run python scripts/plugin-icons.py with Pillow to regenerate upload PNGs from the five HD sources. It checks the strict byte limit and writes icons.json with exact dimensions and sizes. scripts/make-icons-from-original.py also runs this export so regeneration cannot replace the upload logo with an oversized HD image. Other artwork retains full quality.
