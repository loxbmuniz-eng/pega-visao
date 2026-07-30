# -*- coding: utf-8 -*-
"""Soft chapter wash backgrounds — replaces the flat single-color slide fill."""
import numpy as np
from PIL import Image, ImageFilter

W, H = 2000, 1125
GRAF = (19, 18, 17)

def hex2rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))

def make_wash(accent_hex, out_path, seed=0, corner="tr", strength=0.22):
    rng = np.random.default_rng(seed)
    base = np.zeros((H, W, 3), np.float32)
    base[..., 0], base[..., 1], base[..., 2] = GRAF

    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    cx = {"tr": (W*0.86, H*0.10), "tl": (W*0.12, H*0.08),
          "br": (W*0.88, H*0.92), "bl": (W*0.10, H*0.90),
          "c":  (W*0.50, H*0.42)}[corner]
    r = np.hypot(xx - cx[0], yy - cx[1])
    rmax = np.hypot(W, H) * 0.52
    glow = np.clip(1.0 - r / rmax, 0, 1) ** 1.8

    accent = np.array(hex2rgb(accent_hex), np.float32)
    img = base + glow[..., None] * (accent - base) * strength

    # gentle vignette toward the frame edges
    vx = np.abs(xx - W/2) / (W/2)
    vy = np.abs(yy - H/2) / (H/2)
    vig = 1.0 - 0.16 * np.clip(np.maximum(vx, vy) - 0.55, 0, 1) / 0.45
    img *= vig[..., None]

    im = Image.fromarray(np.clip(img, 0, 255).astype(np.uint8), "RGB")
    im = im.filter(ImageFilter.GaussianBlur(38))

    grain = rng.normal(0, 3.2, (H, W, 1)).astype(np.float32)
    arr = np.clip(np.array(im, np.float32) + grain, 0, 255).astype(np.uint8)
    Image.fromarray(arr, "RGB").save(out_path, "JPEG", quality=87, optimize=True)

if __name__ == "__main__":
    import sys
    OUT = "/tmp/claude-0/-home-user-pega-visao/348e86a7-e79e-5678-8e97-1bfec678684b/scratchpad/assets/wash/"
    import os
    os.makedirs(OUT, exist_ok=True)
    specs = [
        ("oliva",   "A8B848", 1, "tr"),
        ("magenta", "D8336B", 2, "tl"),
        ("lilas",   "9E5D9E", 3, "br"),
        ("coral",   "D63E3C", 4, "bl"),
        ("teal",    "3D8FA6", 5, "tr"),
        ("dourado", "C9A063", 6, "c"),
    ]
    for name, hexcol, seed, corner in specs:
        make_wash(hexcol, OUT + f"{name}.jpg", seed=seed, corner=corner)
        print(name, "ok")
