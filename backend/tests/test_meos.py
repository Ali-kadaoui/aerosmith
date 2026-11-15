from array import array

from fastapi.testclient import TestClient
import pytest

from app import main
from app.routing import Point, Terrain, astar

client = TestClient(main.app)
EXAMPLE = {
    "start": {"lat": -4.62, "lon": 137.38},
    "destination": {"lat": -4.94, "lon": 137.59},
    "waypoint_id": "gediz",
}


def test_astar_detours_around_known_steep_cell():
    grid = Terrain(0, 3, 3, 3, 1, 3396000, -32768, array("h", [0, 0, 0, 0, 80000 // 3, 0, 0, 0, 0]))
    path, score = astar(grid, (0, 1), (2, 1), 20, 0)
    assert (1, 1) not in path
    assert path[0] == (0, 1) and path[-1] == (2, 1)
    assert score > grid.distance(1, 1, 2)


def test_nodata_blocks_diagonal_corner():
    grid = Terrain(0, 2, 2, 2, 1, 3396000, -32768, array("h", [0, -32768, -32768, 0]))
    assert astar(grid, (0, 0), (1, 1), 20, 1) is None


def test_terrain_screening_blocks_diagonal_between_two_steep_flanks():
    grid = Terrain(0, 1, 2, 2, 128, 3396000, -32768, array("h", [0, 500, 500, 0]))
    assert astar(grid, (0, 0), (1, 1), 15, 8) is not None
    assert astar(grid, (0, 0), (1, 1), 15, 8, terrain_screening=True) is None


def test_terrain_georeferencing():
    grid = main.terrain
    assert grid.bounds == [136, -5.75, 138.75, -3.5]
    point = Point(**main.features[1]["coordinate"])
    cell = grid.cell(point)
    assert grid.height_at(cell) == pytest.approx(-4500, abs=100)
    assert grid.cell(grid.point(cell)) == cell


def test_registry_and_science():
    assert client.get("/api/health").json() == {"status": "ok", "terrain": True}
    layers = client.get("/api/map/layers").json()
    assert {layer["id"] for layer in layers} == {"ctx", "hrsc", "mola", "roughness", "viking", "geology", "elevation"}
    assert all(layer["matrices"][0]["size"] == [2, 1] for layer in layers if "matrices" in layer)
    assert any(s["id"] == "mola-dem" for s in client.get("/api/data-sources").json())
    boxwork = client.get("/api/science/features/boxwork").json()
    assert boxwork["coordinate"] is None
    assert boxwork["observations"][0]["id"] == "PIA26559"
    assert client.get("/api/science/features/missing").status_code == 404
    assert all(x["region"] == "Jezero Crater" for x in client.get("/api/images?mission=Perseverance").json())


def test_routes_profile_and_configurable_duration():
    response = client.post("/api/routes/multi", json={**EXAMPLE, "pace_kmh": 2})
    assert response.status_code == 200
    a, b, c = response.json()["routes"]
    assert b["distance_m"] <= a["distance_m"]
    assert a["max_segment_grade_deg"] < b["max_segment_grade_deg"]
    assert c["waypoint_id"] == "gediz" and "gediz" in c["poi_ids"]
    assert c["duration_min"] == pytest.approx(c["distance_m"] * .03, abs=.01)
    assert c["profile"][-1]["distance_m"] == c["distance_m"]
    assert client.get(f"/api/routes/{c['id']}/profile").json() == c["profile"]


@pytest.mark.parametrize("updates", [
    {"start": {"lat": 91, "lon": 137}},
    {"start": {"lat": 18.44, "lon": 77.45}},
    {"destination": EXAMPLE["start"]},
    {"waypoint_id": "boxwork"},
    {"pace_kmh": 0},
])
def test_invalid_input(updates):
    assert client.post("/api/routes/multi", json={**EXAMPLE, **updates}).status_code == 422


def test_missing_data(monkeypatch):
    monkeypatch.setattr(main, "terrain", None)
    assert client.get("/api/health").json()["terrain"] is False
    assert client.post("/api/routes/multi", json=EXAMPLE).status_code == 503


def test_no_path_under_grade_limit():
    response = client.post("/api/routes/multi", json={**EXAMPLE, "max_grade_deg": .00001})
    assert response.status_code == 200
    assert response.json()["routes"] == []
    assert set(response.json()["unavailable"]) == {"conservative", "direct", "science"}


def test_manifest():
    response = client.post("/api/mission/export", json={"request": EXAMPLE, "strategy": "science"})
    assert response.status_code == 200
    assert "AEROSMITH_MARS_EVA_MANIFEST_" in response.headers["content-disposition"]
    manifest = response.json()
    assert manifest["selected_route"]["strategy"] == "science"
    assert manifest["selected_route"]["duration_min"] is None
    assert len(manifest["alternatives"]) == 2
    assert manifest["terrain_metadata"]["sha256"]
    assert any(f["id"] == "gediz" for f in manifest["science_features"])


def test_global_context_and_archive():
    locations = client.get("/api/locations").json()
    assert len([row for row in locations if row["category"] == "Landmark"]) == 12
    assert len([row for row in locations if row["category"] in {"Landing site", "Impact site"}]) == 11
    assert next(row for row in locations if row["id"] == "schiaparelli")["category"] == "Impact site"
    track = client.get("/api/map/traverse").json()
    assert track["firstSol"] == 3
    assert any(stop["sol"] >= 4100 for stop in track["waypoints"])
    assert len(track["paths"]) > 1000
    assert track["paths"][0][0] == pytest.approx([137.441633, -4.589467])


def test_viewer_uses_same_grid_as_route_and_missing_data_is_explicit(monkeypatch):
    grid = main.terrain
    response = client.get("/api/terrain/gale")
    assert response.status_code == 200
    payload = response.json()
    assert payload["bounds"] == grid.bounds
    assert len(payload["heights"]) == grid.width * grid.height
    route = main.calculate(main.Plan(**EXAMPLE)).routes[0]
    for sample in route.profile:
        x, y = grid.cell(sample.point)
        assert payload["heights"][y * payload["width"] + x] == sample.elevation_m
    monkeypatch.setattr(main, "terrain", None)
    assert client.get("/api/terrain/gale").status_code == 503


@pytest.mark.parametrize("lat,lon", [(-5.75, 137), (-3.4999, 137), (-4, 138.75), (-4, 135.9999)])
def test_outside_grid_edges(lat, lon):
    from app.routing import RouteError
    with pytest.raises(RouteError):
        main.terrain.cell(Point(lat=lat, lon=lon))


def test_hirise_native_grid_routing_and_fallback():
    grid = main.hirise
    assert grid is not None
    assert (grid.width, grid.height) == (257, 257)
    assert grid.metadata["source_window"] == [3048, 5184, 257, 257]
    assert grid.metadata["strip_mask_agreement"] > .998
    assert grid.cell(grid.point((0, 0))) == (0, 0)
    assert grid.cell(grid.point((256, 256))) == (256, 256)
    plan = main.Plan(start=grid.point((166, 205)), destination=grid.point((180, 51)), max_grade_deg=30)
    comparison = main.calculate(plan)
    assert {route.strategy for route in comparison.routes} == {"direct", "conservative"}
    for route in comparison.routes:
        assert route.terrain_id == grid.terrain_id
        assert route.max_segment_grade_deg <= 30
        assert all(grid.height_at(grid.cell(sample.point)) == sample.elevation_m for sample in route.profile)
    assert main.terrain_for_plan(main.Plan(**EXAMPLE)) is main.terrain
    assert main.terrain_for_plan(plan.model_copy(update={"destination": Point(lat=-4.94, lon=137.59)})) is main.terrain
    assert main.routing_provenance(comparison)["terrain_metadata"]["sha256"] == grid.metadata["sha256"]
    assert client.get("/api/terrain/hirise").json()["heights"][0] == grid.samples[0]
    exported = client.post("/api/mission/export", json={"request": plan.model_dump(), "strategy": "direct"})
    assert exported.status_code == 200
    assert exported.json()["datasets"][0]["id"] == grid.terrain_id


def test_hirise_sample_reports_native_post_and_coverage(monkeypatch):
    grid = main.hirise
    point = grid.point((128, 128))
    response = client.get("/api/terrain/hirise/sample", params=point.model_dump())
    assert response.status_code == 200
    assert response.json()["point"] == point.model_dump()
    assert response.json()["elevation_m"] == grid.height_at((128, 128))
    assert response.json()["pixel_m"] == pytest.approx(1.012, abs=.001)
    assert client.get("/api/terrain/hirise/sample?lat=-4.9&lon=137").status_code == 404
    assert client.get("/api/terrain/hirise/sample?lat=91&lon=137").status_code == 422
    assert any(layer["id"] == "hirise-contours" for layer in client.get("/api/map/hirise-layers").json())
    monkeypatch.setattr(main, "hirise", None)
    assert client.get("/api/terrain/hirise/sample", params=point.model_dump()).status_code == 503
