# Sky Air: YGPT Local design system

> Historical design record. The current owner-board artwork, regeneration recipe and icon surfaces are documented in [BRAND_ASSETS.md](BRAND_ASSETS.md). Retired SVG sources mentioned below are no longer shipped.

> **Superseded by [First Light](DESIGN_FIRST_LIGHT.md) (yuki-warm, 2026-10-22).** This page is kept as the record of the previous round. First Light keeps Sky Air's blue language, its contrast rules and its one-primary-per-view rule. It replaces the `y/_` glyph with the signature y. and its sun, and deepens the action gradient to `#0284C7 → #075985`. It also adds serif page titles, helper lines under every field, a readable Check step, and the sun as the single warm "you are here" accent. Where the two disagree, First Light wins.

YGPT Local gives ChatGPT hands on your own PC. The interface should therefore feel like **open air and quiet trust**. It should be light, clear and unhurried, and it should be exact about what will happen. Sky Air is one blue colour language used on every surface: the setup wizard, the native approval popup, the in-chat approval card and the icon.

## Principles (each tied to a product function)

| Principle | Product function it serves | What it means in the UI |
|---|---|---|
| **Clarity before action** | Scoped approval for high-risk actions | What, where and impact always come first, as plain text. Chrome stays quiet so the facts are the loudest thing. |
| **The safe path is the obvious path** | Approval, consent gates | One primary (gradient) action per surface. Deny and Back are always visible, full-size and never disabled while a choice is open. |
| **Progress you can feel** | 7-step guided setup | A connected rail shows done, current and upcoming steps. Each step has a badge that states its own state (✓, number, outline). |
| **Calm, never alarming** | Trust-building setup and approval | No red chrome. Risk is stated in words in a warm amber ink, not shouted with colour. Blue means "information" and "go". |
| **Recoverable feels light** | Protected snapshots | Generous white space and soft elevation. Nothing looks heavy or irreversible unless it is. |
| **One glyph, one product** | Brand / tray | The `y/_` mark (Y + slash + prompt cursor) appears the same way everywhere: white mark on a sky tile, or `currentColor` on a tint. |

## Tokens

### Colour

| Token | Light | Dark (card only) | Use |
|---|---|---|---|
| `sky` | `#38BDF8 → #0284C7` (135°) | same | Icon tile, brand mark, radio dot, done line on the rail. No text on it. |
| `sky-action` | `#0EA5E9 → #0369A1` (135°) | `#0EA5E9 → #0369A1` | Anything with a white label or glyph: primary button, current-step badge, checked box. White text is about 4:1 under the label, versus about 2.9:1 on `sky`. |
| `sky-ink` | `#0369A1` | `#7DD3FC` | Links, secondary button text, eyebrow |
| `sky-deep` | `#075985` / `#0C4A6E` | `#BAE6FD` | Consent text, strong accents |
| `ink` | `#0B2440` | `#E6F1FA` | Titles, values |
| `body` | `#55708A` | `#9DB4C8` | Paragraphs |
| `muted` | `#7FA3BC` | `#7C93A8` | Captions, labels, sidebar footer |
| `app-bg` | `#FBFDFF` | `#0D1B2A` | Window / card background |
| `sidebar` | `#F2FAFF → #E3F3FE → #D6EEFC` (vertical) | n/a | Setup rail |
| `card` | `#FFFFFF`, 1 px `#E4F1FA` | `#13263A`, 1 px `#1E3A55` | Content cards |
| `field` | `#FCFEFF`, 1.5 px `#D7E9F5` | `#0F2133`, `#24425E` | Inputs |
| `tint` | `#E0F2FE` bg, `#BAE6FD` border | `#0F3550`, `#1D5A80` | Consent, info, selected choice |
| `focus` | `#0EA5E9` border + `rgba(56,189,248,.18)` 4 px ring | same | Keyboard focus |
| `risk` | `#9A5B13` ink on `#FFF8EB` | `#F5C27A` on `#2E2312` | Risk sentence only |
| `shadow` | `rgba(2,132,199,.08)` card, `.13` lifted, `.35` primary | `rgba(0,0,0,.35)` | Elevation |

### Type
Segoe UI, with Microsoft YaHei UI as the fallback (Consolas / Cascadia Code for paths and code).

