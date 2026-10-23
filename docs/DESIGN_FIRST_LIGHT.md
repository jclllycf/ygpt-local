# First Light: the YGPT Local design system

> Historical design record. The current owner-board artwork, regeneration recipe and icon surfaces are documented in [BRAND_ASSETS.md](BRAND_ASSETS.md). Retired SVG sources mentioned below are no longer shipped.

YGPT Local connects a person's own ChatGPT to their own Windows PC. Most people meeting it are doing that for the first time, and many are not technical. The design has three jobs: make them feel **welcomed**, keep them **oriented**, and let them feel **safe** handing an AI the keys to their computer. It should also look like a product a design studio shipped.

First Light succeeds [Sky Air](DESIGN_SKY_AIR.md). It keeps Sky Air's clear-blue palette and its accessibility work. It adds a point of view: **the morning sky, and something growing toward it.**

- **Sky** is the product: open, clear and calm. It is light blue and sky blue, as the brief asks.
- **The sprout Y** is the owner. *Y* is the first letter of Yuki's name, drawn as a seedling opening its arms, so the product feels like it comes from a person and not from a vendor.
- **The sun** rises above the sprout. Across the product it means one thing: **you**. It marks where you are in setup, and it warms the in-chat card while that card needs your decision. It is the only warm colour on any screen. That restraint is what keeps it sophisticated rather than cute.

## Principles

Each principle comes from a product function or from a real problem in `CHATGPT_PROBLEMS.md`.

| Principle | Why (function / problem) | In the UI |
|---|---|---|
| **Say what to type and where to find it** | Users could not tell how to fill each step (B8). Values were typed by hand (B12). | Every field has a helper line under it: what it is, an example, and where it lives in Cloudflare or OpenAI. Every value ChatGPT asks for has a Copy button. |
| **Every state in words and shape** | Verify showed raw JSON and "reconnecting" without reasons (B16, B17). | Check rows read tick, "!", dashed ring (waiting) or ring (not used), with a plain sentence beside each. Rail steps are tick, sun or outline. Colour is never the only signal. |
| **When it's not working, say what to try** | "Automatic detection" was requested (B11), and a rate limit was mistaken for a broken tunnel (B15). | Each failing row lists likely causes in order. Formats are checked on the page where they are typed, so a typo or a pasted `/mcp` is caught before install. The rate limit is named and explained. |
| **One primary action. Back and Deny are always full size** | Approval for high-risk actions | One gradient element per view: the next action. Deny and Back are never smaller, hidden or disabled while a choice is open. |
| **Calm, not alarming** | Trust-building setup and approval | No red. Risk is a sentence in amber ink. Blue means information and go. |
| **Honest about what we know** | Local checks cannot prove a ChatGPT identity. | "An authenticated remote client has called a tool … This check can't prove who the caller was." Local only is shown as "Not used", never as a failure or a success. |
| **The sun means you** | Orientation and warmth | Current step on the rail, and the card's top edge while it awaits a decision. Nowhere else. |

## The mark

**Story.** Cursor, then open arms, then sunrise. A pointer opens into a *Y*: two leaf-shaped arms reaching up like a sprout, and a warm sun rising above the fork where they divide. It says that you start something here, it grows, and the day gets brighter. The mark sits on a clean white tile with a soft sky corner.

**Construction** (`assets/icon.svg`, 256 grid, tile 8 to 248, rx 60, 1-unit `#D5E6F2` edge):

| Cut | Used at | Drawing |
|---|---|---|
| Large | 32 px and up (taskbar, Explorer, plugin logo 512, wizard rail, owner page) | Left leaf: tip up at (50, 84), belly to the outside, running down into a rounded stem end at (122, 212). Right leaf: narrower, tip flicked up at (210, 78), base buried in the stem at (128, 192). Each leaf is two cubics. Sun: r 20 at (128, 64). |
| Small | 31 px and below (tray 16, title bar 24, in-chat card, native popup) | Thinner arms and a deeper notch, so the fork stays open at 16 px. The leaf gradient is darker, and the sun is r 28 with more air around it, so it stays a separate dot. |

The small cut carries `display="none"`, so browsers and design tools show the large drawing. `make-icons.mjs` ignores `display` and picks a cut with `data-min-size` and `data-max-size`.

