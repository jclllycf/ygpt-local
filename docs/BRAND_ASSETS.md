# Current brand artwork

The source is the owner's sprout-Y and sunrise brand board. The extracted
`assets/icon-glyph.png` and its HD master `assets/icon-glyph-hd.png` preserve
that artwork. Earlier hand-drawn SVG interpretations have been retired.

| Surface | Artwork |
| --- | --- |
| English/Chinese GitHub README headers | `assets/brand/plugin-icon-256.png` |
| Current approval strip, default/fallback | Same PNG, inlined by `runtime/inline-approval.mjs` |
| Five owner picker editions | Current board PNG; green y_, sky y_, green Y, signature keepsakes |
| Picker previews | `assets/brand/preview-new-0.png` through `preview-new-4.png`; classic preview preserved |
| Extension, plugin upload | `extension/icons/ygpt-256.png`, `plugin/assets/logo.png`; same canonical PNG |
| Setup/updater rail and resources | Canonical PNG; picker resources retain all five editions |
| Legacy native approval panel | Canonical PNG loaded by `runtime/approval-panel.ps1` |
| Windows executable icon | `assets/brand/ygpt-local.ico`, embedded by the build/package recipes |
| Managed installed shortcut | Targets `YGPTLocal.exe`; explicit `IconLocation` is `assets/ygpt.ico,0` |

`python3 scripts/make-icons-from-original.py` regenerates the current assets
with Pillow + libimagequant. Both Node generation entrypoints delegate to it.
The standalone plugin PNGs stay 256×256 and ≤10 KB. Windows ICOs retain full
quality at 16, 24, 32, 48, 64, 128 and 256 pixels, independently rendered from
the HD master; the PNG upload size limit does not apply to ICO frames. The
four earlier picker editions and all previews are kept intact.

The rc.17 audit decoded every ICO frame and compared it with a fresh render:
all seven were pixel-identical, including 256. No lower-quality downscale was
found. The managed shortcut previously relied on the executable's implicit
icon, which can retain a cached rendering across in-place updates. It now
points directly to the shipped multi-size ICO; setup/update refresh that
shortcut and notify the shell. Setup manages a Start Menu shortcut, not an
owner-created Desktop shortcut. The owner's actual `.lnk` and Windows icon
cache could not be inspected on Linux; desktop appearance still needs Windows
acceptance. No installer was rebuilt in this round.