| Role | Size / weight | Notes |
|---|---|---|
| Eyebrow | 12, Bold, letter-spaced (WPF: spaced caps text is not possible without changing copy, so use SemiBold, `sky-ink`, plus a 24×2 sky bar) | "Step N of 7" |
| Title | 30, Bold, `ink` | One per step |
| Section | 18 / 15, SemiBold | Card headers |
| Body | 14.5, line height 1.6, `body` | |
| Label | 13, SemiBold, `#1D4258` | Field labels |
| Caption | 12–13, `muted` | Footers, notes |

### Shape and space
- Radius: inputs and buttons 10, cards 16, badges round, step rows 12, chips 8.
- Spacing on a 4-pt grid: field gap 18, card padding 24×26, content padding 48/56, footer padding-top 20.
- Elevation: one soft shadow per card (`blur 24–34, y 10–14`). Never stack shadows.

### States (all interactive controls)
| State | Rule |
|---|---|
| Hover | Primary: lighter overlay (white 10 %). Secondary: `tint` background, border `#BAE6FD`. |
| Pressed | Primary: deep overlay (`#0C4A6E` 18 %). Secondary: `#D6EEFC`. |
| Focus (keyboard only) | `focus` ring, 2–4 px, outside the control. No dotted rectangles. |
| Disabled | 45 % opacity, no shadow. |
| Selected (choice cards, checkboxes) | `tint` fill, `#38BDF8` border, filled sky glyph. |

## Per-surface rules

### Setup wizard (`setup/YGPTLocal.cs`)
- **Rail.** A pale-sky gradient sidebar holds the brand tile (white `y/_` on the sky gradient), the name and a tagline-free version note. Steps sit on one vertical connector line. Done steps show a sky-filled ✓ badge and a solid sky line. The current step is a white floating row with a gradient badge. Upcoming steps show an outlined badge. State is carried by shape as well as colour, so it reads without colour.
- **Content.** Eyebrow, then title, then body, with content in white cards where the code builds a grouped section (install summary, ChatGPT instructions). Fields use `field` with the focus glow.
- **Consent.** A `tint` callout with a 20 px sky checkbox aligned to the first line. It never uses warning colours: consent is informed, not scary.
- **Choices.** Connection modes are selectable cards. The selected card gets `tint` + sky border + filled dot.
- **Footer.** A hairline divider, Back (secondary) on the left of Next (gradient primary, with an elevation shadow). The primary button is the only gradient on the page.

### Approval popup (`runtime/approval-view.xaml`)
- Reads top to bottom: title, then what/target/impact/if-denied rows, then the action row. Labels are `muted`, values are `ink`.
- **Allow once** is the gradient primary. **Allow in this chat** is a `tint` secondary. **Deny** is white with an `ink` label and a clear border, the same height as the others, and never smaller than 70 px.
- Risk text uses `risk` ink only. The background stays `app-bg`.

### Approval card (`runtime/approval-bar.html`)
- Same order and button hierarchy as the popup. Light and dark both come from CSS variables only.
- The mark is `y/_` on a `tint` chip (`currentColor`). In the denied state it drops to `muted`.
- Status dot: sky while awaiting, green-free (sky-deep) when completed, muted when denied or expired. State words carry the meaning.
- The inline style is hashed by CSP. After any style edit, run `node scripts/csp.mjs`.

### Icon, tray and taskbar
- Master: `assets/icon.svg`. A rounded tile (rx 56/256) with a 135° sky gradient and a WHITE `y/_` mark. The cursor is dropped below 32 px.
- Regenerate with `node scripts/make-icons.mjs`. Output is deterministic (run it twice and compare).
- The tray uses the exe's own icon. Do not recolour it per state; state belongs in the tooltip and menu.

## Do / Don't
- **Do** put white labels only on `sky-action`, never on the brighter `sky` (white on `#38BDF8` is 2.1:1).
- **Do** keep one gradient element per view: the primary action (or the current step on the rail).
- **Do** show state with text and shape as well as colour.
- **Do** keep Deny and Back visually equal in size to the primary.
- **Don't** use red or flashing colour for approvals. Calm text explains risk better.
- **Don't** add a gradient text headline in WPF if it costs a copy change. Copy and automation IDs are frozen.
- **Don't** introduce new fonts, images or external resources. The card's CSP forbids them (`img-src 'none'`).
- **Don't** put blur effects (`DropShadowEffect`) on text or on many elements. Use them only on cards and the primary button, so rendering stays cheap.
