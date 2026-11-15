from collections import OrderedDict
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock
from uuid import uuid4
import json

from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from .assistant import router as assistant_router
from .navigation_review import review_routes
from .hirise import HiRiseTerrain
from .routing import LIMITATIONS, Plan, Point, RouteError, Terrain, alternatives

from .saved_missions import Comparison, MissionStore, saved_mission_router


ROOT = Path(__file__).resolve().parents[2]
METADATA = ROOT / "data/metadata"
catalogue = json.loads((METADATA / "catalogue.json").read_text())
layers = json.loads((METADATA / "layers.json").read_text())
features = catalogue["features"] + json.loads((METADATA / "globe_features.json").read_text())
layers += json.loads((METADATA / "static_layers.json").read_text())
try:
    terrain = Terrain.load(ROOT / "data/processed")
except (OSError, ValueError, KeyError):
    terrain = None

try:
    hirise = HiRiseTerrain.load(ROOT / "data/processed")
except (OSError, ValueError, KeyError):
    hirise = None

hirise_source = {
    "id": "hirise-sulfate", "name": "HiRISE Gale sulfate beds", "source": "NASA PDS / University of Arizona",
    "url": "https://www.uahirise.org/dtm/dtm.php?ID=ESP_012907_1745",
    "coverage": "260 m Gale sulfate beds crop", "resolution": "1.012 m native posting",
    "bounds": hirise.bounds if hirise else None, "status": "available" if hirise else "unavailable",
    "crs": "Mars equirectangular, planetocentric, east positive",
    "description": "Stereo-derived areoid elevations and matching orthorectified red-band imagery.",
    "attribution": "NASA/JPL-Caltech/University of Arizona",
}


def terrain_for_plan(plan):
    if hirise:
        try:
            hirise.cell(plan.start)
            hirise.cell(plan.destination)
            return hirise
        except RouteError:
            pass
    return terrain


terrain_source = {
    "id": "mola-dem", "name": "MOLA MEGDR topography", "source": "NASA PDS Geosciences Node",
    "url": "https://pds-geosciences.wustl.edu/mgs/mgs-m-mola-5-megdr-l3-v1/mgsl_300x/meg128/megt00n090hb.img",
    "coverage": "Bundled Gale Crater crop", "bounds": terrain.bounds if terrain else None,
    "status": "available" if terrain else "unavailable",
    "crs": "IAU2000 planetocentric, east-positive, simple cylindrical", "resolution": "128 pixels/degree (~463 m)",
    "description": "Archived MGS laser altimetry binned or interpolated onto a geographic grid.",
    "attribution": "NASA/GSFC MGS MOLA Team, NASA PDS Geosciences Node",
}
app = FastAPI(title="Aerosmith MEOS")
app.include_router(assistant_router)
cache = OrderedDict()
lock = Lock()


class ExportRequest(BaseModel):
    request: Plan
    strategy: str


@app.get("/api/health")
def health():
    return {"status": "ok", "terrain": terrain is not None}


@app.get("/api/data-sources")
def sources():
    extra = json.loads((METADATA / "references.json").read_text())
    return [*layers, terrain_source, hirise_source, *extra]


@app.get("/api/map/layers")
def map_layers():
    return layers


@app.get("/api/locations")
def locations():
    return [feature for feature in features if feature["coordinate"]]


@app.get("/api/science/features")
def science():
    return features


@app.get("/api/science/features/{feature_id}")
def feature_details(feature_id: str):
    for feature in features:
        if feature["id"] == feature_id:
            return {**feature, "observations": [item for item in catalogue["images"] if item["featureId"] == feature_id]}
    raise HTTPException(404, "Science feature not found.")


@app.get("/api/missions")
def missions():
    return catalogue["missions"]


@app.get("/api/images")
def images(mission: str | None = None):
    return [image for image in catalogue["images"] if mission is None or image["mission"] == mission]


def calculate(plan: Plan):
    grid = terrain_for_plan(plan)
    if grid is None:
        raise HTTPException(503, "Gale elevation grid is unavailable. Terrain routing requires the archived MOLA crop.")
    identity = uuid4().hex
    try:
        routes, unavailable = alternatives(grid, plan, features, identity)
    except RouteError as error:
        raise HTTPException(422, str(error)) from error
    advisory = "No routes meet the configured settings."
    if routes:
        shortest = min(routes, key=lambda route: route.distance_m)
        gentlest = min(routes, key=lambda route: route.max_segment_grade_deg)
        advisory = (f"{shortest.strategy.title()} has the shortest mapped distance. "
                    f"{gentlest.strategy.title()} has the lowest peak sampled segment grade "
                    f"({gentlest.max_segment_grade_deg:.1f}°) among these alternatives.")
    limits = LIMITATIONS
    if grid is hirise:
        limits = ["HiRISE stereo elevations have approximately 1 m posting. Posting is not absolute accuracy.",
                  "Routes snap to cell centers; sampled edge grade does not capture every obstacle.",
                  *LIMITATIONS[3:]]
    if plan.terrain_screening:
        limits = [*limits, "Terrain screening checks diagonal flanks and penalizes climbing and steep neighboring cells."]
    return Comparison(id=identity, request=plan, routes=routes, unavailable=unavailable, limits=limits, advisory=advisory)


