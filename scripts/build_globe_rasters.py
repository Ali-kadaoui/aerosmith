"""Build equirectangular display rasters from archived orbital and USGS data.

Run with numpy, Pillow and pyproj installed. See docs/DATA_SOURCES.md for input URLs.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO
import json
from pathlib import Path
from urllib.request import urlopen

import numpy as np
from PIL import Image, ImageDraw
from pyproj import Proj

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "frontend/public/rasters"
SIZE = (4096, 2048)


def stitch(layer, zoom, size, region=None, background=None):
    matrix = layer["matrices"][zoom]
    columns, rows = matrix["size"]
    def fetch(tile):
        x, y = tile
        url = layer["template"].replace("{TileMatrixSet}", layer["matrixSet"]).replace("{TileMatrix}", matrix["id"]).replace("{TileCol}", str(x)).replace("{TileRow}", str(y))
        with urlopen(url, timeout=25) as response:
            return x, y, Image.open(BytesIO(response.read())).convert("RGBA" if region else "RGB")
    if region:
        x0, y0, x1, y1 = region
    else:
        x0, y0, x1, y1 = 0, 0, columns, rows
    image = Image.new("RGBA" if region else "RGB", ((x1-x0)*256, (y1-y0)*256))
    with ThreadPoolExecutor(max_workers=12) as executor:
        for x, y, tile in executor.map(fetch, [(x, y) for y in range(y0, y1) for x in range(x0, x1)]):
            image.paste(tile, ((x-x0)*256, (y-y0)*256))
    if background:
        globe = Image.open(background).convert("RGB")
        gx, gy = round(x0*size[0]/columns), round(y0*size[1]/rows)
        w, h = round(x1*size[0]/columns)-gx, round(y1*size[1]/rows)-gy
        image = image.resize((w,h), Image.Resampling.LANCZOS)
        globe.paste(image, (gx,gy), image)
        return globe
    return image.resize(size, Image.Resampling.LANCZOS)


def mola_rasters(image):
    data = np.fromfile(image, dtype=">i2")
    if data.size != 5760 * 2880 or data.min() < -10000 or data.max() > 25000:
        raise ValueError("Expected the global 16 px/degree MOLA MEGDR topography raster")
    z = np.roll(data.reshape(2880, 5760), 2880, axis=1).astype(np.float32)
    z = np.asarray(Image.fromarray(z).resize(SIZE, Image.Resampling.BILINEAR))
    # Sobel derivatives in texture space, normalized by the local ground spacing.
    left, right = np.roll(z, 1, axis=1), np.roll(z, -1, axis=1)
    north = np.vstack([z[:1], z[:-1]])
    south = np.vstack([z[1:], z[-1:]])
    lateral = np.cos((np.arange(SIZE[1]) + .5) * np.pi / SIZE[1] - np.pi / 2)[:, None]
    spacing = 2 * np.pi * 3396200 / SIZE[0]
    dx = (2*(right-left) + np.roll(north, -1, 1)-np.roll(north, 1, 1)
          + np.roll(south, -1, 1)-np.roll(south, 1, 1))/(8*spacing*np.maximum(lateral,.01))
    dy = (2*(north-south) + np.roll(north-south, -1, 1) + np.roll(north-south, 1, 1))/(8*spacing)
    normals = np.stack([-dx, -dy, np.ones_like(dx)], axis=-1)
    normals /= np.linalg.norm(normals, axis=-1, keepdims=True)
    Image.fromarray(np.rint(127.5*(normals+1)).astype("uint8")).save(OUT/"mars_normal_4k.png", optimize=True)
    heights = [-8200, -5000, -2500, 0, 3500, 9000, 21000]
    colors = [(40,27,74),(68,72,144),(54,137,173),(72,164,126),(199,158,83),(182,86,53),(255,249,234)]
    rgb = np.stack([np.interp(z, heights, list(channel)) for channel in zip(*colors)], axis=-1)
    Image.fromarray(rgb.astype("uint8")).save(OUT/"mars_mola_4k.jpg", quality=88)


def geology(features, style):
    # Paint source rings in Robinson coordinates, preserving holes, then sample in Mars lon/lat.
    source = json.loads(Path(features).read_text())
    metadata = json.loads(Path(style).read_text())
    if len(source.get("features", [])) != 1311 or source.get("exceededTransferLimit"):
        raise ValueError("Expected all 1,311 USGS Global_Geology features")
    renderer = metadata["drawingInfo"]["renderer"]
    colors = {v["value"]: tuple(v["symbol"]["color"][:3]) for v in renderer["uniqueValueInfos"]}
    proj = Proj("+proj=robin +R=3396190")
    xlim, _ = proj(180,0)
    _, ylim = proj(0,90)
    width, height = 6144, 3072
    source_img = Image.new("RGB",(width,height),(29,27,23))
    def pixels(ring):
        return [((x/xlim+1)*width/2,(1-y/ylim)*height/2) for x,y,*_ in ring]
    draw = ImageDraw.Draw(source_img)
    # Draw all outer rings, then any islands/units are filled by the smaller polygons.
    polygons = []
    for feature in source["features"]:
        unit = feature["attributes"]["Unit"]
        for ring in feature["geometry"]["rings"]:
            signed_area = sum(a[0]*b[1]-b[0]*a[1] for a,b in zip(ring,ring[1:]))/2
            if signed_area < 0:
                polygons.append((-signed_area,ring,colors[unit]))
    for _, ring, color in sorted(polygons, key=lambda entry: entry[0], reverse=True):
        draw.polygon(pixels(ring),fill=color)
    src = np.asarray(source_img)
    lon, lat = np.meshgrid(-180+(np.arange(SIZE[0])+.5)*360/SIZE[0],90-(np.arange(SIZE[1])+.5)*180/SIZE[1])
    x, y = proj(lon,lat)
    xx = np.clip(((x/xlim+1)*width/2).astype(int),0,width-1)
    yy = np.clip(((1-y/ylim)*height/2).astype(int),0,height-1)
    Image.fromarray(src[yy,xx]).save(OUT/"layer_usgs_geology.png",optimize=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mola")
    parser.add_argument("--geology", nargs=2, metavar=("FEATURES", "LAYER"))
    parser.add_argument("--tiles", action="store_true")
    args = parser.parse_args()
    OUT.mkdir(exist_ok=True)
    if args.mola:
        mola_rasters(args.mola)
    if args.geology:
        geology(*args.geology)
    if args.tiles:
        layers = {x["id"]: x for x in json.loads((ROOT/"data/metadata/layers.json").read_text())}
        for key, zoom, size in [("mola",3,SIZE),("viking",3,SIZE),("viking",4,(8192,4096)),("hrsc",3,SIZE),("roughness",1,(1024,512))]:
            stitch(layers[key],zoom,size).save(OUT/f"{key}-{size[0]}.jpg",quality=90)
        stitch(layers["ctx"], 8, SIZE, (448,131,455,138), OUT/"hrsc-4096.jpg").save(OUT/"ctx-4096.jpg",quality=90)
