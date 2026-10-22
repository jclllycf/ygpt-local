# UI polish and icon: summary

## First Light (yuki-warm, 2026-10-22, current)

The owner called the Sky Air restyle plain and asked for the brand to feel
personal: the "y" is the first letter of Yuki's name, and the product exists for
nervous first-time users. First Light keeps Sky Air's blue language, contrast
work and one-primary-per-view rule, and adds a point of view: **the morning
sky, and a person's signature in it.** The full system is in
[`docs/DESIGN_FIRST_LIGHT.md`](docs/DESIGN_FIRST_LIGHT.md) (commits `yuki-warm:`).

**The mark.** A lowercase *y*, signed the way a person writes it — a short
stroke down to the baseline, a long stroke sweeping through into a descender
curling back under the letter, and a small morning sun as the full stop ("y.").
Two optical cuts: pen-pressure-filled outlines at 48 px and up, uniform monoline
at 47 px and below. Tile `#38BDF8 → #0284C7`, ivory `#FFFBF4` strokes, sun
`#FFD9AE → #FDBA74 → #FB9A4B`. Across the product the sun means exactly one
thing: **you** (current setup step; in-chat card while a decision is pending).

| Surface | What changed | Why (product function) |
|---|---|---|
| **Icon** (`assets/icon.svg` → PNGs, `ygpt.ico`, `plugin/assets/logo.png`) | Pen signature replaces the `y/_` glyph; heavier tray cut; `make-icons.mjs` gained stroked/filled `<path>` rasterization with size cuts. `make-mark-pen.mjs` generates the pressure outlines. | One glyph for the product that reads as a person's mark, not a vendor's. Deterministic: two runs byte-identical. |
| **Setup wizard** (`setup/YGPTLocal.cs`) | First Light styling: serif titles, left-aligned content, helper line under every field (what to type, where to find it in Cloudflare/OpenAI), Check step as one row per part (tick / "!" / ring + plain words, refused/timeout/unauthorised told apart), Finish page as a numbered sequence with Copy buttons for name, description, endpoint/tunnel and pairing key. Tray menu in sky palette; tooltip reports running/reconnecting (the restart loop itself is unchanged). | CHATGPT_PROBLEMS.md B8–B17: users couldn't tell what to fill in, Verify showed raw JSON, a rate limit was mistaken for a broken tunnel. |
| **Native approval popup** (`runtime/approval-view.xaml`) | Signature mark + sun beside the title; state chip (sky while it needs you, amber/grey otherwise); purpose moved out of Details into a subtitle; legible type (11/10/9 px → 13/12/15); risk in an amber band; **one language** — buttons and expanders now 允许这一次 / 本对话内允许 / 拒绝, 技术细节 / 最近记录; title "YGPT Local · 确认". All 20 element names approval-panel.ps1 reads are unchanged. | The trust moment must answer "why is this asking me" on the first read, in the user's own language. |
| **In-chat approval card** (`runtime/approval-bar.html`) | Signature y. + First Light tokens (light and dark), sun fades and tile quiets on deny/expire; a 2 px sky-into-sun top edge and a breathing status dot only while a decision is pending (both respect `prefers-reduced-motion`); impact line in ink. Only `<style>` + mark SVG changed; script byte-identical. | The card reads as "needs you" only while it does. |
| **Owner approval page** (`service/oauth.mjs`) | Same page structure, checks, status codes (403, 429), CSP and timing-safe key comparison; failures now read as words — wrong key re-shows the form with "That key didn't match", expired/foreign flow says to start again, rate limit says to wait a minute. New `tests/owner-page.test.mjs` covers these on any OS. | The most direct authorization moment in the flow; it returned raw JSON on failure before. |
| **Native popup CSRF fix** (`runtime/approval-panel.ps1`, `yuki-warm:`) | One line: `'X-Y-CSRF'` → `'X-YGPT-CSRF'`. Pre-existing defect: the local server only accepts `x-ygpt-csrf`, so every native popup decision got 403 and the popup said 已过期或已处理 — the "authorization is broken" confusion in CHATGPT_PROBLEMS.md A. Security behaviour unchanged (same per-process token, Host/Origin checks, loopback-only). | Design work found it; it was fixed rather than left. |
| **README + troubleshooting** | `plugin/README.md` lists the exact ChatGPT form values (name, description, URL, auth), warns against placeholder values and explains the rate-limit message. `docs/TROUBLESHOOTING.md` covers the rate limit, reading Check's "!" rows, "That key didn't match", and the fixed CSRF 403. | The plugin README is where a new user actually pastes these values. |

