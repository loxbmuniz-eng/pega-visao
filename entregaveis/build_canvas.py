# -*- coding: utf-8 -*-
"""NODAL SILENCE — PL. I—XI.  Marks are deposited, never drawn."""
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter
from scipy.special import jv, jn_zeros

rng = np.random.default_rng(11)

W, H   = 2480, 3508
MARGIN = 200
CW     = W - 2*MARGIN                      # 2080 — every element answers to this
GROUND = np.array([13, 12, 11], float)
INK    = np.array([234, 227, 212], float)
ACCENT = (168, 184, 72)
RULE   = (52, 49, 42)
DIM    = (134, 127, 112)
MID    = (166, 158, 141)

FDIR = "/root/.claude/skills/canvas-design/canvas-fonts/"
font = lambda n, s: ImageFont.truetype(FDIR + n, s)

# ─────────────────────────────────────────────────────────────── fields
MA, NA = 5, 5          # two modes, superposed — a real plate driven between
MB, NB = 12, 3         # two resonances answers with both at once
ALPHA  = 0.58
KA = jn_zeros(MA, NA)[-1]; KB = jn_zeros(MB, NB)[-1]
_rg = np.linspace(0.0, 1.14, 240_000)
_ja = jv(MA, KA * _rg); _jb = jv(MB, KB * _rg)

def _cheb(x, m):
    t0 = np.ones_like(x); t1 = x
    for _ in range(m - 1):
        t0, t1 = t1, 2.0*x*t1 - t0
    return t1

def f_hero(u, v):
    """Superposed Bessel modes — LUT radially, Chebyshev angularly."""
    r = np.hypot(u, v)
    x = np.divide(u, r, out=np.zeros_like(u), where=r > 1e-12)
    return (np.interp(r, _rg, _ja) * _cheb(x, MA)
            + ALPHA * np.interp(r, _rg, _jb) * _cheb(x, MB))

def f_square(u, v, m, n):
    pi = np.pi
    return np.cos(n*pi*u)*np.cos(m*pi*v) - np.cos(m*pi*u)*np.cos(n*pi*v)

def relax(u, v, f, iters, h, jitter):
    """Newton descent onto s=0 — the sand finding the places that do not move."""
    for i in range(iters):
        s  = f(u, v)
        su = (f(u + h, v) - f(u - h, v)) / (2*h)
        sv = (f(u, v + h) - f(u, v - h)) / (2*h)
        g2 = su*su + sv*sv + 1e-9
        step = np.clip(s / g2, -0.045, 0.045)
        u = u - step*su
        v = v - step*sv
        if i >= iters - 14:                     # the settling: noise decays to nil
            k = jitter * (iters - i) / 14.0
            u = u + rng.normal(0, k, u.shape)
            v = v + rng.normal(0, k, v.shape)
    g = np.sqrt(g2)
    return u, v, g

def scatter(xs, ys, n_seed):
    """A grain does not land on the line. It lands near it."""
    g = rng.random(xs.shape)
    sig = np.where(g < 0.66, 3.4, np.where(g < 0.92, 8.5, 19.0))
    return (xs + rng.normal(0, 1, xs.shape)*sig,
            ys + rng.normal(0, 1, ys.shape)*sig)

def splat(buf, xs, ys, wts):
    hh, ww = buf.shape
    k = (xs >= 0) & (xs < ww-1) & (ys >= 0) & (ys < hh-1)
    xs, ys, wts = xs[k], ys[k], wts[k]
    x0 = xs.astype(np.int32); y0 = ys.astype(np.int32)
    fx = (xs - x0).astype(np.float32); fy = (ys - y0).astype(np.float32)
    for dx, dy, wf in ((0,0,(1-fx)*(1-fy)), (1,0,fx*(1-fy)),
                       (0,1,(1-fx)*fy),     (1,1,fx*fy)):
        np.add.at(buf, (y0+dy, x0+dx), wts*wf)

def grain_weight(g):
    """A node reads more strongly where the field crosses it steeply."""
    q = g / (np.percentile(g, 88) + 1e-9)
    return np.clip(q, 0.0, 1.0)**0.38

# ───────────────────────────────────────────── the lens (PL. I)
HX, HY = W//2, 1000
HA     = CW//2                              # tips land exactly on the measure
VH     = 0.62
HB     = int(round(430 / VH))
_k   = (VH*VH - 1) / (2*VH)
_rho = float(np.hypot(1.0, _k))

