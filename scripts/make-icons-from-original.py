#!/usr/bin/env python3
"""Regenerate the shipped icon set from the owner's ORIGINAL artwork.

`assets/icon-glyph.png` was extracted pixel-for-pixel from the owner's brand
board (NEW_ICON_REFERENCE.png, the "App Icon" tile) and unpremultiplied from
its white background — it is the source of truth for the shipped rasters.
The earlier vector redraw (assets/icon.svg / scripts/make-icons.mjs) drifted
from the original art, so the shipped PNG/ICO set is composed from the
extracted glyph instead: the glyph centred on a clean white rounded tile,
matching the board's app-icon presentation.

Usage: python3 scripts/make-icons-from-original.py   (requires Pillow)
Outputs: assets/brand/ygpt-local*.png + ygpt-local.ico, assets/png/icon-*.png,
assets/ygpt.ico, plugin/assets/logo.png — same files the SVG flow produced.
"""
import os
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GLYPH = Image.open(os.path.join(ROOT, 'assets', 'icon-glyph.png')).convert('RGBA')
SIZES = [16, 24, 32, 48, 64, 128, 256, 512]


def tile(size, glyph_scale=None):
    """White rounded tile with the original glyph centred on transparency."""
    if glyph_scale is None:
        glyph_scale = 0.86 if size <= 32 else 0.78
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    radius = max(2, round(size * 0.19))
    draw.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=(255, 255, 255, 255))
    gw = round(size * glyph_scale)
    gh = round(gw * GLYPH.height / GLYPH.width)
    glyph = GLYPH.resize((gw, gh), Image.LANCZOS)
    x = (size - gw) // 2
    y = round(size * 0.10) if size > 32 else max(1, (size - gh) // 2 - 1)
    img.alpha_composite(glyph, (x, y))
    return img


def main():
    master = {s: tile(s) for s in SIZES}
    brand = os.path.join(ROOT, 'assets', 'brand')
    for s, img in master.items():
        img.save(os.path.join(brand, f'ygpt-local-{s}.png'))
        img.save(os.path.join(brand, f'ygpt-local-light-{s}.png'))
    png_dir = os.path.join(ROOT, 'assets', 'png')
    os.makedirs(png_dir, exist_ok=True)
    for s in [16, 24, 32, 48, 64, 128, 256]:
        master[s].save(os.path.join(png_dir, f'icon-{s}.png'))
    ico_frames = [master[s] for s in [16, 24, 32, 48, 64, 128, 256]]
    ico_frames[-1].save(os.path.join(brand, 'ygpt-local.ico'), format='ICO',
                        sizes=[(s, s) for s in [16, 24, 32, 48, 64, 128, 256]],
                        append_images=ico_frames[:-1])
    ico_frames[-1].save(os.path.join(ROOT, 'assets', 'ygpt.ico'), format='ICO',
                        sizes=[(s, s) for s in [16, 24, 32, 48, 64, 128, 256]],
                        append_images=ico_frames[:-1])
    master[512].save(os.path.join(ROOT, 'plugin', 'assets', 'logo.png'))
    print('icon set regenerated from assets/icon-glyph.png (owner original)')


if __name__ == '__main__':
    main()
