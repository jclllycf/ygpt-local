#!/usr/bin/env python3
"""Build the high-resolution glyph master from the owner's original art.

The extracted glyph (assets/icon-glyph.png, ~113 px) is faithful but soft:
downscaling it into large icons looks blurry. This script performs a measured
1:1 redraw instead of a freehand one:

- Colours are the owner's own pixels, upscaled smoothly (gradients are smooth
  by nature) with fringe decontamination (edge colours are extended from the
  nearest fully-opaque pixel so no dark/light halo appears).
- The silhouette is re-hardened at 16x: the upscaled alpha is pushed through
  a steep sigmoid so edges become crisp again at any output size, while the
  curve itself is the interpolated original contour — the shape cannot drift.

Output: assets/icon-glyph-hd.png (RGBA master used by
scripts/make-icons-from-original.py). Requires numpy, scipy, Pillow.
"""
import os
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
S = 16  # supersample factor


def main():
    g = Image.open(os.path.join(ROOT, 'assets', 'icon-glyph.png')).convert('RGBA')
    w, h = g.size
    arr = np.asarray(g).astype(np.float32)
    rgb, alpha = arr[:, :, :3], arr[:, :, 3] / 255.0

    big = (w * S, h * S)
    a_big = np.asarray(Image.fromarray((alpha * 255).astype(np.uint8)).resize(big, Image.BICUBIC)).astype(np.float32) / 255.0
    a_big = np.asarray(Image.fromarray((a_big * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(2))).astype(np.float32) / 255.0
    # Re-harden the silhouette (steep sigmoid around 0.5).
    a_hard = np.clip((a_big - 0.5) * 3.2 + 0.5, 0, 1)
    a_hard = np.asarray(Image.fromarray((a_hard * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.2))).astype(np.float32) / 255.0

    # Colour: upscale smoothly, then extend interior colours into the fringe.
    rgb_big = np.stack([np.asarray(Image.fromarray(rgb[:, :, c].astype(np.uint8)).resize(big, Image.BICUBIC)).astype(np.float32) for c in range(3)], axis=2)
    solid = a_big > 0.92
    _, inds = ndimage.distance_transform_edt(~solid, return_indices=True)
    rgb_ext = rgb_big[inds[0], inds[1]]
    fringe = a_hard < 0.98
    rgb_out = np.where(fringe[:, :, None], rgb_ext, rgb_big)

    out = np.dstack([np.clip(rgb_out, 0, 255), a_hard * 255]).astype(np.uint8)
    im = Image.fromarray(out, 'RGBA').crop(Image.fromarray(out, 'RGBA').getbbox())
    im.save(os.path.join(ROOT, 'assets', 'icon-glyph-hd.png'))
    print('HD glyph master:', im.size)


if __name__ == '__main__':
    main()