**Colour.** Tile `#FFFFFF → #EFF8FE`. Each leaf runs light sky at the tip to deep sky at the stem: `#7DD3FC → #38BDF8 → #0284C7` (small cut `#38BDF8 → #0369A1`). The sun is the First Light sun, `#FFD9AE → #FDBA74 → #FB9A4B`, with its highlight up and to the left.

**Regenerate.** `node scripts/make-icons.mjs` writes PNG 16 to 256, `assets/ygpt.ico` and `plugin/assets/logo.png` (512). It is deterministic: two runs give byte-identical files.

**UI marks.** The UI draws the mark as vectors in tile space 240 (icon space minus 8). The wizard rail (42 px) and the owner approval page (40 px) use the large cut. The native popup (28 px) and the in-chat card (26 px) use the small cut. Large leaves are `M42,76 C80,80 122,108 123,154 C123,174 121,188 118,198 C116,204 112,204 111,198 C104,160 62,128 42,76 Z` and `M202,70 C196,112 158,152 120,184 C118,140 148,86 202,70 Z`, with the sun at (120, 56) r 20. Small leaves are `M36,86 C76,88 112,116 118,156 C120,174 120,192 118,206 C116,214 108,214 106,206 C100,168 58,142 36,86 Z` and `M204,78 C198,120 162,158 118,190 C122,152 152,96 204,78 Z`, with the sun at (120, 56) r 28. When an approval is denied or expired, the card's tile goes quiet, the leaves go muted and the sun fades: the request has closed.

**Don't** recolour the leaves per state, put the mark on a coloured tile, separate the sun from the fork, add a second sun, or use the sun's orange anywhere that isn't "you".

## Tokens

### Colour

All text colours are 4.5:1 or better on the surface they sit on. Ratios are measured with the WCAG formula.

