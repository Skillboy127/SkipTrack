"""Rasterise the Flex 2B mark (assets/flex-2b.svg) to PNG.

There is no SVG rasteriser on this machine, so the mark is redrawn here from the
same geometry as the SVG: an open stopwatch arc, a crown, and a dumbbell rotated
-42 degrees acting as the hand. Everything is drawn supersampled and then
downsampled, which gives clean edges and round caps without a vector library.

    python tools/render_flex_logo.py

Run it again after editing assets/flex-2b.svg so the two stay in step.
"""
import math
import os

from PIL import Image, ImageDraw

INK = "#0E0E0E"
PAPER = "#F2EEE3"
ACCENT = "#FF4F1F"

SS = 8      # supersample factor
VIEW = 64   # SVG viewBox units

# The dumbbell group from the SVG, in local units around its own centre.
DUMBBELL = [
    (-11, -1.5, 22, 3, 1.5),      # bar
    (-9.6, -8.5, 4.4, 17, 2),     # inner plates
    (5.2, -8.5, 4.4, 17, 2),
    (-12.8, -5.5, 3.6, 11, 1.5),  # outer plates
    (9.2, -5.5, 3.6, 11, 1.5),
]
DUMBBELL_SCALE = 1.02


def _rect(draw, k, x, y, w, h, r, fill):
    """Rounded rect given in view units; k converts view units to pixels."""
    box = [x * k, y * k, (x + w) * k, (y + h) * k]
    if r:
        draw.rounded_rectangle(box, radius=r * k, fill=fill)
    else:
        draw.rectangle(box, fill=fill)


def _dumbbell_layer(px, k, fill):
    """The dumbbell drawn upright, centred, in its own full-size layer."""
    layer = Image.new("RGBA", (px, px), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    c = VIEW / 2  # centre of the layer, in view units
    s = DUMBBELL_SCALE
    for x, y, w, h, r in DUMBBELL:
        _rect(d, k, c + x * s, c + y * s, w * s, h * s, r * s, fill)
    return layer


def render(size, mark=INK, accent=ACCENT, background=None, corner_ratio=None, inset=0.0):
    """Render the mark at `size` px. `inset` shrinks the mark (for icon padding)."""
    px = size * SS
    img = Image.new("RGBA", (px, px), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    k = px / VIEW

    if background is not None:
        if corner_ratio:
            draw.rounded_rectangle([0, 0, px - 1, px - 1], radius=px * corner_ratio, fill=background)
        else:
            draw.rectangle([0, 0, px, px], fill=background)

    glyph = Image.new("RGBA", (px, px), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glyph)

    # Open timer arc: centre (32,34) r23, from -42 deg clockwise through 312 deg.
    # Stamped as overlapping dots, which gives the round caps for free.
    cx, cy, r, stroke = 32.0, 34.0, 23.0, 4.2
    sweep = 312.0
    steps = int(sweep * 6)
    rad = stroke / 2
    for i in range(steps + 1):
        a = math.radians(-42 + sweep * i / steps)
        x, y = cx + r * math.cos(a), cy + r * math.sin(a)
        gd.ellipse([(x - rad) * k, (y - rad) * k, (x + rad) * k, (y + rad) * k], fill=mark)

    # Crown
    _rect(gd, k, 28.5, 2.5, 7, 3.6, 1.6, mark)
    _rect(gd, k, 30.6, 5.5, 2.8, 3.4, 0, mark)

    # Dumbbell hand. SVG rotate(-42) is 42 deg anticlockwise on screen, which is
    # what PIL's positive rotation angle does.
    layer = _dumbbell_layer(px, k, mark).rotate(42, resample=Image.BICUBIC)
    # Layer centre is (32,32) in view units; the hand pivots about (32,34).
    glyph.alpha_composite(layer, (0, int((cy - VIEW / 2) * k)))

    # Pivot dot last so it sits on top of the bar.
    dot = 2.6
    gd.ellipse([(cx - dot) * k, (cy - dot) * k, (cx + dot) * k, (cy + dot) * k], fill=accent)

    if inset:
        keep = 1.0 - inset
        small = glyph.resize((int(px * keep), int(px * keep)), Image.LANCZOS)
        glyph = Image.new("RGBA", (px, px), (0, 0, 0, 0))
        off = int(px * inset / 2)
        glyph.alpha_composite(small, (off, off))

    img.alpha_composite(glyph)
    return img.resize((size, size), Image.LANCZOS)


if __name__ == "__main__":
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    assets = os.path.join(root, "assets")
    render(192).save(os.path.join(assets, "flex-mark.png"))
    render(192, mark=PAPER).save(os.path.join(assets, "flex-mark-paper.png"))
    print("wrote flex-mark.png, flex-mark-paper.png")
