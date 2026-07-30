# -*- coding: utf-8 -*-
import os
from frame_kit import make_frame

OUT = "/tmp/claude-0/-home-user-pega-visao/348e86a7-e79e-5678-8e97-1bfec678684b/scratchpad/assets/frames/"
os.makedirs(OUT, exist_ok=True)

M = 0.62
CWD = 13.333 - 2 * M          # 12.093
COL = {"OLIVA": "A8B848", "MAGENTA": "D8336B", "LILAS": "9E5D9E",
       "CORAL": "D63E3C", "TEAL": "3D8FA6", "OURO": "C9A063"}

CARD_W_08 = CWD / 2 - 0.16     # 5.8865
RH_15 = 0.564

MANIFEST = [
    # name,                  w,              h,           color
    ("card_frentes",         CARD_W_08,      1.82,        None),   # 4 colors
    ("card_date",             1.98,          0.92,        "MAGENTA"),
    ("card_sets",              6.6,          0.90,        "OLIVA"),
    ("card_intercambio",      4.36,          3.60,        "TEAL"),
    ("card_total14",          CWD,           0.80,        "OLIVA"),
    ("card_row15",            12.09,         RH_15 - 0.08, None),   # magenta + ouro
    ("card_total15",          12.09,         0.62,        "MAGENTA"),
    ("card_signature",        2.34,          3.50,        None),    # 5 colors
    ("photo_ota",             4.56,          4.66,        "MAGENTA"),
    ("photo_palco",           4.81,          5.42,        "CORAL"),
    ("photo_trust_a",         3.10,          1.42,        "LILAS"),
    ("photo_trust_b",         3.21,          1.42,        "LILAS"),
    ("photo_badaro",          1.38,          1.50,        "CORAL"),
]

MULTI = {
    "card_frentes":  ["OLIVA", "CORAL", "MAGENTA", "LILAS"],
    "card_row15":    ["MAGENTA", "OURO"],
    "card_signature":["OLIVA", "CORAL", "MAGENTA", "LILAS", "TEAL"],
}

n = 0
for name, w, h, color in MANIFEST:
    if color is None:
        for c in MULTI[name]:
            make_frame(w, h, COL[c], out_path=f"{OUT}{name}_{c.lower()}.png")
            n += 1
    else:
        make_frame(w, h, COL[color], out_path=f"{OUT}{name}.png")
        n += 1
print(f"gerados {n} frames em {OUT}")
