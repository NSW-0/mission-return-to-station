"""Make the launcher icon (launcher/mission.ico) from art/blackhole_icon.png.

The dark background around the black hole becomes transparent (the dark core
inside the ring stays solid), the picture is squared, and the pixel art is scaled
with hard edges so it stays crisp.

    python tools/make_icon.py
"""
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "art" / "blackhole_icon.png"
OUT = ROOT / "launcher" / "mission.ico"
BACKGROUND = (27, 27, 27)


def main() -> None:
    im = Image.open(SRC).convert("RGBA")
    # Flood-fill from every edge pixel so only the outside background is removed
    # (the light jets cut the background into several pieces).
    marker = (255, 0, 255, 255)
    edges = [(x, 0) for x in range(im.width)] + [(x, im.height - 1) for x in range(im.width)]
    edges += [(0, y) for y in range(im.height)] + [(im.width - 1, y) for y in range(im.height)]
    for point in edges:
        if im.getpixel(point)[:3] == BACKGROUND:
            ImageDraw.floodfill(im, point, marker, thresh=0)
    data = [(0, 0, 0, 0) if p == marker else p for p in im.getdata()]
    im.putdata(data)

    im = im.crop(im.getbbox())
    side = max(im.size)
    square = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    square.paste(im, ((side - im.width) // 2, (side - im.height) // 2))

    big = square.resize((256, 256), Image.NEAREST)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    big.save(OUT, format="ICO", sizes=[(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)])
    big.save(OUT.with_suffix(".png"))
    print("wrote", OUT)


if __name__ == "__main__":
    main()
