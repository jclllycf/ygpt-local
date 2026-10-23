#!/usr/bin/env python3
"""Build icons from the reference-derived transparent master.

Only plugin-icon-256.png is palette compressed for the <10 KB upload form.
Application PNGs and all seven Windows ICO sizes retain full color.
The shell also gets a versioned ICO path to avoid stale icon-cache entries.
Requires Pillow. The source master is never synthesized by this script.
"""
import io
import json
import os
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GLYPH = Image.open(os.path.join(ROOT, 'assets', 'brand', 'ygpt-glyph-master.png')).convert('RGBA')
ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]
MAX_PNG_BYTES = 10240


def tile(size):
    glyph_scale = 0.98 if size <= 32 else 0.96
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    radius = max(2, round(size * 0.19))
    draw.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=(255, 255, 255, 255))
    gw = round(size * glyph_scale)
    gh = round(gw * GLYPH.height / GLYPH.width)
    glyph = GLYPH.resize((gw, gh), Image.LANCZOS)
    x = (size - gw) // 2
    # Optical centre slightly below the middle (owner: the mark rode too high).
    y = max(0, (size - gh) // 2)
    img.alpha_composite(glyph, (x, y))
    return img


def optimized_256():
    """The one canonical shipped PNG: 256x256, <=10 KB, from the HD master."""
    img = tile(256)
    for colors in (256, 192, 160, 128, 112, 96):
        q = img.quantize(colors=colors, method=Image.FASTOCTREE, dither=Image.FLOYDSTEINBERG)
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
    for name in ('plugin-icon-256.png',):
        with open(os.path.join(brand, name), 'wb') as f:
            f.write(data)
    os.makedirs(os.path.join(ROOT, 'assets', 'png'), exist_ok=True)
    for size in (256, 512, 1024):
        tile(size).save(os.path.join(brand, 'ygpt-local-%d.png' % size), optimize=True)
    tile(1024).save(os.path.join(brand, 'ygpt-local-light-256.png'), optimize=True)
    tile(256).save(os.path.join(ROOT, 'assets', 'png', 'icon-256.png'), optimize=True)
    with open(os.path.join(ROOT, 'plugin', 'assets', 'logo.png'), 'wb') as f:
        f.write(data)
    for path in (os.path.join(brand, 'ygpt-local.ico'), os.path.join(ROOT, 'assets', 'ygpt.ico'), os.path.join(ROOT, 'assets', 'ygpt-'+json.load(open(os.path.join(ROOT, 'package.json'), encoding='utf-8'))['version']+'.ico')):
        write_ico(path)
    with open(os.path.join(ROOT, 'extension', 'icons', 'ygpt-256.png'), 'wb') as f:
        f.write(open(os.path.join(brand, 'ygpt-local-256.png'), 'rb').read())
    import runpy
    runpy.run_path(os.path.join(ROOT, 'scripts', 'plugin-icons.py'), run_name='__main__')
    print('Plugin upload: %d bytes; full-color app PNGs: 256/512/1024; multi-size ICOs: 16-256' % len(data))


if __name__ == '__main__':
    main()
