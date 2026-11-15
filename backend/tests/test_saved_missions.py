import json
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest

from app import main
from app.saved_missions import MissionStore, saved_mission_router


DRAFT = {"name": "  Field survey  ", "region": "Gale Crater", "description": "Check the ridge."}
PLAN = {"start": {"lat": -4.62, "lon": 137.38}, "destination": {"lat": -4.94, "lon": 137.59}}


def client_for(directory, resolver=lambda _: None):
    app = FastAPI()
    app.include_router(saved_mission_router(MissionStore(directory, resolver, main.routing_provenance)))
    return TestClient(app)


def test_draft_crud(tmp_path):
    client = client_for(tmp_path / "missions")
    path = "/api/saved-missions"
    assert client.get(path).json() == {"missions": [], "warnings": []}
    response = client.post(path, json=DRAFT)
    assert response.status_code == 201
    created = response.json()
    assert created["name"] == "Field survey"
    assert created["comparison"] is None
    resource = f"{path}/{created['id']}"
    assert client.get(resource).json() == created
    assert client.get(path).json()["missions"][0]["id"] == created["id"]
    update = client.put(resource, json={**DRAFT, "name": "Updated survey"}).json()
    assert update["name"] == "Updated survey"
    assert update["created_at"] == created["created_at"]
    assert update["updated_at"] >= created["updated_at"]
    assert client.delete(resource).status_code == 204
    assert client.get(resource).status_code == 404


def test_calculated_mission_survives_fresh_app_and_empty_cache(tmp_path):
    request = main.Plan(**PLAN, pace_kmh=2)
    result = main.calculate(request)
    client = client_for(tmp_path, lambda identity: result if identity == result.id else None)
    payload = {**DRAFT, **PLAN, "comparison_id": result.id, "selected_strategy": "direct",
               "settings": {"pace_kmh": 2}}
    response = client.post("/api/saved-missions", json=payload)
    assert response.status_code == 201
    saved = response.json()
    file = tmp_path / f"{saved['id']}.json"
    assert json.loads(file.read_text()) == saved
    assert saved["comparison"] == result.model_dump(mode="json")
    assert saved["provenance"]["terrain_metadata"]["sha256"]
    resource = f"/api/saved-missions/{saved['id']}"
    restarted = client_for(tmp_path)
    assert restarted.get(resource).json() == saved
    assert restarted.get("/api/saved-missions").json()["missions"][0]["id"] == saved["id"]
    update = restarted.put(resource, json={**payload, "description": "Edited after restart"})
    assert update.status_code == 200
    assert update.json()["comparison"] == saved["comparison"]
    assert restarted.post("/api/saved-missions", json=payload).status_code == 409


@pytest.mark.parametrize("method", ["get", "put", "delete"])
def test_missing_and_invalid_id(tmp_path, method):
    request = getattr(client_for(tmp_path), method)
    kwargs = {"json": DRAFT} if method == "put" else {}
    assert request("/api/saved-missions/" + "a" * 32, **kwargs).status_code == 404
    assert request("/api/saved-missions/invalid-id", **kwargs).status_code == 400


def test_invalid_and_corrupt_files(tmp_path):
    client = client_for(tmp_path)
    base = "/api/saved-missions"
    assert client.post(base, content="{", headers={"content-type": "application/json"}).status_code == 422
    assert client.post(base, json={**DRAFT, "name": " "}).status_code == 422
    assert client.post(base, json={**DRAFT, "start": {"lat": 99, "lon": 0}}).status_code == 422
    good = client.post(base, json=DRAFT).json()
    broken_id = "b" * 32
    (tmp_path / f"{broken_id}.json").write_text("{")
    assert client.get(f"{base}/{broken_id}").status_code == 409
    assert client.put(f"{base}/{broken_id}", json=DRAFT).status_code == 409
    listing = client.get(base).json()
    assert [mission["id"] for mission in listing["missions"]] == [good["id"]]
    assert len(listing["warnings"]) == 1