**Intentional string/ID changes (all listed, per the brief's guardrails).**
Automation IDs are unchanged in the wizard (md5-identical `SetAutomationId` call
set, verified independently) and all XAML `Name`s that `approval-panel.ps1`
reads are unchanged. User-visible copy changes: popup buttons English → Chinese
(above), fact labels 影响/拒绝后 → 目标/会做什么/如果拒绝; wizard tray menu
"Open setup" → "Open YGPT Local setup", tray tooltip "YGPT Local" → running /
reconnecting state, sidebar "1.0.0-rc.2 / Private, local Windows tools" →
"Version X / Runs privately on this PC"; Welcome page copy answering "Do I need
an OpenAI API key?" and "Do I need the .zip?" plus three safety promises.
`tests/ui-csp.test.mjs` dependencies ("Allow once", "Deny", `#note`) untouched;
the owner-page tests were extended in the same commit as its changes.

### First Light verification (this Linux machine, independent of Claude)

| Check | Result |
|---|---|
| `.local/tools/csc5.sh` on `setup/YGPTLocal.cs` (`winexe`, `/win32icon:assets/ygpt.ico`) and `engine/windows/YDesktop.cs` (`exe`) | **Pass, 0 warnings, 0 errors.** |
| `node scripts/csp.mjs` | **Pass.** "Approval CSP hashes match the branded inline bundle." |
| `node scripts/public-audit.mjs` | **Pass, 0 findings.** Evidence file reverted afterwards (its only diffs were timestamp + file count from the new design docs). |
| `node scripts/make-icons.mjs` twice | **Byte-identical** across both runs and against the committed files. |
| `git log` since `362d324` | 9 `yuki-warm:` commits (8 by Claude, 1 by Muse committing Claude's leftover design doc). |
| Spot-check of diffs | The tray supervisor-restart thread predates the design pass — only tooltip text was added. The CSRF header fix and owner-page failure copy were the only behaviour-adjacent changes; both documented in their commit messages and verified consistent with the code. |

Note: Claude's run hit its **session limit** (resets 8am UTC) before writing this
section; it was written by Muse from the commit messages and
`docs/DESIGN_FIRST_LIGHT.md`, and the design doc itself was committed by Muse
after the run. The skill set Claude drew on was not recorded before the limit
hit — the design doc and commits don't name specific skills.

### Still needs the owner on Windows

Same as before, plus the new bits: run through all seven wizard steps (helpers,
Check rows, Finish copy buttons), trigger the native popup
(`runtime/approval-panel.ps1 -ValidateOnly` / `-PreviewImage`), paste a wrong
key on the owner page, and confirm one native Allow/Deny click now records
instead of 403. Refresh `docs/images/setup-welcome.png` via
`node scripts/check-native-gui.mjs`; run `tests/install-native.ps1` and the
full `npm test`.

---

## Sky Air redesign (superseded by First Light above, kept as record)

The owner found the green restyle too plain. Sky Air replaces it with one clear light-blue language on every surface. The rules are in [`docs/DESIGN_SKY_AIR.md`](docs/DESIGN_SKY_AIR.md). As before, this changes styling and layout only. Copy, control names, automation IDs, handlers and step flow are unchanged. Commits are prefixed `sky-air:`.

**One deliberate change from the brief's tokens.** White text on the brief's gradient `#38BDF8 → #0284C7` measures only about 2.9:1 at the button centre, and 2.1:1 at the light end. So anything carrying a white label or glyph uses a deeper "action" gradient, `#0EA5E9 → #0369A1`, which gives about 4:1 under the label. The primary buttons, the current-step badge and the checked box use it. The brighter gradient stays where there is no text: the icon tile, brand mark, radio dot and rail line. Small text on the pale sidebar was darkened to reach about 4:1 or better.

| Surface | What changed | Why (product function) |
|---|---|---|
| **Icon** (`assets/icon.svg` → PNGs, `ygpt.ico`, `plugin/assets/logo.png`) | Sky gradient tile (`#38BDF8 → #0284C7`) with a white `y/_` mark. The cursor is still dropped below 32 px. | One glyph for the product. White on sky reads on light and dark taskbars. Regenerated twice: byte-identical. |
| **Setup wizard** (`setup/YGPTLocal.cs`) | **Rail:** pale-sky gradient sidebar with a hairline edge, a lifted brand tile, and the name and tagline stacked. The steps sit on a *connected* line. Done steps get a filled ✓ badge and a solid sky segment. The current step is a white floating row with a gradient badge and a soft glow, laid over the line. Upcoming steps are outlined, on a pale segment. **Content:** a soft sky glow at the top right; an eyebrow (sky bar + "Step N of 7"); a 30 px bold title; section leads ("Connect ChatGPT to your Windows PC.", "Ready to install", "Finish in ChatGPT") in sky-gradient text; body text 14.5 / 1.6. **Cards:** form fields, consent and the startup toggle on a step collect into one white floating card. The install summary and the ChatGPT steps are cards too. Helper text inside a card is a smaller caption. The 64-bit check is a sky status chip. **Controls:** inputs are 44 px, radius 10, and get a sky border plus an 18 % glow ring on focus. The primary button has the gradient, a sky shadow, a white lift on hover and a deep shade when pressed. The secondary button tints on hover and deepens when pressed. The connection modes are 14 px-radius choice cards. The checkbox is 20 px with a gradient fill when checked. The consent is a sky-tint callout. Focus rings are a double ring (crisp `#0EA5E9` plus a soft halo). The footer has a hairline aligned to the content. Status messages are amber (error) or deep sky (success), never alarm red. | The setup should feel like a calm guided journey: state is carried by shape (✓ / number / outline) as well as colour, and the single gradient on each page is the next action. |
| **Approval popup** (`runtime/approval-view.xaml`) | Pale-sky window. The what / target / impact / if-denied facts sit together on a white card. **Allow once** has the action gradient, **Allow in this chat** is a sky tint, and **Deny** is white with ink text and a clear border at full height. The state label is in sky. Risk text is amber. The focus ring is `#0EA5E9`. | This is the trust moment: the facts read as one unit, the safe choice is obvious, and Deny is unmistakable without being alarming. |
| **Approval card** (`runtime/approval-bar.html`) | New CSS variables for light **and** dark. The `y/_` mark is now white on the sky tile (it goes muted when denied or expired). A 2 px sky edge appears only while the card awaits a decision. Buttons follow the popup's hierarchy. Deny now uses ink, not muted grey. There are hover, pressed, focus (outline + glow) and reduced-motion rules, and risk shows in amber in Details. The style hash was regenerated with `node scripts/csp.mjs`. Only the `<style>` block and its hash changed; the script and its hash are untouched. | The same calm, legible decision in the chat, and it reads as "needs you" only while it does. |

### Sky Air verification (this Linux machine)

| Check | Result |
|---|---|
| `.local/tools/csc5.sh`: Roslyn `-langversion:5 -warn:4` against the net48 reference assemblies, with `/win32icon:assets/ygpt.ico` | **Pass, 0 warnings.** `setup/YGPTLocal.cs` (`winexe`) and `engine/windows/YDesktop.cs` (`exe`). The new 256 px icon is present inside the built exe. |
| String / automation-ID diff of `YGPTLocal.cs` against the pre-task commit `e89aeba` (script compares every string literal as a multiset) | The only non-colour literals that differ are template part names (`Glow`, `Lift`, `Bd`; fewer `Shade` occurrences) and the checkbox tick geometry, which was re-centred for the 20 px box. All 11 `SetAutomationId` calls and all 9 event-handler hookups are identical. **No user-visible string changed.** |
| `approval-view.xaml` | Well-formed. Every `Name` (including the template's `Ring`/`Shade`) and every `Text`/`Content`/`Header`/`Title` value is identical to the original. |
| `node scripts/csp.mjs` | Pass. Run twice, with no change after the first run. `style-src` hash updated, `script-src` unchanged. |
| `tests/ui-csp.test.mjs` logic on Playwright Chromium (the `.local/test/` copy; the tracked test is unchanged) | **2/2 pass**, 0 CSP violations. A fixture render of the light, dark, awaiting and denied states was checked by eye. |
| `node scripts/public-audit.mjs` | Pass, 0 findings. The rewritten evidence file was reverted: its only changes were the timestamp and a count that included the untracked task file. |
| `node --check` on `make-icons.mjs`, `csp.mjs`, `build.mjs`, `compile-installer.mjs`, `package.mjs` | Pass. No tracked `.mjs` was modified. |
| `node scripts/make-icons.mjs` determinism | Pass: two runs gave identical hashes, and a later rerun matched the committed files byte for byte. |

### Still needs the owner on Windows

The WPF and XAML visuals can't be rendered here. The code compiles, but `FrameworkElementFactory` templates, effects and gradients are only fully checked when WPF instantiates them. On Windows:

1. Open `build\YGPTLocal.exe` and go through all seven steps. Check the connected rail, the cards and their shadows, the gradient lead text, the focus halo (use Tab), button hover and pressed states, the consent callout, the connection cards and the show/hide credential toggle.
2. Run `runtime/approval-panel.ps1 -ValidateOnly` and look at the popup once.
3. Run `node scripts/check-native-gui.mjs` to refresh `docs/images/setup-welcome.png`; the committed screenshot still shows the old UI. Also run `tests/install-native.ps1`, `tests/InstallerProbe.cs` and the full `npm test` (the same Windows-only blockers as below apply).
4. Check the new icon in Explorer, on the taskbar and in the tray.

---

## Earlier pass: green polish (colours now superseded by Sky Air; structure notes still apply)

Scope: a custom UI for `YGPTLocal.exe` and a plugin icon. All changes affect styling, layout or icons only. Control names, automation IDs, event handlers, step flow, user-visible copy and security text are unchanged.

This work builds on the earlier WIP commit (`c05c41d`). I reviewed that commit, kept what was sound, fixed what was not, and finished the remaining work (mainly the setup wizard restyle).

## Brand mark and icon set

**Concept.** The mark reads as `y/_`. It is a geometric "y" whose long stroke is a forward slash, followed by a terminal-prompt cursor. This keeps the original "Y /" idea and adds the local terminal cue. The mint mark (`#7BDDB0`) sits on a rounded-square tile with a deep-green gradient (`#18755B` to `#0E3B2C`). Both colors come from the existing palette.

**Small sizes.** The cursor has `data-min-size="32"`, so it is left out of the 16 px and 24 px rasters. At those sizes the "y" stays clear and bold.

| File | What it is |
|---|---|
| `assets/icon.svg` | Master vector source. **Fixed from the WIP:** added `gradientUnits="userSpaceOnUse"`. Without it, browsers and design tools would read the gradient coordinates as bounding-box fractions and draw an almost flat tile, which did not match the generated rasters. |
| `scripts/make-icons.mjs` | Dependency-free generator (Node built-ins plus `zlib`). It rasterizes the SVG subset the mark uses (rounded rect, polygon, linear gradient) with 8×8 supersampling. It writes the PNG sizes, the multi-resolution ICO and the plugin logo. Output is deterministic: running it again reproduced the committed PNG and ICO files byte for byte. Run from the repo root: `node scripts/make-icons.mjs`. |
| `assets/png/icon-{16,24,32,48,64,128,256}.png` | Raster sizes. |
| `assets/ygpt.ico` | 7 images. 16–128 px are 32-bit BGRA DIB entries, which every Win32 and System.Drawing consumer can read. 256 px is a PNG entry. |
| `plugin/assets/logo.png` | Plugin logo. **Changed:** now rendered at 512 px instead of a copy of the 256 px PNG, so it stays sharp on high-DPI displays. |

### Where the icon is wired in

- **`scripts/build.mjs` (from the WIP, kept):** `/win32icon:assets/ygpt.ico` is in the shared `base` args. Both `YDesktop.exe` and `YGPTLocal.exe` get the icon.
- **`scripts/compile-installer.mjs` and `scripts/package.mjs` (from the WIP, kept):** the same `/win32icon:` is passed when compiling the setup exe. The shipped `YGPTLocal-Setup-*.exe` therefore has the icon too.
- **WPF window icon:** I did not set `Window.Icon` on purpose. When `Window.Icon` is null, WPF loads the icon embedded in the running exe (via `ExtractIconEx`), using the 16 px image for the title bar and the larger ones for the taskbar. Setting the icon explicitly would need an extra resource or a downscaled bitmap and would look worse. The generic icon in the old screenshot came only from the exe having no icon.
- **Tray icon (`YGPTApp.Background`):** changed from `SystemIcons.Application` to the exe's own icon (`Icon.ExtractAssociatedIcon`). If extraction fails it falls back to the old generic icon.
- **`.gitattributes`:** added `*.ico binary` so the ICO is never treated as text.

### Plugin icon: no icon field exists

The plugin has no icon or logo field. `plugin/` contains only `skills/local-work/SKILL.md`. It has no manifest, and `scripts/package.mjs` does not bundle the plugin at all. The plugin is created by hand in ChatGPT as a custom MCP server.

So the logo goes in the conventional location, `plugin/assets/logo.png`, and the new `plugin/README.md` points to it. The README explains that you can upload it in the ChatGPT plugin settings if they let you choose an icon, and that it is generated from the SVG.

## Setup wizard: `setup/YGPTLocal.cs`

This is a restyle only. Every control, automation ID (`folder`, `next`, `back`, `consent`, `mode-*`, `setup-message`, …), handler, validation and string is unchanged.

A script compared every string literal and automation ID between the old and new files. The only literals removed were the old text mark `"Y /"`, the step-prefix strings `"✓  "`/`"  "`, the font name `"Segoe UI"` (now `"Segoe UI, Microsoft YaHei UI"`) and three old hex colors. One string was added: the eyebrow `"Step N of 7"`.

The templates are built in C# with `FrameworkElementFactory`, not with runtime-parsed XAML. That way the compiler checks every property and type, and the code matches the file's existing code-only WPF style. Nothing new is referenced.

**Fixes for the visible flaws in the screenshot:**

- **Text boxes and password boxes** (`StyleInput`): 40 px tall, white, 6 px corner radius, `#C5D4CC` border. The border darkens on hover, and keyboard focus shows a 2 px `#18755B` ring. Text is vertically centered with 10 px side padding, and selections are green.
- **"Browse folder"** is now a secondary button styled like Back. It sits in the same row as the folder box, at the same height, instead of being a grey stock button underneath.
- **Consent checkbox:** the old misalignment came from `MaxWidth=620` with stretch alignment, which centered the control. It is now a full-width mint callout. A custom 18 px checkbox is aligned to the first line of the wrapped text. The tunnel-creation consent uses the same callout style. "Start when I sign in" and "Show / hide" are plain, left-aligned checkboxes.
- **Buttons** (`StyleButton`): Next is a green primary button and Back is a white secondary one. Both have an 8 px radius, SemiBold text, and hover and pressed states (a dark overlay). Disabled buttons drop to 45 % opacity, and keyboard-only focus shows a green ring via `FocusVisualStyle`, so it does not appear after mouse clicks. Action buttons on the Verify and Connect steps use the secondary style, slightly smaller, and consecutive ones wrap together in a row (`WrapPanel`) instead of stacking in one long column.
- **Connection choices:** the radio buttons are now selectable cards. The selected card has a green border, a mint background and a filled dot.
- **Sidebar:** the text "Y /" is replaced by the vector brand mark, drawn in WPF from the same coordinates as `assets/icon.svg`, next to "YGPT Local". The sidebar has a deep-green vertical gradient. Each step has a numbered badge: mint ✓ when done, white when current, outlined when upcoming. The current step has a soft highlight. The version note is pinned to the bottom of the sidebar.
- **Spacing and type scale:** an eyebrow (12), step title (28), section headings (20/16), body text (14, line height 1.5, muted ink `#3A5248`), field labels (13 SemiBold) and status messages (13). Fields are spaced 18 px apart. The footer has a divider line. The step-4 install summary and the step-6 ChatGPT instructions appear in white cards.
- **Fonts:** Segoe UI with Microsoft YaHei UI as fallback, so Chinese paths render cleanly.

## Approval surfaces

- **`runtime/approval-view.xaml`:** the WIP recolor is kept. The background is `#F6F8F7` and text uses the wizard's ink color. "Allow once" is a solid green primary button, "Allow in this chat" a mint secondary, and "Deny" white. Labels and expanders are green-grey. The button template gained hover and pressed overlays and a green keyboard-focus ring.
  - **Added:** `FocusVisualStyle={x:Null}` on the button style, so the stock dotted focus rectangle no longer appears on top of the green ring.
  - Every `Name` read by `approval-panel.ps1` and all copy are unchanged (checked by script). The only new names are the template-scoped `Ring` and `Shade`.
- **`runtime/approval-bar.html`:** the WIP change is kept. The generic shield icon in the `.mark` slot is replaced by the `y/_` mark as inline SVG (`fill="currentColor"`, so light, dark and denied states still recolor it). Only body markup changed, and the inline `<style>` and `<script>` are untouched. `node scripts/csp.mjs` confirmed the existing CSP hashes still match, and the file was unchanged afterwards.

## Verification on this Linux machine

| Check | Result |
|---|---|
| **Real C# compile:** Roslyn csc at `-langversion:5` (the C# 5 level of .NET Framework's legacy `csc.exe`), with `-warn:4`, against the official .NET Framework 4.8 reference assemblies (NuGet `Microsoft.NETFramework.ReferenceAssemblies.net48`, including WPF), using the same reference set as `build.mjs`. Tooling is in the gitignored `.local/`, and the helper is `.local/tools/csc5.sh`. | **Pass.** `setup/YGPTLocal.cs` compiles as `/target:winexe` with no warnings or errors. `engine/windows/YDesktop.cs` compiles as `/target:exe`. Both use `/win32icon:assets/ygpt.ico`, which also shows csc accepts the ICO. The 256 px icon is present inside the output exe. |
| `node --check` on `build.mjs`, `compile-installer.mjs`, `package.mjs`, `make-icons.mjs`, `csp.mjs` | Pass |
| `node scripts/make-icons.mjs` | Pass. Output is deterministic, and the ICO decodes with all 7 sizes. |
| `node scripts/csp.mjs` | Pass. Hashes already matched, no diff. |
| `node scripts/public-audit.mjs` | Pass: 0 findings. The rewritten `evidence/public-source-audit.json` timestamp was reverted to keep the diff small. |
| XAML well-formedness, element names and copy compared with the original | Pass |
| `tests/ui-csp.test.mjs` logic, run on Playwright's bundled Chromium instead of `msedge` (temporary copy in `.local/test/`; the tracked test is unchanged) | **2/2 pass.** No CSP violations, the decision flow works, and light and dark screenshots of the card with the new mark were checked by eye. |
| `npm test` (after `npm ci --ignore-scripts`) | **0/9 pass.** Exactly the same failures as the unmodified WIP commit. All are Windows-only causes: 6 need Windows drive paths ("Expected absolute local drive path"), 1 needs the bundled `build/runtimes/python/python.exe` (DPAPI), and 2 need Microsoft Edge (`channel: 'msedge'`). None relate to these changes. |

## Still needs a Windows machine

1. Run `npm run build` with the real .NET Framework `csc.exe`. Roslyn at C# 5 should match it, but the legacy compiler has the final say.
2. **Runtime check of the WPF templates.** They compile, but `FrameworkElementFactory` templates are only fully validated when WPF instantiates them. Open `build\YGPTLocal.exe` and step through all seven pages. Check:
   - hover, pressed and focus states, including Tab-key focus rings
   - the consent callout and checkbox alignment
   - the connection cards
   - the Browse folder row
   - the show/hide credential toggle (PasswordBox template)
   - window, taskbar and tray icons
3. `node scripts/check-native-gui.mjs` to repeat the UIA brand and consent-gate check and refresh `docs/images/setup-welcome.png`. The committed screenshot still shows the old UI.
4. `tests/install-native.ps1` and `tests/InstallerProbe.cs`, which drive the wizard through UI Automation. The automation IDs, control types and button names they use are unchanged, but this should still be confirmed by running them.
5. `runtime/approval-panel.ps1 -ValidateOnly` to load the recolored XAML, plus one visual check of the popup.
6. The full `npm test` and `npm run package`. Then check the setup exe's icon in Explorer and on the Apps & Features entry.

## Local-only tooling (not tracked)

These are gitignored and can be deleted with `rm -rf .local/dotnet .local/refs .local/pw .local/test node_modules`:

- `.local/dotnet` (.NET 8 SDK, used only for Roslyn)
- `.local/refs` (net48 reference assemblies)
- `.local/pw` (Playwright Chromium)
- `.local/test`
- `node_modules`
