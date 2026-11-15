"""Build the native-grid Gale sulfate beds crop from PDS labels and a byte range.

Inputs: DTM first record, ortho LBL, JP2, and DTM rows 4800–5823 (zero-based).
Verify the HTTP Content-Range before running. Requires NumPy and Pillow/OpenJPEG.
"""
from hashlib import sha256
import json
from math import cos, radians
from pathlib import Path
import re
import sys

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
DTM = "DTEEC_012907_1745_013540_1745_A01"
ORTHO = "ESP_012907_1745_RED_C_01_ORTHO"
BASE = "https://www.uahirise.org/PDS/DTM/ESP/ORB_012900_012999/ESP_012907_1745_ESP_013540_1745"
KEYS = ("MAP_PROJECTION_TYPE", "COORDINATE_SYSTEM_NAME", "POSITIVE_LONGITUDE_DIRECTION",
        "CENTER_LATITUDE", "CENTER_LONGITUDE", "MAP_RESOLUTION", "MAP_SCALE", "MAP_PROJECTION_ROTATION",
        "A_AXIS_RADIUS", "LINE_PROJECTION_OFFSET", "SAMPLE_PROJECTION_OFFSET", "LINES", "LINE_SAMPLES")


def field(label, key):
    return re.search(r"^\s*" + key + r"\s*=\s*([^\r\n<]+)", label, re.M)[1].strip()


def main(folder):
    dem_label = (folder / "dtm.lbl").read_text(encoding="latin1")
    ortho_label = (folder / "ortho.lbl").read_text()
    assert field(dem_label, "PRODUCT_ID").strip('"') == DTM
    assert field(ortho_label, "PRODUCT_ID").strip('"') == ORTHO and DTM in ortho_label
    projection = {key: field(dem_label, key) for key in KEYS}
    assert projection == {key: field(ortho_label, key) for key in KEYS}
    assert projection["MAP_PROJECTION_TYPE"] == '"EQUIRECTANGULAR"'
    assert projection["COORDINATE_SYSTEM_NAME"] == "PLANETOCENTRIC"
    assert projection["POSITIVE_LONGITUDE_DIRECTION"] == "EAST"
    assert float(projection["MAP_PROJECTION_ROTATION"]) == 0
    rows = np.fromfile(folder / "rows.bin", dtype="<f4").reshape(1024, 6457)
    with Image.open(folder / "ortho.jp2") as image:
        assert image.size == (6457, 10921)
        strip = np.asarray(image.crop((0, 4800, 6457, 5824)))
    missing = np.uint32(0xFF7FFFFB)
    dem_valid = np.isfinite(rows) & (rows.view("<u4") != missing)
    image_valid = strip != 0
    x, y, size = 3048, 384, 257
    window = np.s_[y:y+size, x:x+size]
    assert (dem_valid & image_valid)[window].all()
    heights = rows[window].tobytes()
    density = float(projection["MAP_RESOLUTION"])
    center_lat = float(projection["CENTER_LATITUDE"])
    center_lon = float(projection["CENTER_LONGITUDE"])
    dx = 1 / (density * cos(radians(center_lat)))
    dy = 1 / density
    west = center_lon + (x + .5 - float(projection["SAMPLE_PROJECTION_OFFSET"])) * dx
    north = -(4800 + y + .5 - float(projection["LINE_PROJECTION_OFFSET"])) * dy
    meta = dict(id="hirise-sulfate", bounds=[west, north-size*dy, west+size*dx, north],
                width=size, height=size, dx=dx, dy=dy, source_window=[x,4800+y,size,size],
                pixel_m=float(projection["MAP_SCALE"]), radius_m=float(projection["A_AXIS_RADIUS"])*1000,
                dem=DTM, ortho=ORTHO, source=BASE, projection=projection,
                sha256=sha256(heights).hexdigest(), strip_mask_agreement=float((dem_valid == image_valid).mean()))
    output = ROOT / "data/processed"
    assets = ROOT / "frontend/public/rasters"
    (output / "gale-hirise.f32").write_bytes(heights)
    (output / "gale-hirise.json").write_text(json.dumps(meta, indent=2) + "\n")
    Image.fromarray(strip[window]).save(assets / "gale-hirise.png")
    pixels = rows[window]
    gy, gx = np.gradient(pixels, meta["pixel_m"])
    slope = np.degrees(np.arctan(np.hypot(gx, gy)))
    highlights = np.full((*slope.shape, 4), [240, 120, 72, 0], dtype=np.uint8)
    highlights[..., 3] = np.clip((slope - 10) * 5, 0, 210).astype(np.uint8)
    Image.fromarray(highlights).save(assets / "gale-hirise-slope.png")
    print(json.dumps(meta, indent=2))


if __name__ == "__main__":
    main(Path(sys.argv[1]))