def lens_limit(u):
    return _k + np.sqrt(np.clip(_rho**2 - u*u, 0, None))

dens = np.zeros((H, W), np.float32)

N = 3_100_000
rr = np.sqrt(rng.uniform(0.16**2, 1.0, N))
th = rng.uniform(0, 2*np.pi, N)
u, v, g = relax(rr*np.cos(th), rr*np.sin(th), f_hero, 22, 2.0e-3, 2.1e-3)

r = np.hypot(u, v)
keep = (np.abs(u) <= 1.0) & (r > 0.02) & (r < 1.001)
keep &= np.abs(v) <= lens_limit(np.clip(u, -1, 1))
u, v, g = u[keep], v[keep], g[keep]

w  = grain_weight(g)
w *= 0.10 + 0.90*np.exp(-3.2*np.abs(u)**3.2)          # tips dissolve, never stop

w *= rng.uniform(0.5, 1.0, w.shape)
px, py = scatter(HX + u*HA, HY + v*HB, N)
rpix = np.hypot(px - HX, py - HY)
w *= np.clip((rpix - (86 + 4)) / 46.0, 0, 1)      # the void is entered gradually
splat(dens, px, py, w.astype(np.float32))

# ───────────────────────────── the catalogue (PL. II—XI), square plates
COLS, GAP = 5, 55
CELL  = (CW - (COLS-1)*GAP) // COLS
ROW_Y = (1700, 1700 + CELL + 116)
SPECS = [("II",4,2,"96 Hz"), ("III",5,3,"128 Hz"), ("IV",6,2,"174 Hz"),
         ("V",3,4,"210 Hz"), ("VI",7,3,"256 Hz"), ("VII",5,4,"288 Hz"),
         ("VIII",8,2,"320 Hz"),("IX",4,5,"384 Hz"),("X",6,4,"440 Hz"),
         ("XI",9,2,"528 Hz")]