| Token | Light | Dark (card only) | Use | Contrast |
|---|---|---|---|---|
| `canvas` | `#F7FBFE` | n/a (the card's page is transparent) | Window and page background | |
| `rail` | `#F1F8FD → #E4F1FA` | n/a | Setup rail | |
| `card` | `#FFFFFF`, 1 px `#E3EEF6`, radius 14 | `#0F2133`, `#1E3A55` | Content cards | |
| `ink` | `#0F2A44` | `#E6F1FA` | Titles, values | 14.6:1 on white |
| `body` | `#4A5F74` | `#9DB4C8` | Paragraphs | 6.6:1 |
| `help` | `#5B6F84` | `#9DB4C8` | Helper lines, labels, captions | 5.2:1 on white, 5.0:1 on canvas |
| `rail-ink` / `rail-muted` / `rail-note` | `#33506A` / `#56708A` / `#4A6880` | n/a | Rail text: done, upcoming, version | 7.5 / 4.5 / 5.1:1 on rail |
| `sky` | `#38BDF8 → #0284C7` | same | Mark leaves, radio dot, rail line. Never under text. | |
| `action` | `#0284C7 → #075985` | same | Anything with a white label or glyph: primary buttons, checked box | About 5.5:1 under the label |
| `sky-ink` | `#0369A1` | `#7DD3FC` | Secondary button text, links | 5.9:1 |
| `calm` | `#075985` | `#BAE6FD` | Success and progress messages, chips | |
| `tint` | `#E0F2FE` / `#EFF8FE`, line `#BAE6FD` / `#CFE6F6` | `#0F3550`, `#1D5A80` | Consent, selected choice, secondary-tint button | |
| `sun` | `#FFD9AE → #FDBA74 → #FB9A4B`, ink `#6B3410` | same | "You": the current step and the awaiting edge | Ink on sun 5.9:1 |
| `attention` | `#A35A0B` on `#FFF7EA`, line `#F5DDB8` | `#F5C27A` (text only) | Errors, "!" rows, the risk sentence | 4.9:1 |
| `focus` | `#0EA5E9` ring plus `rgba(56,189,248,.18)` halo | same | Keyboard focus only | |
| `shadow` | `rgba(2,132,199,.07)` card, `.10` lifted, `.30` primary | `rgba(0,0,0,.35)` | Elevation, one per element | |

### Type

| Role | Face | Size / line | Notes |
|---|---|---|---|
| Page title | **Sitka Heading**, then Georgia | 31 / 38, Regular, `ink` | The warm, refined voice of the wizard and the owner approval page. Sitka is Matthew Carter's screen serif; Georgia is the universal fallback. `TextFormattingMode=Ideal` at this size. |
| Lead | Segoe UI | 15 / 24, `body`, max 600 px | One per page, under about 85 characters per line. |
| Body / notes | Segoe UI | 13.5 / 21, `body` | |
| Label | Segoe UI SemiBold | 13, `#1E3A52` | Above each field. |
| Helper | Segoe UI | 12.5 / 19, `help` | Under each field. |
| Step heading (sequence, check rows) | Segoe UI SemiBold | 14.5 / 13.5 | |
| Button | Segoe UI SemiBold | 14 (footer), 13 (actions) | |
| Popup | Microsoft YaHei UI, then Segoe UI | Title 15, values 13, labels 12, notes 11.5 | The popup's content is Chinese, so YaHei leads. |
| Paths and code | Cascadia Mono, then Consolas | 11.5 | Only for paths and technical detail. |

Microsoft YaHei UI is the CJK fallback everywhere, so Chinese paths render cleanly.

### Shape, space, elevation

- Radius: inputs and buttons 10 (popup 9), cards 14, choice cards 14, rail current row 12, chips 6 to 10, mark tile 25 % of size.
- Rhythm on a 4-pt grid: field label to input 7, input to helper 7, helper to next label 20; card padding 26 / 24; page padding 48 / 40; footer 18 above the buttons.
- Elevation: one soft sky shadow per card, on its own childless layer so text keeps ClearType. Never stack shadows.

### States

| Element | States |
|---|---|
| Rail step | **Done:** `#0284C7` disc with a white tick, `rail-ink` label. **Current:** sun disc with a warm glow, number in sun ink, SemiBold `ink` label, on a white floating row. **Upcoming:** white disc with a `#BFDDF2` outline, number and label in `rail-muted`. Segments are `sky` when walked, `#CFE6F5` ahead. The accessible name of the label adds ", done" or ", current step". |
| Check row | **ok:** filled sky disc with a tick. **attention:** amber "!" on cream. **wait:** dashed ring. **off:** plain ring. Each row's accessible name speaks its state. |
| Primary button | Hover: white lift at 12 %. Pressed: deep shade `#0C4A6E` at 18 %. Disabled: 45 %, no glow. |
| Secondary button | Hover: `#F0F9FF` with border `#7DD3FC`. Pressed: `#E0F2FE`. Disabled: 45 %. |
| Input | Hover: border `#A5D8F5`. Focus: border `#0EA5E9`, white fill and a 4 px halo. Disabled: `#F1F6FA`. |
| Choice card | Hover: `#F8FCFF` with border `#A5D8F5`. Selected: `#F0F8FE` with border `#38BDF8` and a sky dot. |
| Focus (all) | Keyboard only: a crisp `#0EA5E9` ring plus a soft halo outside the control. Never a dotted rectangle. |

### Motion

Almost none. The wizard and popup have no animation at all: they are tools, and stillness reads as trust. The in-chat card has one motion: the status dot breathes slowly (2.4 s) while a decision is pending, because that is the moment it needs to be noticed. Transitions are limited to 150 ms colour changes on buttons, and everything stops under `prefers-reduced-motion`.

## Voice

Plain, warm and exact. Second person, sentence case, short sentences. Name things the way the user sees them: "Working folder for ChatGPT", not "project root". Say "This PC", not "the host". Say what a button does ("Copy", "Run connection checks") and keep the name through the flow.

- **Explain, then reassure, in that order.** "It's used once to create the tunnel and isn't kept afterwards."
- **Failures give direction, not mood.** "Not running on port 17854." then "Click Start service, wait about 10 seconds, then run the checks again."
- **Never claim more than we know.** "This check can't prove who the caller was."
- **One language per surface.** The wizard, card and owner page are English. The native popup is Chinese because its dynamic content is.

## Surfaces

### Setup wizard (`setup/YGPTLocal.cs`)

**Anatomy.** A rail (268 px) and a page. The rail holds the mark, the name and the tagline, then the seven steps on one connected line with the sun at the current step, then the version. The page has a serif title, one lead sentence, the content, then a footer with "Step N of 7" on the left and Back and Next on the right. The content column is left-aligned with a maximum of 700 px; text is capped at 600 px.

| Step (rail label) | Title | What the page does |
|---|---|---|
| Welcome | Connect ChatGPT to this PC | Three promises (Edits you can undo, You approve risky work, Keys stay on this PC). Application and working folders with helpers. Consent callout. Two answers: "Do I need an OpenAI API key?" and "Do I need the .zip download as well?" |
| This PC | Check this PC | 64-bit status chip, port with helper, start-at-sign-in with an explanation of tray and auto-reconnect, local-only reassurance, other tunnel clients (shown only if any are running). |
| Connection | Choose how ChatGPT reaches this PC | Four choice cards, each with what it needs. Secure MCP Tunnel carries "Recommended if available". Fields for the chosen mode, format-checked on Next. |
| Keys | Add your keys / No keys needed | The key for this mode only, a "Show" toggle beside it and where to find it. A DPAPI note. The owner pairing key is explained for HTTPS modes. |
| Install | Ready to install | A summary card (Application, Your data, Working folder, Connection, Start at sign-in). "Nothing changes until you click Install & configure." |
| Check | Check the connection | A status board (headline, time, Run connection checks) with one row per part, then Service / Keys / Help action groups. |
| Connect ChatGPT | Finish in ChatGPT | A numbered sequence: open Plugins; fill the form from a values card with Copy buttons (Name, Description, URL or Tunnel, Authentication with the pairing key); review and create (explains rate limiting); try it, then check for ChatGPT's call. |

### Native approval popup (`runtime/approval-view.xaml`)

The popup reads top to bottom: the mark, the title and a state chip; the purpose as a subtitle (why this is asking); then a facts card (来源, 目标, 会做什么, 如果拒绝). The risk sentence follows in an amber band, shown only when the panel shows risk. 技术细节 holds permissions, the command, the expiry and history. Last come the actions: **允许这一次** (primary gradient), **本对话内允许** (tint) and **拒绝** (white, full height, at least 84 wide), then the note. The state chip follows the words the panel writes: sky while the request needs you, amber for failed or unverified, grey for denied or expired.

### In-chat approval card (`runtime/approval-bar.html`)

The same hierarchy in English, light and dark from CSS variables. The sprout Y sits on its white tile. While awaiting, the 2 px top edge runs sky into sun and the status dot breathes. When denied or expired, the tile goes quiet, the leaves go muted and the sun fades. The inline style is CSP-hashed: after any edit, run `node scripts/csp.mjs`. The script is never touched for design work.

### Owner approval page (`service/oauth.mjs`)

This is the browser page where people paste the owner pairing key. It is one card: the mark, a serif title, a plain explanation of what approving allows, the key field with a hint saying exactly where the key is, the primary **Approve this connection**, and a foot note ("Only approve a connection you started…"). Its failure states are written in words: a wrong key shows the form again with the same flow; an expired or foreign request says to start again from ChatGPT; a rate limit says to wait a minute. There is no script; the page's own CSP is unchanged.

### Tray and exe

The exe and tray use `assets/ygpt.ico`. The tray asks the exe for its small icon, so it shows the 16 px small cut, not the 32 px drawing shrunk down. The tray menu uses the sky palette (white, hover `#E0F2FE`). "Open YGPT Local setup" is bold, as the default action. The tooltip states the service honestly: "YGPT Local is running" or "YGPT Local is reconnecting". The icon is never recoloured per state; state belongs in words.

### Host-owned UI (conclusion for CHATGPT_PROBLEMS.md #19)

ChatGPT's `Opened …` header and `CSP off` badge are drawn by ChatGPT around the card. They are not ours to style or hide, and no plugin can restyle them. What we control, and have designed, is the card inside: its mark, type, colours, states and strict CSP metadata. Never disable CSP or authentication to make a badge go away.

## Do / Don't

- **Do** put white text only on `action`, never on `sky`. White on `#38BDF8` is 2.1:1.
- **Do** keep the sun for "you", once per view.
- **Do** give every input a helper line and every external value a Copy button.
- **Do** keep Back and Deny full size and enabled while a choice is open.
- **Do** keep templates in the popup to patterns WPF ships with. A XAML error there blocks approvals.
- **Don't** use red, flashing or shaking for risk. Use a calm sentence in amber.
- **Don't** add gradient text, decorative washes or a second accent colour. The only atmospheric touch is the faint first-light glow in the corner of the wizard page and the owner page.
- **Don't** add fonts, images or external resources to the card. Its CSP forbids them (`img-src 'none'`).
- **Don't** change an automation ID, a control `Name` read by `approval-panel.ps1`, or a string a test reads without updating the dependent test in the same commit.
