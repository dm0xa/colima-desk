#!/usr/bin/env python3
"""Render the Colima Desk installer window background.

Writes two files next to src-tauri/dmg/:

    background.png      660x400    the picture Finder draws at 1x
    background@2x.png   1320x800   AppKit's Retina rendition of the same picture

Both are 72 dpi PNGs. Finder draws a folder background at its *print size*
(pixels * 72 / dpi), so a 144 dpi 1320x800 image would also measure 660x400 pt,
but naming the second file `@2x` is the convention Finder resolves on a Retina
display and it degrades to the 1x file everywhere else instead of risking a
double-size background.

Geometry is shared with src-tauri/dmg/layout.sh: the arrow sits at y = 170,
which is where that script puts the two icon centres, and the caption stays
inside the first 300 pt so Finder's chrome (title bar, optional tab bar,
status bar) can never clip it.

Colors come from src/App.css (light theme). Requires Pillow:

    python3 -m pip install pillow
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

W, H = 660, 400
SUPERSAMPLE = 4

CANVAS_W = W * SUPERSAMPLE
CANVAS_H = H * SUPERSAMPLE

BG_TOP = (247, 251, 248)
BG_BOTTOM = (231, 242, 236)
GRID = (26, 61, 43)
ARROW = (92, 117, 104)
TEXT = (92, 117, 104)

SF = "/System/Library/Fonts/SFNS.ttf"
HERE = Path(__file__).resolve().parent.parent / "src-tauri" / "dmg"


def px(v: float) -> float:
    """Convert window points to supersampled canvas pixels."""
    return v * SUPERSAMPLE


def build() -> Image.Image:
    column = Image.new("RGB", (1, CANVAS_H))
    cpx = column.load()
    for y in range(CANVAS_H):
        t = y / (CANVAS_H - 1)
        cpx[0, y] = tuple(round(a + (b - a) * t) for a, b in zip(BG_TOP, BG_BOTTOM))
    img = column.resize((CANVAS_W, CANVAS_H), Image.NEAREST)

    # Soft highlight behind the icons: a low-resolution radial mask, upscaled.
    glow_cx, glow_cy = px(W / 2), px(150)
    glow_r = px(340)
    cell = 64
    mask_small = Image.new("L", (cell, cell), 0)
    mpx = mask_small.load()
    for gy in range(cell):
        for gx in range(cell):
            dx = (gx + 0.5) / cell * CANVAS_W - glow_cx
            dy = (gy + 0.5) / cell * CANVAS_H - glow_cy
            d = (dx * dx + dy * dy) ** 0.5 / glow_r
            mpx[gx, gy] = max(0, round(96 * (1 - min(d, 1.0)) ** 2))
    mask = mask_small.resize((CANVAS_W, CANVAS_H), Image.BICUBIC)
    img = Image.composite(Image.new("RGB", img.size, (255, 255, 255)), img, mask)

    draw = ImageDraw.Draw(img, "RGBA")

    # Instrument-panel dot grid.
    spacing = px(22)
    radius = max(1.0, px(0.7))
    y = spacing / 2
    while y < CANVAS_H:
        x = spacing / 2
        while x < CANVAS_W:
            draw.ellipse(
                (x - radius, y - radius, x + radius, y + radius),
                fill=GRID + (12,),
            )
            x += spacing
        y += spacing

    # Arrow from the app icon to the Applications folder.
    stroke = max(2, round(px(2)))
    y_mid = px(170)
    x_start, x_end = px(272), px(388)
    head, head_len = px(13), px(22)
    draw.line((x_start, y_mid, x_end - head, y_mid), fill=ARROW + (150,), width=stroke)
    for a, b in (
        (x_end - head_len, y_mid - head),
        (x_end - head_len, y_mid + head),
    ):
        draw.line((a, b, x_end, y_mid), fill=ARROW + (150,), width=stroke)
        r = stroke / 2
        draw.ellipse((a - r, b - r, a + r, b + r), fill=ARROW + (150,))
    for x, y in ((x_start, y_mid), (x_end, y_mid)):
        r = stroke / 2
        draw.ellipse((x - r, y - r, x + r, y + r), fill=ARROW + (150,))

    # Caption under the icons.
    font = ImageFont.truetype(SF, int(px(12.5)))
    font.set_variation_by_name("Regular")
    caption = "Drag Colima Desk into Applications"
    tw = draw.textlength(caption, font=font)
    draw.text(
        (px(W / 2) - tw / 2, px(298)),
        caption,
        font=font,
        fill=TEXT + (235,),
    )

    return img


def main() -> None:
    HERE.mkdir(parents=True, exist_ok=True)
    canvas = build()
    for name, size in (("background@2x.png", (W * 2, H * 2)), ("background.png", (W, H))):
        path = HERE / name
        canvas.resize(size, Image.LANCZOS).save(path, dpi=(72, 72), optimize=True)
        print(f"{path} {size[0]}x{size[1]} @72dpi")


if __name__ == "__main__":
    main()
