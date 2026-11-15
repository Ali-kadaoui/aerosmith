from array import array
from functools import lru_cache
from hashlib import sha256
import json
from math import asin, cos, floor, isfinite, radians, sin, sqrt
import sys

from .routing import Point, RouteError, Terrain


class HiRiseTerrain(Terrain):
    terrain_id = "hirise-sulfate"

    @classmethod
    def load(cls, folder):
        metadata = json.loads((folder / "gale-hirise.json").read_text())
        raw = (folder / "gale-hirise.f32").read_bytes()
        if sha256(raw).hexdigest() != metadata["sha256"]:
            raise ValueError("HiRISE crop checksum mismatch")
        samples = array("f", raw)
        if sys.byteorder != "little":
            samples.byteswap()
        west, _, _, north = metadata["bounds"]
        width, height = metadata["width"], metadata["height"]
        if len(samples) != width * height or any(not isfinite(z) or abs(z) > 10000 for z in samples):
            raise ValueError("Invalid samples in fully covered HiRISE crop")
        grid = cls(west, north, width, height, 0, metadata["radius_m"], -32768, samples)
        grid.metadata = metadata
        grid.dx, grid.dy = metadata["dx"], metadata["dy"]
        return grid

    @property
    def bounds(self):
        return self.metadata["bounds"]

    def cell(self, point):
        x = floor((point.east - self.west) / self.dx)
        y = floor((self.north - point.lat) / self.dy)
        if not self.contains(x, y):
            raise RouteError("Point is outside the HiRISE demonstration crop.")
        return x, y

    def point(self, cell):
        x, y = cell
        return Point(lon=self.west + (x + .5) * self.dx, lat=self.north - (y + .5) * self.dy)

    @lru_cache(maxsize=64000)
    def distance(self, y, ty, dx):
        a = radians(self.north - (y + .5) * self.dy)
        b = radians(self.north - (ty + .5) * self.dy)
        h = sin((a-b)/2)**2 + cos(a)*cos(b)*sin(radians(dx*self.dx)/2)**2
        return 2*self.radius*asin(sqrt(min(1, h)))
