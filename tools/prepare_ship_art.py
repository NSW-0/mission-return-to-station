"""Prepare the spaceship state images for the game.

Reads the large source PNGs in art/ and writes small, game-ready copies to
public/assets/ship/:

  p1_shield3.png  full shield      (all shields left)
  p1_shield2.png  cracked shield   (one shield lost)
  p1_shield1.png  no shield        (last shield)
  p1_broken.png   damaged ship     (shields down)
  p1_winner.png   laurel ship      (docked)
  p2_*.png        the same set, recoloured from blue to amber for Player 2

All five images are cropped to the same box so the ship does not jump when the
state changes. Run again after replacing any source image:

    python tools/prepare_ship_art.py
"""
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "art"
OUT = ROOT / "public" / "assets" / "ship"
SIZE = 640  # longest side in pixels; enough for a 1080p projector half

STATES = {
    "shield3": "spaceship_full_shield_matched.png",
    "shield2": "spaceship_broken_shield_matched.png",
    "shield1": "spaceship_no_shield_matched.png",
    "broken": "spaceship_broken_matched.png",
    "winner": "spaceship_race_winner_matched.png",
}


def blue_to_amber(img: Image.Image) -> Image.Image:
    """Shift blue and cyan hues to amber. Greys, whites and gold stay as they are."""
    rgba = np.asarray(img).astype(np.float32) / 255.0
    rgb, alpha = rgba[..., :3], rgba[..., 3:]
    hsv = np.asarray(Image.fromarray((rgb * 255).astype(np.uint8)).convert("HSV")).astype(np.float32)
    hue = hsv[..., 0] * 360.0 / 255.0
    sat = hsv[..., 1] / 255.0
    mask = (hue >= 150) & (hue <= 275) & (sat > 0.12)
    # Squeeze 150..275 degrees into 22..48 degrees (orange to amber).
    new_hue = 22 + (np.clip(hue, 150, 275) - 150) / 125.0 * 26
    hsv[..., 0] = np.where(mask, new_hue * 255.0 / 360.0, hsv[..., 0])
    # Amber reads lighter than blue: lift the value a little so P2 also differs in lightness.
    hsv[..., 2] = np.where(mask, np.minimum(255, hsv[..., 2] * 1.12 + 10), hsv[..., 2])
    out_rgb = Image.fromarray(hsv.astype(np.uint8), "HSV").convert("RGB")
    out = np.concatenate([np.asarray(out_rgb).astype(np.float32) / 255.0, alpha], axis=-1)
    return Image.fromarray((out * 255).astype(np.uint8), "RGBA")


def main() -> None:
    images = {k: Image.open(SRC / v).convert("RGBA") for k, v in STATES.items()}
    # One shared crop box: the union of every image's visible area, plus a margin.
    boxes = [im.getchannel("A").point(lambda a: 255 if a > 8 else 0).getbbox() for im in images.values()]
    left = min(b[0] for b in boxes); top = min(b[1] for b in boxes)
    right = max(b[2] for b in boxes); bottom = max(b[3] for b in boxes)
    side = max(right - left, bottom - top) + 40
    cx, cy = (left + right) // 2, (top + bottom) // 2
    box = (cx - side // 2, cy - side // 2, cx + side // 2, cy + side // 2)

    OUT.mkdir(parents=True, exist_ok=True)
    for name, im in images.items():
        small = im.crop(box).resize((SIZE, SIZE), Image.LANCZOS)
        small.save(OUT / f"p1_{name}.png", optimize=True)
        blue_to_amber(small).save(OUT / f"p2_{name}.png", optimize=True)
        print("wrote", f"p1_{name}.png", f"p2_{name}.png")


if __name__ == "__main__":
    main()
