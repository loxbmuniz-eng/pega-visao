# -*- coding: utf-8 -*-
"""NODAL SILENCE — plate I—XI.  Marks are deposited, never drawn."""
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter
from scipy.special import jv, jn_zeros

rng = np.random.default_rng(7)

W, H = 2480, 3508
GROUND = np.array([14, 13, 12], float)
INK    = np.array([232, 225, 210], float)
ACCENT = np.array([168, 184, 72], float)
RULE   = (58, 54, 46)
DIM    = (122, 116, 102)
MID    = (168, 160, 143)

F = "/root/.claude/skills/canvas-design/canvas-fonts/"
def font(name, size): return ImageFont.truetype(F + name, size)

# ───────────────────────────────────────────────────────────── fields
def field_disc(u, v, m, kmn):
    r = np.hypot(u, v)
    return jv(m, kmn * r) * np.cos(m * np.arctan2(v, u))

def field_square(u, v, m, n):
    pi = np.pi
    return (np.cos(n*pi*u)*np.cos(m*pi*v) - np.cos(m*pi*u)*np.cos(n*pi*v))

def relax(u, v, f, iters=46, h=2.2e-3, jitter=1.1e-3):
    """Newton descent onto the nodal set s=0 — this is the sand settling."""
    for i in range(iters):
        s  = f(u, v)
        su = (f(u + h, v) - f(u - h, v)) / (2*h)
        sv = (f(u, v + h) - f(u, v - h)) / (2*h)
        g2 = su*su + sv*sv + 1e-9
        step = np.clip(s / g2, -0.05, 0.05)
        u -= step * su
        v -= step * sv
        if i > iters - 16:                      # settle: noise decays to nothing
            k = jitter * (iters - i) / 16.0
            u += rng.normal(0, k, u.shape)
            v += rng.normal(0, k, v.shape)
    return u, v

def splat(buf, xs, ys, wts):
    """Bilinear deposition of every grain."""
    hh, ww = buf.shape
    keep = (xs >= 0) & (xs < ww-1) & (ys >= 0) & (ys < hh-1)
    xs, ys, wts = xs[keep], ys[keep], wts[keep]
    x0 = xs.astype(np.int32); y0 = ys.astype(np.int32)
    fx = xs - x0; fy = ys - y0
    for dx, dy, wf in ((0,0,(1-fx)*(1-fy)), (1,0,fx*(1-fy)),
                       (0,1,(1-fx)*fy),     (1,1,fx*fy)):
        np.add.at(buf, (y0+dy, x0+dx), wts*wf)

# ───────────────────────────────────────────────────────── hero: the lens
HX, HY = 1240, 1012          # centre
HA, HB = 952, 694            # ellipse the radial field is compressed into
VH     = 0.62                # lens half-height, normalised → pointed oval
_k = (VH*VH - 1) / (2*VH); _rho = np.hypot(1.0, _k)

def in_lens(u, v):
    inside = np.abs(u) <= 1.0
    lim = np.where(inside, _k + np.sqrt(np.clip(_rho**2 - u*u, 0, None)), 0.0)
    return inside & (np.abs(v) <= lim)

def lens_edge(n=1400):
    u = np.linspace(-1, 1, n)
    lim = _k + np.sqrt(np.clip(_rho**2 - u*u, 0, None))
    top = [(HX + uu*HA, HY - ll*HB) for uu, ll in zip(u, lim)]
    bot = [(HX + uu*HA, HY + ll*HB) for uu, ll in zip(u[::-1], lim[::-1])]
    return top + bot

M_HERO, N_HERO = 9, 3
K_HERO = jn_zeros(M_HERO, N_HERO)[-1]
f_hero = lambda u, v: field_disc(u, v, M_HERO, K_HERO)

N_PART = 2_600_000
rr = np.sqrt(rng.uniform(0.115**2, 1.0, N_PART))
th = rng.uniform(0, 2*np.pi, N_PART)
u, v = rr*np.cos(th), rr*np.sin(th)
u, v = relax(u, v, f_hero)

