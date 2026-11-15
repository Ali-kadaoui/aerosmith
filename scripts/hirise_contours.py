"""Draw derived 10 m contours on the native HiRISE pixel grid."""
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]


def draw_contours(heights, interval=10, scale=4):
    height, width = heights.shape
    image = Image.new("RGBA", (width * scale, height * scale))
    draw = ImageDraw.Draw(image)
    for row in range(height - 1):
        for col in range(width - 1):
            corners = [(col, row), (col, row + 1), (col + 1, row), (col + 1, row + 1)]
            for triangle in ((0, 1, 2), (2, 1, 3)):
                vertices = [(x, y, float(heights[y, x])) for x, y in (corners[i] for i in triangle)]
                values = [z for _, _, z in vertices]
                if not all(np.isfinite(z) and abs(z) < 10000 for z in values):
                    continue
                for level in range((int(np.floor(min(values) / interval)) + 1) * interval,
                                   int(np.floor(max(values) / interval)) * interval + 1, interval):
                    points = []
                    for a, b in zip(vertices, vertices[1:] + vertices[:1]):
                        if min(a[2], b[2]) < level <= max(a[2], b[2]):
                            t = (level - a[2]) / (b[2] - a[2])
                            points.append(tuple((a[i] + t * (b[i] - a[i]) + .5) * scale for i in (0, 1)))
                    if len(points) == 2:
                        major = level % 50 == 0
                        draw.line(points, fill=(255, 220, 134, 255) if major else (110, 225, 235, 220),
                                  width=3 if major else 2)
    return image


if __name__ == "__main__":
    folder = ROOT / "data/processed"
    meta = json.loads((folder / "gale-hirise.json").read_text())
    heights = np.fromfile(folder / "gale-hirise.f32", dtype="<f4").reshape(meta["height"], meta["width"])
    draw_contours(heights).save(ROOT / "frontend/public/rasters/gale-hirise-contours.png", optimize=True)
