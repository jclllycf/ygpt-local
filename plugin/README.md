# YGPT Local personal plugin

- Skill instructions: `skills/local-work/SKILL.md`
- Logo: `assets/logo.png` (512×512 PNG, transparent corners): the sprout Y with its rising sun, on a white tile

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

The logo is generated from `assets/icon.svg` by `node scripts/make-icons.mjs`, which also writes the Windows icon `assets/ygpt.ico` and `assets/png/icon-*.png`. The mark has two optical cuts: the full leaf drawing at 32 px and above, and thinner arms with a deeper notch and a larger sun at 31 px and below. Do not edit the PNGs by hand. Change the SVG and run the script again. See `docs/DESIGN_FIRST_LIGHT.md`.