m = in_lens(u, v) & (np.hypot(u, v) > 0.108) & (np.hypot(u, v) < 1.002)
u, v = u[m], v[m]
# grains thin out toward the lens tips — the plate is less excited at its edge
wt = 0.30 + 0.70*np.exp(-2.1*np.abs(u)**3)
wt *= rng.uniform(0.55, 1.0, wt.shape)

dens = np.zeros((H, W), np.float32)
splat(dens, HX + u*HA, HY + v*HB, wt.astype(np.float32))

# ───────────────────────────────────────── specimens: square plates
CELL, GAP, COLS = 340, 52, 5
GX0 = (W - (COLS*CELL + (COLS-1)*GAP)) // 2
ROW_Y = (1706, 2156)
SPECS = [
    ("II",   4, 2, "96 Hz"),  ("III",  5, 3, "128 Hz"), ("IV",  6, 2, "174 Hz"),
    ("V",    3, 4, "210 Hz"), ("VI",   7, 3, "256 Hz"), ("VII", 5, 4, "288 Hz"),
    ("VIII", 8, 2, "320 Hz"), ("IX",   4, 5, "384 Hz"), ("X",   6, 4, "440 Hz"),
    ("XI",   9, 2, "528 Hz"),
]
BLIND = "VII"                       # the plate observed without light
boxes = []
for i, (roman, mm, nn, hz) in enumerate(SPECS):
    cx0 = GX0 + (i % COLS)*(CELL+GAP)
    cy0 = ROW_Y[i // COLS]
    boxes.append((roman, cx0, cy0, mm, nn, hz))
    fs = lambda a, b, mm=mm, nn=nn: field_square(a, b, mm, nn)
    n = 210_000
    a = rng.uniform(0.0, 1.0, n); b = rng.uniform(0.0, 1.0, n)
    a, b = relax(a, b, fs, iters=40, h=1.6e-3, jitter=7e-4)
    k = (a > 0.004) & (a < 0.996) & (b > 0.004) & (b < 0.996)
    a, b = a[k], b[k]
    w = rng.uniform(0.5, 1.0, a.shape).astype(np.float32) * 0.86
    splat(dens, cx0 + a*CELL, cy0 + b*CELL, w)

# ─────────────────────────────────────────────────── tone map onto ground
d = dens.astype(np.float32)
inten = 1.0 - np.exp(-d * 0.60)
inten = np.clip(inten, 0, 1) ** 0.86
img = GROUND[None, None, :] + (INK - GROUND)[None, None, :] * inten[..., None]

# paper tooth
grain = rng.normal(0, 2.5, (H, W, 1))
img = np.clip(img + grain, 0, 255).astype(np.uint8)
canvas = Image.fromarray(img, "RGB")

# a breath of bloom where the deposit is densest
glow = canvas.filter(ImageFilter.GaussianBlur(13))
canvas = Image.blend(canvas, Image.fromarray(
    np.maximum(np.array(canvas), np.array(glow)).astype(np.uint8), "RGB"), 0.20)

dr = ImageDraw.Draw(canvas)

# ───────────────────────────────────────────────────────── the pupil
PR = 84
dr.ellipse([HX-PR, HY-PR, HX+PR, HY+PR], fill=tuple(GROUND.astype(int)))
dr.ellipse([HX-PR, HY-PR, HX+PR, HY+PR], outline=MID, width=2)
dr.ellipse([HX-PR-13, HY-PR-13, HX+PR+13, HY+PR+13], outline=RULE, width=1)
dr.ellipse([HX-4, HY-4, HX+4, HY+4], fill=tuple(ACCENT.astype(int)))   # accent I

# lens outline + specimen frames
dr.line(lens_edge() + [lens_edge()[0]], fill=MID, width=2, joint="curve")
for roman, cx0, cy0, mm, nn, hz in boxes:
    dr.rectangle([cx0, cy0, cx0+CELL, cy0+CELL], outline=RULE, width=1)

# the plate observed without light
for roman, cx0, cy0, mm, nn, hz in boxes:
    if roman != BLIND: continue
    by0, by1 = cy0 + int(CELL*0.335), cy0 + int(CELL*0.665)
    dr.rectangle([cx0+1, by0, cx0+CELL-1, by1], fill=tuple(GROUND.astype(int)))
    dr.line([cx0+1, by0, cx0+CELL-1, by0], fill=MID, width=2)
    dr.line([cx0+1, by1, cx0+CELL-1, by1], fill=MID, width=2)

# ───────────────────────────────────────────────────────── typography
def tracked(xy, text, fnt, fill, tr=0.0, anchor="lt"):
    ws = [dr.textlength(c, font=fnt) for c in text]
    total = sum(ws) + tr*(len(text)-1)
    x, y = xy
    if anchor[0] == "m": x -= total/2
    elif anchor[0] == "r": x -= total
    asc, desc = fnt.getmetrics()
    if anchor[1] == "m": y -= asc/2
    elif anchor[1] == "b": y -= asc
    for c, cw in zip(text, ws):
        dr.text((x, y), c, font=fnt, fill=fill)
        x += cw + tr
    return total

f_micro = font("Jura-Light.ttf", 23)
f_mono  = font("GeistMono-Regular.ttf", 20)
f_cap   = font("Jura-Light.ttf", 25)
f_pl    = font("GeistMono-Regular.ttf", 22)
f_anchor= font("Italiana-Regular.ttf", 176)
f_sub   = font("Jura-Light.ttf", 39)

ML, MR = 200, W-200
tracked((ML, 206), "OBSERVAÇÃO DE FIGURAS NODAIS", f_micro, MID, 7.5)
tracked((MR, 208), "XI PRANCHAS · PLACA EM VIBRAÇÃO", f_mono, DIM, 3.4, "rt")
dr.line([ML, 272, MR, 272], fill=RULE, width=1)

# hero caption, centred under the lens, with the second accent
cap = "PL. I  ·  MODO 9,3  ·  432 Hz  ·  AREIA SOBRE PLACA EM VIBRAÇÃO"
cw = sum(dr.textlength(c, font=f_cap) for c in cap) + 5.0*(len(cap)-1)
tracked((HX, 1546), cap, f_cap, MID, 5.0, "mt")
dr.line([HX - cw/2 - 34, 1558, HX - cw/2 - 16, 1558], fill=tuple(ACCENT.astype(int)), width=2)
dr.line([ML, 1636, MR, 1636], fill=RULE, width=1)

for roman, cx0, cy0, mm, nn, hz in boxes:
    y = cy0 + CELL + 22
    tracked((cx0, y), f"PL. {roman}", f_pl, MID, 1.6)
    sub = f"{mm},{nn} · {hz}" + ("  · SEM LUZ" if roman == BLIND else "")
    tracked((cx0, y + 30), sub, f_micro, DIM, 1.4)

dr.line([ML, 2604, MR, 2604], fill=RULE, width=1)
tracked((W//2, 2758), "O SOM SEMPRE TEVE CORPO", f_anchor, tuple(INK.astype(int)), 13, "mt")
tracked((W//2, 2968), "mesmo para quem nunca pôde vê-lo", f_sub, DIM, 9, "mt")

dr.line([ML, 3186, MR, 3186], fill=RULE, width=1)
tracked((ML, 3216), "FIGURAS NODAIS  ·  SÉRIE COMPLETA", f_mono, DIM, 3.2)
tracked((MR, 3216), "MMXXVI", f_mono, DIM, 3.2, "rt")

OUT = "/home/user/pega-visao/entregaveis/NODAL_SILENCE.png"
canvas.save(OUT, "PNG", optimize=True)
canvas.convert("RGB").save("/home/user/pega-visao/entregaveis/NODAL_SILENCE.pdf",
                           "PDF", resolution=300.0)
print("gravado:", OUT, canvas.size)
