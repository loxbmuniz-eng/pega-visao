# -*- coding: utf-8 -*-
"""Art-deco corner/edge ornament extracted from the client's own reference deck
(PEGA_VISAO_PITCH_DECK4_2.pdf, page 11), luminance-keyed to a tintable mask,
then composed as a 9-slice frame at any target size/color."""
import numpy as np
from PIL import Image

SRC = "/tmp/claude-0/-home-user-pega-visao/348e86a7-e79e-5678-8e97-1bfec678684b/scratchpad/frame_src/"

def _alpha_from_luminance(im, lo=75, hi=140):
    a = np.array(im.convert("RGB")).astype(np.float32)
    lum = 0.299 * a[..., 0] + 0.587 * a[..., 1] + 0.114 * a[..., 2]
    return np.clip((lum - lo) / (hi - lo), 0, 1)

_corner_raw = Image.open(SRC + "corner_tile_raw.png")   # 760x760, top-left orientation
_edge_raw   = Image.open(SRC + "edge_top_raw.png")       # 900x140 strip

CORNER_ALPHA = _alpha_from_luminance(_corner_raw)
EDGE_ALPHA   = _alpha_from_luminance(_edge_raw)
CORNER_RAW_PX = _corner_raw.width      # 760, square
EDGE_RAW_H    = _edge_raw.height       # 140
EDGE_RAW_W    = _edge_raw.width        # 900

def _tint(alpha_2d, hex_color):
    h = hex_color.lstrip("#")
    r, g, b = (int(h[i:i+2], 16) for i in (0, 2, 4))
    H, W = alpha_2d.shape
    out = np.zeros((H, W, 4), np.uint8)
    out[..., 0] = r; out[..., 1] = g; out[..., 2] = b
    out[..., 3] = (alpha_2d * 255).astype(np.uint8)
    return Image.fromarray(out, "RGBA")

def _resize_alpha(alpha_2d, w, h):
    im = Image.fromarray((alpha_2d * 255).astype(np.uint8), "L")
    im = im.resize((max(1, w), max(1, h)), Image.LANCZOS)
    return np.array(im).astype(np.float32) / 255.0

def make_frame(w_in, h_in, color_hex, dpi=200, out_path=None,
               corner_in=None, min_corner=0.20, max_corner=0.52):
    """9-slice ornate frame: real corner ornament at all 4 corners (mirrored),
    tiled straight double-line edges between them, fully transparent centre."""
    W, H = int(round(w_in * dpi)), int(round(h_in * dpi))
    if corner_in is None:
        corner_in = min(max(min(w_in, h_in) * 0.30, min_corner), max_corner)
    c = int(round(corner_in * dpi))
    c = max(24, min(c, W // 2 - 2, H // 2 - 2))
    scale = c / CORNER_RAW_PX
    edge_h = max(2, int(round(EDGE_RAW_H * scale)))

    canvas_a = np.zeros((H, W), np.float32)

    corner_tl = _resize_alpha(CORNER_ALPHA, c, c)
    corner_tr = np.fliplr(corner_tl)
    corner_bl = np.flipud(corner_tl)
    corner_br = np.flipud(corner_tr)
    canvas_a[0:c, 0:c] = np.maximum(canvas_a[0:c, 0:c], corner_tl)
    canvas_a[0:c, W-c:W] = np.maximum(canvas_a[0:c, W-c:W], corner_tr)
    canvas_a[H-c:H, 0:c] = np.maximum(canvas_a[H-c:H, 0:c], corner_bl)
    canvas_a[H-c:H, W-c:W] = np.maximum(canvas_a[H-c:H, W-c:W], corner_br)

    span_x = max(0, W - 2*c)
    if span_x > 0:
        seg_w = max(1, int(EDGE_RAW_W * scale))
        reps = int(np.ceil(span_x / seg_w)) + 1
        strip = _resize_alpha(EDGE_ALPHA, seg_w, edge_h)
        strip = np.tile(strip, (1, reps))[:, :span_x]
        canvas_a[0:edge_h, c:c+span_x] = np.maximum(canvas_a[0:edge_h, c:c+span_x], strip)
        canvas_a[H-edge_h:H, c:c+span_x] = np.maximum(canvas_a[H-edge_h:H, c:c+span_x], strip)

    span_y = max(0, H - 2*c)
    if span_y > 0:
        seg_w = max(1, int(EDGE_RAW_W * scale))
        strip_v_src = np.array(Image.fromarray((EDGE_ALPHA*255).astype(np.uint8), "L").rotate(90, expand=True)).astype(np.float32)/255.0
        reps = int(np.ceil(span_y / seg_w)) + 1
        stripv = _resize_alpha(strip_v_src, edge_h, seg_w)
        stripv = np.tile(stripv, (reps, 1))[:span_y, :]
        canvas_a[c:c+span_y, 0:edge_h] = np.maximum(canvas_a[c:c+span_y, 0:edge_h], stripv)
        canvas_a[c:c+span_y, W-edge_h:W] = np.maximum(canvas_a[c:c+span_y, W-edge_h:W], stripv)

    frame = _tint(canvas_a, color_hex)
    if out_path:
        frame.save(out_path, "PNG", optimize=True)
    return frame

if __name__ == "__main__":
    make_frame(5.89, 1.82, "A8B848", out_path="/tmp/test_frame_wide.png")
    make_frame(2.34, 3.5, "D8336B", out_path="/tmp/test_frame_tall.png")
    make_frame(4.56, 4.66, "D8336B", out_path="/tmp/test_frame_photo.png")
    print("ok")
