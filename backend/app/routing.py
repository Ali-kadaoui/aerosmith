from array import array
from dataclasses import dataclass
from functools import lru_cache
from heapq import heappop, heappush
from math import asin, atan2, cos, degrees, floor, inf, radians, sin, sqrt
from pathlib import Path
import hashlib
import json
import sys

from pydantic import BaseModel, ConfigDict, Field


class Point(BaseModel):
    model_config = ConfigDict(frozen=True)
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=360)

    @property
    def east(self):
        return self.lon % 360


class RouteSettings(BaseModel):
    max_grade_deg: float = Field(default=22, gt=0, le=45)
    grade_weight: float = Field(default=8, ge=0, le=50)
    pace_kmh: float | None = Field(default=None, gt=0, le=10)
    waypoint_id: str | None = None
    terrain_screening: bool = False


class Plan(RouteSettings):
    start: Point
    destination: Point


class Sample(BaseModel):
    point: Point
    distance_m: float
    elevation_m: float


class Route(BaseModel):
    id: str
    strategy: str
    terrain_id: str = "mola-dem"
    distance_m: float
    ascent_m: float
    descent_m: float
    net_elevation_m: float
    max_segment_grade_deg: float
    modeled_cost_m: float
    duration_min: float | None
    terrain_weight: float
    waypoint_id: str | None
    poi_ids: list[str]
    profile: list[Sample]


class RouteError(ValueError):
    pass


NEIGHBORS = [(x, y) for x in (-1, 0, 1) for y in (-1, 0, 1) if x or y]
LIMITATIONS = [
    "The 128 pixels/degree MOLA grid includes interpolated cells and cannot resolve local EVA obstacles.",
    "The grade is the elevation difference along a grid edge, not the maximum slope within a cell.",
    "Routes begin and end at the centers of the selected cells. Distances are horizontal arc lengths.",
    "No hazard, radiation, weather, life-support, or surface traction model is applied.",
    "Any duration uses a constant user-entered pace and excludes stops and fieldwork.",
    "Science waypoint coordinates represent published feature centers or landing sites."
]


@dataclass(eq=False)
class Terrain:
    west: float
    north: float
    width: int
    height: int
    density: int
    radius: float
    nodata: int
    samples: array

    @classmethod
    def load(cls, folder: Path):
        meta = json.loads((folder / "gale-mola.json").read_text())
        raw = (folder / "gale-mola.i16").read_bytes()
        if hashlib.sha256(raw).hexdigest() != meta["sha256"]:
            raise ValueError("Gale MOLA raster checksum mismatch")
        heights = array("h")
        heights.frombytes(raw)
        if sys.byteorder == "little":
            heights.byteswap()
        if len(heights) != meta["width"] * meta["height"]:
            raise ValueError("Gale MOLA raster size mismatch")
        return cls(meta["west"], meta["north"], meta["width"], meta["height"],
                   meta["samples_per_degree"], meta["radius_m"], meta["nodata"], heights)

    @property
    def bounds(self):
        return [self.west, self.north - self.height / self.density,
                self.west + self.width / self.density, self.north]

    def cell(self, point):
        x = floor((point.east - self.west) * self.density)
        y = floor((self.north - point.lat) * self.density)
        if not self.contains(x, y):
            raise RouteError("Point is outside the bundled Gale Crater elevation grid.")
        if self.height_at((x, y)) == self.nodata:
            raise RouteError("Point falls in a cell without elevation data.")
        return x, y

    def contains(self, x, y):
        return 0 <= x < self.width and 0 <= y < self.height

    def height_at(self, cell):
        x, y = cell
        return self.samples[y * self.width + x]

    def point(self, cell):
        x, y = cell
        return Point(lon=self.west + (x + .5) / self.density,
                     lat=self.north - (y + .5) / self.density)

    @lru_cache(maxsize=64_000)
    def distance(self, y, ty, dx):
        lat = radians(self.north - (y + .5) / self.density)
        target_lat = radians(self.north - (ty + .5) / self.density)
        dlon = radians(dx / self.density)
        value = sin((lat - target_lat) / 2)**2 + cos(lat) * cos(target_lat) * sin(dlon / 2)**2
        return 2 * self.radius * asin(sqrt(min(1, value)))

    def geometry(self, cell, target):
        x, y = cell
        tx, ty = target
        length = self.distance(y, ty, abs(tx - x))
        delta = self.height_at(target) - self.height_at(cell)
        return length, delta, degrees(atan2(abs(delta), length))