@app.post("/api/routes/multi")
def routes(plan: Plan) -> Comparison:
    comparison = calculate(plan)
    with lock:
        cache[comparison.id] = comparison
        if len(cache) > 32:
            cache.popitem(last=False)
    return comparison


@app.get("/api/routes/{route_id}/profile")
def profile(route_id: str):
    with lock:
        comparison = cache.get(route_id.partition("-")[0])
    if comparison:
        for route in comparison.routes:
            if route.id == route_id:
                return route.profile
    raise HTTPException(404, "Route profile expired or was not found. Compute the route again.")


def scoring(comparison):
    base = "8-neighbor spherical A*. Edge cost starts with horizontal distance weighted by squared rise/run."
    if comparison.request.terrain_screening:
        return base + " Extra penalties account for climbing and steep neighboring terrain."
    return base


@app.post("/api/mission/export")
def export(payload: ExportRequest):
    comparison = calculate(payload.request)
    selected = next((route for route in comparison.routes if route.strategy == payload.strategy), None)
    if selected is None:
        raise HTTPException(422, "Selected strategy is unavailable for these inputs.")
    now = datetime.now(timezone.utc)
    body = {
        "schema_version": 1,
        "project": "Aerosmith Mars Exploration Operations System",
        "classification": "Educational prototype",
        "exported_at": now.isoformat(),
        "region": "Gale Crater, Mars",
        "input": comparison.request.model_dump(),
        "selected_route": selected.model_dump(),
        "alternatives": [route.model_dump() for route in comparison.routes if route != selected],
        "unavailable": comparison.unavailable,
        "science_features": [f for f in features if any(f["id"] in route.poi_ids for route in comparison.routes)],
        "datasets": [routing_provenance(comparison)["dataset"]],
        "scoring": scoring(comparison),
        "terrain_metadata": routing_provenance(comparison)["terrain_metadata"],
        "limitations": comparison.limits,
    }
    filename = now.strftime("AEROSMITH_MARS_EVA_MANIFEST_%Y%m%d_%H%M.json")
    return JSONResponse(body, headers={"Content-Disposition": f'attachment; filename="{filename}"'})


@app.get("/api/map/traverse")
def historical_traverse():
    return json.loads((METADATA / "curiosity_traverse.json").read_text())


def cached_comparison(comparison_id: str) -> Comparison | None:
    with lock:
        return cache.get(comparison_id)


def routing_provenance(comparison=None):
    local = hirise and comparison and any(route.terrain_id == hirise.terrain_id for route in comparison.routes)
    return {
        "dataset": hirise_source if local else terrain_source,
        "terrain_metadata": hirise.metadata if local else json.loads((ROOT / "data/processed/gale-mola.json").read_text()),
        "scoring": scoring(comparison),
    }


@app.post("/api/routes/{comparison_id}/review")
async def review_comparison(comparison_id: str):
    comparison = cached_comparison(comparison_id)
    if comparison is None:
        raise HTTPException(404, "Calculate routes again to review them with the API.")
    return await review_routes(comparison)


mission_store = MissionStore(ROOT / "backend/storage/saved_missions", cached_comparison, routing_provenance, calculate)
app.include_router(saved_mission_router(mission_store))


@app.get("/api/terrain/gale")
def gale_terrain():
    if terrain is None:
        raise HTTPException(503, "Gale elevation grid is unavailable.")
    return {
        "bounds": terrain.bounds, "width": terrain.width, "height": terrain.height,
        "nodata": terrain.nodata, "heights": list(terrain.samples),
        "source": terrain_source,
    }


@app.get("/api/terrain/hirise")
def hirise_terrain():
    if hirise is None:
        raise HTTPException(503, "HiRISE crop is unavailable.")
    return {**hirise.metadata, "nodata": hirise.nodata, "heights": list(hirise.samples), "source": hirise_source,
            "raster": "/rasters/gale-hirise.png"}


@app.get("/api/map/hirise-layers")
def hirise_layers():
    if not hirise:
        return []
    return [
        {**hirise_source, "id": "hirise-image", "name": "HiRISE red-band orthoimage", "raster": "/rasters/gale-hirise.png"},
        {**hirise_source, "id": "hirise-contours", "name": "HiRISE contours · 10 m",
         "raster": "/rasters/gale-hirise-contours.png",
         "description": "Derived contours every 10 m (cyan), with index contours every 50 m (amber). Heights above areoid."},
        {**hirise_source, "id": "hirise-slope", "name": "HiRISE steep terrain", "raster": "/rasters/gale-hirise-slope.png",
         "description": "Derived gradient. Orange opacity increases above 10 degrees; transparent pixels are not certified safe."},
    ]

@app.get("/api/terrain/hirise/sample")
def hirise_sample(lat: float, lon: float):
    if hirise is None:
        raise HTTPException(503, "HiRISE crop is unavailable.")
    if not (-90 <= lat <= 90 and -180 <= lon <= 360):
        raise HTTPException(422, "Invalid Mars coordinates.")
    try:
        cell = hirise.cell(Point(lat=lat, lon=lon))
    except RouteError as error:
        raise HTTPException(404, str(error)) from error
    return {"point": hirise.point(cell), "elevation_m": hirise.height_at(cell),
            "pixel_m": hirise.metadata["pixel_m"], "terrain_id": hirise.terrain_id}