BLIND = "VII"
boxes = []
for i, (roman, mm, nn, hz) in enumerate(SPECS):
    cx0 = MARGIN + (i % COLS)*(CELL+GAP)
    cy0 = ROW_Y[i // COLS]
    boxes.append((roman, cx0, cy0, mm, nn, hz))
    n_pts = 260_000
    a, b, gg = relax(rng.uniform(0, 1, n_pts), rng.uniform(0, 1, n_pts),
                     lambda p, q, m=mm, o=nn: f_square(p, q, m, o),
                     24, 1.5e-3, 1.15e-3)
    k = (a > 0.005) & (a < 0.995) & (b > 0.005) & (b < 0.995)
    a, b, gg = a[k], b[k], gg[k]
    ww_ = grain_weight(gg) * rng.uniform(0.5, 1.0, a.shape) * 0.80
    sx, sy = scatter(cx0 + a*CELL, cy0 + b*CELL, len(a))
    inb = (sx > cx0+1) & (sx < cx0+CELL-1) & (sy > cy0+1) & (sy < cy0+CELL-1)
    splat(dens, sx[inb], sy[inb], ww_[inb].astype(np.float32))

# ─────────────────────────────────────────── tone: deposit onto the ground
inten = np.clip(1.0 - np.exp(-dens * 0.40), 0, 1) ** 0.90
img   = GROUND[None,None,:] + (INK - GROUND)[None,None,:] * inten[...,None]
img   = np.clip(img + rng.normal(0, 2.2, (H, W, 1)), 0, 255).astype(np.uint8)
canvas = Image.fromarray(img, "RGB")
glow   = np.array(canvas.filter(ImageFilter.GaussianBlur(15)))
canvas = Image.blend(canvas,
         Image.fromarray(np.maximum(np.array(canvas), glow).astype(np.uint8), "RGB"), 0.12)
dr = ImageDraw.Draw(canvas)
GT = tuple(GROUND.astype(int))

# the pupil — the sand already thinned toward it; only the void is stated
PR = 86
dr.ellipse([HX-PR, HY-PR, HX+PR, HY+PR], fill=GT)
dr.ellipse([HX-PR, HY-PR, HX+PR, HY+PR], outline=DIM, width=1)
dr.ellipse([HX-3, HY-3, HX+3, HY+3], fill=ACCENT)                 # accent · I

# lens outline, dissolving toward the tips exactly as the deposit does
def lerp(c1, c2, t): return tuple(int(round(a + (b-a)*t)) for a, b in zip(c1, c2))
US = np.linspace(-1, 1, 1500)
for sign in (-1, 1):
    pts = [(HX + uu*HA, HY + sign*lens_limit(uu)*HB) for uu in US]
    for j in range(len(pts)-1):
        t = abs(US[j])**2.6
        dr.line([pts[j], pts[j+1]], fill=lerp(DIM, GT, t), width=1)

for roman, cx0, cy0, mm, nn, hz in boxes:
    dr.rectangle([cx0, cy0, cx0+CELL, cy0+CELL], outline=RULE, width=1)
    if roman == BLIND:                       # the plate observed without light
        y0, y1 = cy0 + int(CELL*0.335), cy0 + int(CELL*0.665)
        dr.rectangle([cx0+1, y0, cx0+CELL-1, y1], fill=GT)
        dr.line([cx0+1, y0, cx0+CELL-1, y0], fill=MID, width=2)
        dr.line([cx0+1, y1, cx0+CELL-1, y1], fill=MID, width=2)

# ───────────────────────────────────────────────────────── typography
def tracked(xy, text, fnt, fill, tr=0.0, anchor="lt"):
    ws = [dr.textlength(c, font=fnt) for c in text]
    total = sum(ws) + tr*(len(text)-1)
    x, y = xy
    if   anchor[0] == "m": x -= total/2
    elif anchor[0] == "r": x -= total
    for c, cwd in zip(text, ws):
        dr.text((x, y), c, font=fnt, fill=fill); x += cwd + tr
    return total

f_micro = font("Jura-Light.ttf", 23)
f_mono  = font("GeistMono-Regular.ttf", 20)
f_cap   = font("Jura-Light.ttf", 25)
f_pl    = font("GeistMono-Regular.ttf", 22)
def fit(text, face, target, ratio=0.075, top=190):
    for sz in range(top, 40, -2):
        f = font(face, sz); tr = sz*ratio
        w = sum(dr.textlength(c, font=f) for c in text) + tr*(len(text)-1)
        if w <= target: return f, tr
    return font(face, 40), 3.0
ANCHOR = "O SOM SEMPRE TEVE CORPO"
f_anch, ANCH_TR = fit(ANCHOR, "Italiana-Regular.ttf", CW*0.93)
f_sub   = font("Jura-Light.ttf", 39)
ML, MR  = MARGIN, W - MARGIN
rule    = lambda y: dr.line([ML, y, MR, y], fill=RULE, width=1)

tracked((ML, 200), "OBSERVAÇÃO DE FIGURAS NODAIS", f_micro, MID, 7.5)
tracked((MR, 202), "XI PRANCHAS · PLACA EM VIBRAÇÃO", f_mono, DIM, 3.4, "rt")
rule(268)

cap = "PL. I  ·  MODOS 5,5 + 12,3  ·  432 Hz  ·  AREIA SOBRE PLACA EM VIBRAÇÃO"
cwd = tracked((HX, 1512), cap, f_cap, MID, 5.0, "mt")
dr.line([HX - cwd/2 - 36, 1524, HX - cwd/2 - 16, 1524], fill=ACCENT, width=2)  # accent · II
rule(1614)

for roman, cx0, cy0, mm, nn, hz in boxes:
    y = cy0 + CELL + 24
    tracked((cx0, y), f"PL. {roman}", f_pl, MID, 1.6)
    tracked((cx0, y + 31), f"{mm},{nn} · {hz}" + ("  · SEM LUZ" if roman == BLIND else ""),
            f_micro, DIM, 1.4)

rule(ROW_Y[1] + CELL + 168)
tracked((HX, ROW_Y[1] + CELL + 230), ANCHOR, f_anch, tuple(INK.astype(int)), ANCH_TR, "mt")
tracked((HX, ROW_Y[1] + CELL + 452), "mesmo para quem nunca pôde vê-lo", f_sub, DIM, 9, "mt")
rule(3178)
tracked((ML, 3206), "FIGURAS NODAIS  ·  SÉRIE COMPLETA", f_mono, DIM, 3.2)
tracked((MR, 3206), "MMXXVI", f_mono, DIM, 3.2, "rt")

OUT = "/home/user/pega-visao/entregaveis/NODAL_SILENCE.png"
canvas.save(OUT, "PNG", optimize=True)
canvas.save("/home/user/pega-visao/entregaveis/NODAL_SILENCE.pdf", "PDF", resolution=300.0)
print("OK", canvas.size, "| grãos na lente:", len(u), "| CELL", CELL,
      "| ultima regra", ROW_Y[1]+CELL+452)
