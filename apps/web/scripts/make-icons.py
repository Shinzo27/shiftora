"""Rasterise the Shiftora mark into PWA icons.

Run once when the mark changes (needs Pillow: `pip install pillow`):

    python apps/web/scripts/make-icons.py

The mark is the same 32x32 SVG as `public/favicon.svg` and `components/logo.tsx`, drawn here
from its path data so the PNGs are the real logo rather than a font approximation. Sizes follow
what an installed Android/Chrome app and iOS home screen ask for.
"""

from __future__ import annotations

import math
import re
from pathlib import Path

from PIL import Image, ImageDraw

BRAND = (15, 118, 110, 255)  # #0f766e, the same token as --brand in index.css
WHITE = (255, 255, 255, 255)
OUT = Path(__file__).resolve().parents[1] / "public" / "icons"

# The S from favicon.svg (viewBox 0 0 32 32).
S_PATH = (
    "M9 12.5c0-2 1.8-3.5 4.5-3.5H22v3.5h-8.2c-.6 0-.8.3-.8.6 0 .4.3.6.8.7l4.6.7"
    "c2.6.4 4.6 1.7 4.6 4.3 0 2.6-2.1 4.2-5 4.2H9v-3.5h8.8c.7 0 1-.3 1-.7 0-.4-.3-.6-1-.7"
    "l-4.4-.7C10.8 17.1 9 15.6 9 12.5Z"
)

TOKEN = re.compile(r"[MmLlHhVvCcZz]|-?\d*\.?\d+")


def flatten(path: str, steps: int = 24) -> list[tuple[float, float]]:
    """Turn the path into a polygon. Only the commands the mark uses are implemented."""
    tokens = TOKEN.findall(path)
    points: list[tuple[float, float]] = []
    x = y = 0.0
    start = (0.0, 0.0)
    command = ""
    index = 0

    def numbers(count: int) -> list[float]:
        nonlocal index
        values = [float(tokens[index + i]) for i in range(count)]
        index += count
        return values

    while index < len(tokens):
        token = tokens[index]
        if token.isalpha():
            command = token
            index += 1
            if command in "Zz":
                points.append(start)
            continue

        if command in "Mm":
            dx, dy = numbers(2)
            x, y = (dx, dy) if command == "M" else (x + dx, y + dy)
            start = (x, y)
            points.append((x, y))
            command = "L" if command == "M" else "l"
        elif command in "Ll":
            dx, dy = numbers(2)
            x, y = (dx, dy) if command == "L" else (x + dx, y + dy)
            points.append((x, y))
        elif command in "Hh":
            (value,) = numbers(1)
            x = value if command == "H" else x + value
            points.append((x, y))
        elif command in "Vv":
            (value,) = numbers(1)
            y = value if command == "V" else y + value
            points.append((x, y))
        elif command in "Cc":
            c = numbers(6)
            absolute = command == "C"
            p0 = (x, y)
            p1 = (c[0], c[1]) if absolute else (x + c[0], y + c[1])
            p2 = (c[2], c[3]) if absolute else (x + c[2], y + c[3])
            p3 = (c[4], c[5]) if absolute else (x + c[4], y + c[5])
            for step in range(1, steps + 1):
                t = step / steps
                mt = 1 - t
                points.append(
                    (
                        mt**3 * p0[0] + 3 * mt**2 * t * p1[0] + 3 * mt * t**2 * p2[0] + t**3 * p3[0],
                        mt**3 * p0[1] + 3 * mt**2 * t * p1[1] + 3 * mt * t**2 * p2[1] + t**3 * p3[1],
                    )
                )
            x, y = p3
        else:  # pragma: no cover - a new command in the mark must be handled above
            raise ValueError(f"unsupported path command {command!r}")

    return points


def render(size: int, inset: float = 0.0) -> Image.Image:
    """The mark on a transparent tile; `inset` shrinks it for Android's maskable safe zone."""
    scale = 4  # supersample, then downsample: no jagged edges at 48-192 px
    canvas = size * scale
    image = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)

    pad = canvas * inset
    box = canvas - 2 * pad
    unit = box / 32
    radius = 8 * unit
    draw.rounded_rectangle([pad, pad, pad + box, pad + box], radius=radius, fill=BRAND)

    polygon = [((pad + px * unit), (pad + py * unit)) for px, py in flatten(S_PATH)]
    draw.polygon(polygon, fill=WHITE)
    return image.resize((size, size), Image.LANCZOS)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    # Installable: Chrome asks for 192 and 512, iOS for 180 (it rounds the corners itself).
    render(192).save(OUT / "icon-192.png")
    render(512).save(OUT / "icon-512.png")
    # Maskable: Android crops to a circle, so keep the mark inside the middle 80%.
    maskable = Image.new("RGBA", (512, 512), BRAND)
    maskable.alpha_composite(render(512, inset=0.1))
    maskable.save(OUT / "icon-maskable-512.png")
    # Apple: opaque, no transparency (iOS paints transparency black).
    apple = Image.new("RGBA", (180, 180), BRAND)
    apple.alpha_composite(render(180))
    apple.convert("RGB").save(OUT / "apple-touch-icon.png")

    for path in sorted(OUT.iterdir()):
        print(path.name, path.stat().st_size, "bytes")


if __name__ == "__main__":
    main()