def test_failed_atomic_replace_preserves_existing_record(tmp_path):
    client = client_for(tmp_path)
    saved = client.post("/api/saved-missions", json=DRAFT).json()
    resource = f"/api/saved-missions/{saved['id']}"
    with patch("app.saved_missions.os.replace", side_effect=OSError("interrupted")):
        assert client.put(resource, json={**DRAFT, "name": "Replacement"}).status_code == 500
    assert client.get(resource).json() == saved
    assert len(list(tmp_path.iterdir())) == 1


def test_rover_catalogue_and_saved_missions_are_separate():
    client = TestClient(main.app)
    assert [row["name"] for row in client.get("/api/missions").json()] == ["Curiosity", "Perseverance"]
    assert "/api/saved-missions" in client.get("/openapi.json").json()["paths"]


def test_import_exported_manifest_and_duplicate_after_restart(tmp_path):
    export = TestClient(main.app).post("/api/mission/export", json={
        "request": {**PLAN, "waypoint_id": "gediz", "pace_kmh": 2}, "strategy": "science",
    })
    assert export.status_code == 200
    manifest = export.json()
    manifest["selected_route"]["distance_m"] = -1
    app = FastAPI()
    app.include_router(saved_mission_router(MissionStore(tmp_path, lambda _: None, main.routing_provenance, main.calculate)))
    client = TestClient(app)
    response = client.post("/api/saved-missions/import", json=manifest)
    assert response.status_code == 201
    original = response.json()
    assert original["selected_strategy"] == "science"
    assert original["settings"]["pace_kmh"] == 2
    science = next(route for route in original["comparison"]["routes"] if route["strategy"] == "science")
    assert science["distance_m"] > 0 and science["profile"]
    reopened = client_for(tmp_path)
    copy_response = reopened.post(f"/api/saved-missions/{original['id']}/duplicate")
    assert copy_response.status_code == 201
    copy = copy_response.json()
    assert copy["id"] != original["id"] and copy["name"].endswith(" (copy)")
    assert copy["comparison"] == original["comparison"]
    assert reopened.get(f"/api/saved-missions/{original['id']}").json() == original


def test_import_rejects_invalid_manifest_without_writing(tmp_path):
    app = FastAPI()
    app.include_router(saved_mission_router(MissionStore(tmp_path, lambda _: None, main.routing_provenance, main.calculate)))
    client = TestClient(app)
    assert client.post("/api/saved-missions/import", json={"schema_version": 9}).status_code == 422
    assert list(tmp_path.iterdir()) == []


@pytest.mark.parametrize("change", [
    {"max_grade_deg": 1}, {"grade_weight": 5}, {"pace_kmh": 2}, {"waypoint_id": "gediz"},
])
def test_inconsistent_settings_cannot_create_or_overwrite_snapshot(tmp_path, change):
    result = main.calculate(main.Plan(**PLAN))
    client = client_for(tmp_path, lambda identity: result if identity == result.id else None)
    path = "/api/saved-missions"
    payload = {**DRAFT, **PLAN, "comparison_id": result.id, "selected_strategy": "direct"}
    invalid = {**payload, "settings": change}
    assert client.post(path, json=invalid).status_code == 422
    saved = client.post(path, json=payload).json()
    resource = f"{path}/{saved['id']}"
    assert client.put(resource, json=invalid).status_code == 422
    assert client.get(resource).json() == saved


def test_hirise_mission_preserves_elevation_provenance_after_restart(tmp_path):
    grid = main.hirise
    plan = main.Plan(start=grid.point((166, 205)), destination=grid.point((180, 51)), max_grade_deg=30)
    comparison = main.calculate(plan)
    client = client_for(tmp_path, lambda _: comparison)
    request = plan.model_dump()
    payload = {**DRAFT, "start": request.pop("start"), "destination": request.pop("destination"),
               "settings": request, "comparison_id": comparison.id, "selected_strategy": "direct"}
    response = client.post("/api/saved-missions", json=payload)
    assert response.status_code == 201
    saved = response.json()
    assert saved["provenance"]["dataset"]["id"] == "hirise-sulfate"
    assert client_for(tmp_path).get(f"/api/saved-missions/{saved['id']}").json() == saved
