# YGPT Local personal plugin

- Skill instructions: `skills/local-work/SKILL.md`
- Logo: `assets/logo.png` (256×256 PNG, ≤10 KB, transparent corners): the sprout Y with its rising sun, on a white tile

## Values for ChatGPT's "Add custom MCP server" form

The setup wizard's last step (**Connect ChatGPT**) shows these values with a Copy button next to each, so nothing has to be typed by hand.

| Field | Value |
| --- | --- |
| Name | `YGPT Local` |
| Description | `Works with files and projects on my Windows PC through YGPT Local. Use it whenever I mention a local file, folder, path or project: list, read, search and edit files, inspect SQLite databases and run project tasks, instead of giving me code to run by hand. Edits keep a snapshot that can be restored; high-risk actions wait for my approval.` |
| MCP server URL | Your HTTPS address followed by `/mcp` (Cloudflare), or select your Secure MCP Tunnel |
| Authentication | OAuth for HTTPS. ChatGPT opens an approval page; paste the owner pairing key there, never in a chat. |

Use the values as they are. A placeholder such as `1` for the name or description makes the plugin hard for ChatGPT to recognise. A specific description is what helps ChatGPT reach for the tools instead of handing back code to run by hand. The host still chooses when to call tools, so select `@YGPT Local` if it doesn't.

If ChatGPT says **App setup was rate limited**, ChatGPT is pacing plugin creation. Your tunnel and local service are fine. Wait a few minutes and create it again.

## Logo and icon

This plugin format has no manifest or icon field, so `scripts/package.mjs` does not bundle the plugin. The logo is here for you to upload when you create or edit the personal YGPT Local plugin in ChatGPT, if the plugin settings let you choose an icon.

The canonical artwork is the owner's board-derived `assets/icon-glyph-hd.png`. Run `python3 scripts/make-icons-from-original.py` (Pillow with libimagequant) to generate the 256×256 PNGs (≤10 KB) and seven-size Windows ICOs. `node scripts/make-icons.mjs` and `node scripts/brand-assets.mjs` both delegate to that generator. The five picker editions are retained independently. See `docs/BRAND_ASSETS.md`.
