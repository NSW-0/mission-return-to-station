"""Prepare the black hole art for the game.

Reads art/blackhole_pixel_source.png (the pixel-art wallpaper) and writes
public/assets/blackhole.png: a square cut-out centred on the black hole, with the
edges faded to transparent so it blends into the star field, flipped so the
accretion disk sweeps to the right (the game draws it at the left edge of Player 1's
half and mirrors it for Player 2).

    python tools/prepare_blackhole.py

If you change the source picture, update HOLE_CENTER and RING_RADIUS (pixels in the
source) and the matching RING_FRACTION in public/js/scene.js.
"""
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "art" / "blackhole_pixel_source.png"
OUT = ROOT / "public" / "assets" / "blackhole.png"

HOLE_CENTER = (2470, 810)   # centre of the dark core in the source picture
RING_RADIUS = 650           # outer edge of the bright ring, in source pixels
HALF = 1300                 # half the size of the square cut-out, in source pixels
SIZE = 1400                 # output size in pixels


def main() -> None:
    src = Image.open(SRC).convert("RGB")
    cx, cy = HOLE_CENTER
    square = Image.new("RGBA", (HALF * 2, HALF * 2), (0, 0, 0, 0))
    square.paste(src.convert("RGBA"), (HALF - cx, HALF - cy))

    # Soft round mask: solid over the ring, fading out towards the corners.
    yy, xx = np.mgrid[0:HALF * 2, 0:HALF * 2].astype(np.float32)
    r = np.hypot(xx - HALF, yy - HALF) / HALF
    inner, outer = RING_RADIUS / HALF + 0.06, 1.0
    fade = np.clip((outer - r) / (outer - inner), 0, 1)
    fade = fade * fade * (3 - 2 * fade)  # smoothstep
    # The ring almost touches the top and bottom of the source picture: fade those
    # edges too, so no straight line shows.
    top, bottom = HALF - cy, HALF - cy + src.height
    # The hole also sits close to the picture's right edge (off screen in the game,
    # but faded anyway so a straight line can never show).
    left, right = HALF - cx, HALF - cx + src.width
    edge = np.clip((yy - top) / 260, 0, 1) * np.clip((bottom - yy) / 260, 0, 1)
    edge = edge * np.clip((xx - left) / 160, 0, 1) * np.clip((right - xx) / 160, 0, 1)
    edge = edge * edge * (3 - 2 * edge)
    arr = np.asarray(square).astype(np.float32)
    arr[..., 3] = arr[..., 3] * fade * edge
    out = Image.fromarray(arr.astype(np.uint8), "RGBA").transpose(Image.FLIP_LEFT_RIGHT)
    out = out.resize((SIZE, SIZE), Image.LANCZOS)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    out.save(OUT, optimize=True)
    print(f"wrote {OUT} ({OUT.stat().st_size // 1024} KB); ring fraction {RING_RADIUS / (HALF * 2):.4f}")


if __name__ == "__main__":
    main()
