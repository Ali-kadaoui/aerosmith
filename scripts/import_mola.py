"""Crop preserved PDS samples. Input can be the full tile or verified complete rows."""
import argparse
import hashlib
import json
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("image", type=Path)
parser.add_argument("--first-row", type=int, default=0)
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
stride = 23040
row, col = 448, 5888   # 3.5°S, 136°E, pixel outer edges
height, width = 288, 352
size = args.image.stat().st_size
if args.first_row < 0 or args.first_row > row or size % stride or size // stride + args.first_row < row + height or size // stride + args.first_row > 5632:
    parser.error("Input must contain complete PDS rows covering the Gale crop")
with args.image.open("rb") as source:
    crop = bytearray()
    for y in range(row, row + height):
        source.seek((y - args.first_row) * stride + col * 2)
        crop.extend(source.read(width * 2))
output = root / "data/processed"
output.mkdir(parents=True, exist_ok=True)
(output / "gale-mola.i16").write_bytes(crop)
(output / "gale-mola.json").write_text(json.dumps({
    "west": 136, "north": -3.5, "width": width, "height": height,
    "samples_per_degree": 128, "radius_m": 3396000, "nodata": -32768,
    "source_id": "mola-dem", "vertical_datum": "GMM3 areoid",
    "source_rows": [row, row + height - 1], "source_columns": [col, col + width - 1],
    "sha256": hashlib.sha256(crop).hexdigest()
}, indent=2) + "\n")
