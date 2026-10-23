#!/usr/bin/env python3
"""Regenerate the shipped icon set from the owner's ORIGINAL artwork.

Source of truth: assets/icon-glyph-hd.png (built by scripts/make-glyph-hd.py
from the glyph extracted out of the owner's brand board). Shipped PNG icons
follow the owner's spec: every standalone icon is 256x256 and at most 10 KB
(the ChatGPT plugin form's upload limit) while staying crisp — the 256 is
palette-optimized with libimagequant from the HD master. The Windows .ico
files keep their multi-size frames (16-256) generated in memory from the
master; there are no loose multi-size PNG files anymore.

Usage: python3 scripts/make-icons-from-original.py   (requires Pillow)
Outputs: assets/brand/ygpt-local-256.png, ygpt-local-light-256.png,
plugin-icon-256.png, ygpt-local.ico; assets/png/icon-256.png, assets/ygpt.ico;
plugin/assets/logo.png; extension/icons/ygpt-256.png. The .ico files are written by hand below so every
size entry is explicit; the shipped ICO was verified entry by entry (7 PNG
frames, the 256 frame pixel-identical to the HD render). The setup also
nudges the Windows icon cache after install, which otherwise keeps serving
the first rendering it cached for the app's path.
"""
import io
import os
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GLYPH = Image.open(os.path.join(ROOT, 'assets', 'icon-glyph-hd.png')).convert('RGBA')
ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]
MAX_PNG_BYTES = 10240


def tile(size):
    glyph_scale = 0.86 if size <= 32 else 0.78
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    radius = max(2, round(size * 0.19))
    draw.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=(255, 255, 255, 255))
    gw = round(size * glyph_scale)
    gh = round(gw * GLYPH.height / GLYPH.width)
    glyph = GLYPH.resize((gw, gh), Image.LANCZOS)
    x = (size - gw) // 2
    # Optical centre slightly below the middle (owner: the mark rode too high).
    y = round(size * 0.145) if size > 32 else max(1, round(size * 0.51 - gh / 2))
    img.alpha_composite(glyph, (x, y))
    return img


def optimized_256():
    """The one canonical shipped PNG: 256x256, <=10 KB, from the HD master."""
    img = tile(256)
    for colors in (256, 192, 160, 128, 112, 96):
        q = img.quantize(colors=colors, method=3, dither=Image.FLOYDSTEINBERG)
        buf = io.BytesIO()
        q.save(buf, format='PNG', optimize=True)
        data = buf.getvalue()
        if len(data) <= MAX_PNG_BYTES:
            return data
    raise SystemExit('could not fit the 256 icon under %d bytes' % MAX_PNG_BYTES)


def write_ico(path):
    """Write a real multi-size ICO: one PNG entry per size, full quality."""
    import struct
    payloads = []
    for s in ICO_SIZES:
        buf = io.BytesIO()
        tile(s).save(buf, format='PNG', optimize=True)
        payloads.append(buf.getvalue())
    header = struct.pack('<HHH', 0, 1, len(payloads))
    offset = 6 + 16 * len(payloads)
    entries = b''
    for s, data in zip(ICO_SIZES, payloads):
        entries += struct.pack('<BBBBHHII', 0 if s == 256 else s, 0 if s == 256 else s,
                               0, 0, 1, 32, len(data), offset)
        offset += len(data)
    with open(path, 'wb') as f:
        f.write(header + entries + b''.join(payloads))


def main():
    data = optimized_256()
    brand = os.path.join(ROOT, 'assets', 'brand')
    for name in ('ygpt-local-256.png', 'ygpt-local-light-256.png', 'plugin-icon-256.png'):
        with open(os.path.join(brand, name), 'wb') as f:
            f.write(data)
    with open(os.path.join(ROOT, 'assets', 'png', 'icon-256.png'), 'wb') as f:
        f.write(data)
    with open(os.path.join(ROOT, 'plugin', 'assets', 'logo.png'), 'wb') as f:
        f.write(data)
    for path in (os.path.join(brand, 'ygpt-local.ico'), os.path.join(ROOT, 'assets', 'ygpt.ico')):
        write_ico(path)
    with open(os.path.join(ROOT, 'extension', 'icons', 'ygpt-256.png'), 'wb') as f:
        f.write(data)
    print('shipped icons: one canonical 256x256 PNG (%d bytes) + multi-size ICOs' % len(data))


if __name__ == '__main__':
    main()