def astar(grid, start, goal, grade_limit, weight, terrain_screening=False):
    @lru_cache(maxsize=32000)
    def nearby_grade(cell):
        x, y = cell
        neighbors = ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1))
        return max((grid.geometry(cell, other)[2] for other in neighbors
                    if grid.contains(*other) and grid.height_at(other) != grid.nodata), default=0)
    queue = [(0, 0, start)]
    previous = {}
    cost_so_far = {start: 0.0}
    while queue:
        _, cost, current = heappop(queue)
        if cost != cost_so_far[current]:
            continue
        if current == goal:
            path = [current]
            while current in previous:
                current = previous[current]
                path.append(current)
            return path[::-1], cost
        x, y = current
        for dx, dy in NEIGHBORS:
            nxt = (x + dx, y + dy)
            if not grid.contains(*nxt) or grid.height_at(nxt) == grid.nodata:
                continue
            if dx and dy and any(grid.height_at(cell) == grid.nodata for cell in ((x + dx, y), (x, y + dy))):
                continue
            distance, delta, grade = grid.geometry(current, nxt)
            if grade > grade_limit:
                continue
            edge_cost = distance * (1 + weight * (delta / distance)**2)
            if terrain_screening:
                if dx and dy:
                    flank_cells = ((x + dx, y), (x, y + dy))
                    if all(max(grid.geometry(current, flank)[2], grid.geometry(flank, nxt)[2]) > grade_limit
                           for flank in flank_cells):
                        continue
                # Add modeled effort for uphill travel and a penalty for steep adjacent terrain.
                exposure = min(2, max(nearby_grade(current), nearby_grade(nxt)) / grade_limit)
                edge_cost += 3 * max(0, delta) + distance * (0.25 + weight / 16) * exposure**2
            score = cost + edge_cost
            if score < cost_so_far.get(nxt, inf):
                previous[nxt] = current
                cost_so_far[nxt] = score
                estimate = grid.distance(nxt[1], goal[1], abs(nxt[0] - goal[0]))
                heappush(queue, (score + estimate, score, nxt))
    return None


def describe(grid, identity, strategy, result, weight, pace, pois, waypoint=None):
    path, cost = result
    distance = ascent = descent = max_grade = 0
    profile = [Sample(point=grid.point(path[0]), distance_m=0, elevation_m=grid.height_at(path[0]))]
    for cell, target in zip(path, path[1:]):
        length, delta, grade = grid.geometry(cell, target)
        distance += length
        ascent += max(0, delta)
        descent += max(0, -delta)
        max_grade = max(max_grade, grade)
        profile.append(Sample(point=grid.point(target), distance_m=round(distance, 2), elevation_m=grid.height_at(target)))
    cells = set(path)
    return Route(id=f"{identity}-{strategy}", strategy=strategy, terrain_id=getattr(grid, "terrain_id", "mola-dem"), distance_m=round(distance, 2),
                 ascent_m=round(ascent, 2), descent_m=round(descent, 2), net_elevation_m=round(ascent - descent, 2),
                 max_segment_grade_deg=round(max_grade, 2), modeled_cost_m=round(cost, 2),
                 duration_min=round(distance * .06 / pace, 2) if pace else None,
                 terrain_weight=weight, waypoint_id=waypoint,
                 poi_ids=[key for key, cell in pois.items() if cell in cells], profile=profile)


def alternatives(grid, plan, features, identity):
    start, goal = grid.cell(plan.start), grid.cell(plan.destination)
    if start == goal:
        raise RouteError("Choose endpoints in different elevation cells (approximately 463 m apart).")
    pois = {}
    for feature in features:
        if feature["coordinate"] and feature["region"] == "Gale Crater":
            try:
                pois[feature["id"]] = grid.cell(Point(**feature["coordinate"]))
            except RouteError:
                continue
    if plan.waypoint_id and plan.waypoint_id not in pois:
        raise RouteError("Choose a documented waypoint inside the Gale elevation grid.")
    routes = []
    unavailable = {}
    for name, weight in [("conservative", plan.grade_weight), ("direct", 0)]:
        result = astar(grid, start, goal, plan.max_grade_deg, weight, plan.terrain_screening)
        if result:
            routes.append(describe(grid, identity, name, result, weight, plan.pace_kmh, pois))
        else:
            unavailable[name] = "No connected route under the selected segment grade limit."
    weight = plan.grade_weight / 2
    candidates = {}
    for key, cell in pois.items():
        if cell in (start, goal) or (plan.waypoint_id and plan.waypoint_id != key):
            continue
        first = astar(grid, start, cell, plan.max_grade_deg, weight, plan.terrain_screening)
        if first:
            second = astar(grid, cell, goal, plan.max_grade_deg, weight, plan.terrain_screening)
            if second:
                candidates[key] = (first[0] + second[0][1:], first[1] + second[1])
    if candidates:
        waypoint = min(candidates, key=lambda key: candidates[key][1])
        routes.append(describe(grid, identity, "science", candidates[waypoint], weight, plan.pace_kmh, pois, waypoint))
    else:
        unavailable["science"] = "No eligible intermediate waypoint can be reached under these settings."
    return routes, unavailable
