"""Genera el maestro vectorial del logotipo: tile del icono + "BRICKWISE" a la derecha.

Convierte los glifos de Stack Sans Notch Bold en paths, de modo que los SVG resultantes
no dependen de tener la fuente instalada. Las proporciones del tile (radio, aro, tamaño
de la "B") son las mismas que usa desktop/scripts/make-icon.cjs.

Solo hace falta volver a ejecutarlo si cambian esas proporciones, el texto o la fuente;
para regenerar los PNG basta con `npm run logo` desde desktop/, que no necesita Python.

    python3 -m venv .venv && .venv/bin/pip install fonttools
    .venv/bin/python desktop/scripts/make-logo-svg.py
"""
import os
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.boundsPen import BoundsPen
from fontTools.misc.transform import Transform

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
FONT = f"{ROOT}/public/fonts/Stack_Sans_Notch/static/StackSansNotch-Bold.ttf"
OUT = f"{ROOT}/public/brand"

# --- proporciones heredadas de desktop/scripts/make-icon.cjs -------------------
TILE = 256.0
RADIUS = TILE * 18.5 / 84          # esquina del icono
RING = TILE * 0.8 / 84             # aro interior #2a2a2a
ICON_FS = TILE * 64 / 84           # font-size de la "B" dentro del tile
GAP = TILE * 0.22                  # aire entre icono y palabra
WORD_CAP = TILE * 0.42             # altura de caja alta del logotipo
TRACK = 0.04                       # letter-spacing en em (igual que .font-brand)

BRICK = "#b84f30"
TILE_BG = "#181818"
RING_C = "#2a2a2a"
INK_LIGHT = "#202020"              # texto sobre fondo claro
INK_DARK = "#f5f5f5"               # texto sobre fondo oscuro (token --background)
WHITE = "#ffffff"                  # blanco puro: fotos, negro absoluto, un solo color

f = TTFont(FONT)
upm = f["head"].unitsPerEm
cap = f["OS/2"].sCapHeight
gs = f.getGlyphSet()
cmap = f.getBestCmap()
hmtx = f["hmtx"]


def path_of(glyph_name, transform):
    pen = SVGPathPen(gs, ntos=lambda v: f"{v:.2f}".rstrip("0").rstrip("."))
    gs[glyph_name].draw(TransformPen(pen, transform))
    return pen.getCommands()


def bounds_of(glyph_name):
    bp = BoundsPen(gs)
    gs[glyph_name].draw(bp)
    return bp.bounds


# --- 1. la "B" del icono, centrada por su caja real ---------------------------
b_name = cmap[ord("B")]
s_icon = ICON_FS / upm
x0, y0, x1, y1 = bounds_of(b_name)
b_w, b_h = (x1 - x0) * s_icon, (y1 - y0) * s_icon
# y-up del contorno → y-down del SVG
tx = (TILE - b_w) / 2 - x0 * s_icon
ty = (TILE + b_h) / 2 + y0 * s_icon
icon_b = path_of(b_name, Transform(s_icon, 0, 0, -s_icon, tx, ty))

# --- 2. el logotipo, con el tracking de .font-brand ---------------------------
word = "BRICKWISE"
s_word = WORD_CAP / cap
track_u = TRACK * upm

pen_x = 0.0
advances = []
for i, ch in enumerate(word):
    gn = cmap[ord(ch)]
    advances.append((gn, pen_x))
    pen_x += hmtx[gn][0] + (track_u if i < len(word) - 1 else 0)

# alinear ópticamente: quitar el lateral izquierdo de la B y el derecho de la E
lsb_first = bounds_of(cmap[ord(word[0])])[0]
last_gn = cmap[ord(word[-1])]
rsb_last = hmtx[last_gn][0] - bounds_of(last_gn)[2]
word_w = (pen_x - lsb_first - rsb_last) * s_word

baseline = (TILE + WORD_CAP) / 2      # caja alta centrada en el tile
origin_x = TILE + GAP - lsb_first * s_word
word_paths = [
    path_of(gn, Transform(s_word, 0, 0, -s_word, origin_x + x * s_word, baseline))
    for gn, x in advances
]

W = TILE + GAP + word_w


def rounded_rect(x, y, w, h, r):
    """El tile como path, para poder calar la "B" con fill-rule evenodd."""
    return (
        f"M{x + r:.2f},{y:.2f} H{x + w - r:.2f} A{r:.2f},{r:.2f} 0 0 1 {x + w:.2f},{y + r:.2f} "
        f"V{y + h - r:.2f} A{r:.2f},{r:.2f} 0 0 1 {x + w - r:.2f},{y + h:.2f} "
        f"H{x + r:.2f} A{r:.2f},{r:.2f} 0 0 1 {x:.2f},{y + h - r:.2f} "
        f"V{y + r:.2f} A{r:.2f},{r:.2f} 0 0 1 {x + r:.2f},{y:.2f} Z"
    )


def svg(ink, mono=None):
    """mono: un solo color. El tile se rellena con él y la "B" queda calada (evenodd),
    así los contrapunzones de la letra vuelven a ser sólidos, como en el icono."""
    r = RING / 2
    if mono:
        icon = (
            f'<path d="{rounded_rect(0, 0, TILE, TILE, RADIUS)} {icon_b}" '
            f'fill="{mono}" fill-rule="evenodd"/>'
        )
    else:
        icon = (
            f'<rect width="{TILE:.0f}" height="{TILE:.0f}" rx="{RADIUS:.2f}" fill="{TILE_BG}"/>\n'
            f'<rect x="{r:.2f}" y="{r:.2f}" width="{TILE - RING:.2f}" height="{TILE - RING:.2f}" '
            f'rx="{RADIUS - r:.2f}" fill="none" stroke="{RING_C}" stroke-width="{RING:.2f}"/>\n'
            f'<path d="{icon_b}" fill="{BRICK}"/>'
        )
    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="{W:.0f}" height="{TILE:.0f}" viewBox="0 0 {W:.2f} {TILE:.0f}" role="img" aria-label="Brickwise">
<title>Brickwise</title>
{icon}
<g fill="{mono or ink}">
{chr(10).join(f'<path d="{p}"/>' for p in word_paths)}
</g>
</svg>
"""


os.makedirs(OUT, exist_ok=True)
VARIANTS = (
    ("brickwise-logo.svg", dict(ink=INK_LIGHT)),
    ("brickwise-logo-dark.svg", dict(ink=INK_DARK)),
    ("brickwise-logo-white.svg", dict(ink=WHITE)),
    ("brickwise-logo-mono-white.svg", dict(ink=WHITE, mono=WHITE)),
)

for name, kw in VARIANTS:
    open(f"{OUT}/{name}", "w").write(svg(**kw))
    print(f"✓ public/brand/{name}  {W:.0f}×{TILE:.0f}")
print(f"  tile {TILE:.0f} · gap {GAP:.1f} · cap logotipo {WORD_CAP:.1f} · tracking {TRACK}em")
