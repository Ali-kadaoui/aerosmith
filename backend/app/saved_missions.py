from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
from tempfile import NamedTemporaryFile
from threading import Lock
from typing import Literal
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel, Field, ValidationError, field_validator, model_validator

from .routing import Plan, Point, Route, RouteSettings


class Comparison(BaseModel):
    id: str
    request: Plan
    routes: list[Route]
    unavailable: dict[str, str]
    limits: list[str]
    advisory: str


Strategy = Literal["conservative", "direct", "science"]


class MissionDetails(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=2000)
    region: Literal["Gale Crater", "Jezero Crater"]
    start: Point | None = None
    destination: Point | None = None
    settings: RouteSettings = Field(default_factory=RouteSettings)
    selected_strategy: Strategy | None = None

    @field_validator("name", mode="before")
    @classmethod
    def trim_name(cls, value):
        return value.strip() if isinstance(value, str) else value


class MissionWrite(MissionDetails):
    comparison_id: str | None = Field(default=None, pattern=r"^[a-f0-9]{32}$")

    @model_validator(mode="after")
    def validate_route_reference(self):
        if self.selected_strategy and not self.comparison_id:
            raise ValueError("A selected strategy requires a route comparison.")
        return self


class SavedMission(MissionDetails):
    schema_version: Literal[1] = 1
    id: str = Field(pattern=r"^[a-f0-9]{32}$")
    created_at: datetime
    updated_at: datetime
    comparison: Comparison | None = None
    provenance: dict | None = None

    @model_validator(mode="after")
    def validate_snapshot(self):
        if self.comparison:
            if self.region != "Gale Crater" or (
                self.start != self.comparison.request.start
                or self.destination != self.comparison.request.destination
            ):
                raise ValueError("Route comparison does not match the mission endpoints or region.")
        if self.selected_strategy and (
            not self.comparison or not any(route.strategy == self.selected_strategy for route in self.comparison.routes)
        ):
            raise ValueError("Selected strategy is unavailable in this comparison.")
        return self


class ManifestSelection(BaseModel):
    strategy: Strategy


class ManifestImport(BaseModel):
    schema_version: Literal[1]
    project: Literal["Aerosmith Mars Exploration Operations System"]
    region: Literal["Gale Crater, Mars"]
    input: Plan
    selected_route: ManifestSelection
    name: str = Field(default="Imported Gale mission", min_length=1, max_length=120, pattern=r"\S")
    description: str = Field(default="", max_length=2000)


class MissionSummary(BaseModel):
    id: str
    name: str
    description: str
    region: str
    updated_at: datetime
    selected_strategy: Strategy | None


class MissionIndex(BaseModel):
    missions: list[MissionSummary]
    warnings: list[str]


class MissionStore:
    def __init__(self, directory, resolve_comparison, provenance, calculate=None):
        self.directory = directory
        self.resolve_comparison = resolve_comparison
        self.provenance = provenance
        self.calculate = calculate
        self.lock = Lock()

    def path(self, mission_id):
        if not re.fullmatch(r"[a-f0-9]{32}", mission_id):
            raise HTTPException(400, "Invalid mission ID.")
        path = self.directory / f"{mission_id}.json"
        if path.is_symlink():
            raise HTTPException(409, "Saved mission file is invalid.")
        return path

    def _read(self, path):
        try:
            mission = SavedMission.model_validate(json.loads(path.read_bytes()))
            if mission.id != path.stem:
                raise ValueError("Filename does not match mission ID")
            return mission
        except FileNotFoundError as error:
            raise HTTPException(404, "Saved mission not found.") from error
        except ValueError as error:
            raise HTTPException(409, "Saved mission file is corrupted.") from error

    def get(self, mission_id):
        with self.lock:
            return self._read(self.path(mission_id))

    def list(self):
        missions, warnings = [], []
        with self.lock:
            self.directory.mkdir(parents=True, exist_ok=True)
            for path in self.directory.glob("*.json"):
                try:
                    mission = self._read(self.path(path.stem))
                except HTTPException as error:
                    warnings.append(f"{path.name}: {error.detail}")
                    continue
                missions.append(MissionSummary.model_validate(mission, from_attributes=True))
        missions.sort(key=lambda mission: mission.updated_at, reverse=True)
        return MissionIndex(missions=missions, warnings=warnings)

    def save(self, payload, mission_id=None):
        with self.lock:
            path = self.path(mission_id if mission_id is not None else uuid4().hex)
            previous = self._read(path) if mission_id is not None else None
            comparison = provenance = None
            if payload.comparison_id:
                if previous and previous.comparison and previous.comparison.id == payload.comparison_id:
                    comparison, provenance = previous.comparison, previous.provenance
                else:
                    comparison = self.resolve_comparison(payload.comparison_id)
                    if comparison is None:
                        raise HTTPException(409, "Route comparison expired. Compare routes again before saving.")
                    provenance = self.provenance(comparison)
            if comparison and payload.settings.model_dump() != comparison.request.model_dump(exclude={"start", "destination"}):
                raise HTTPException(422, "Mission settings differ from the calculated route. Compare routes again before saving.")
            now = datetime.now(timezone.utc)
            try:
                mission = SavedMission(
                    **payload.model_dump(exclude={"comparison_id"}), id=path.stem,
                    created_at=previous.created_at if previous else now, updated_at=now,
                    comparison=comparison, provenance=provenance,
                )
            except ValidationError as error:
                raise HTTPException(422, error.errors()[0]["msg"]) from error
            self._write(path, mission)
            return mission

    def _write(self, path, mission):
        self.directory.mkdir(parents=True, exist_ok=True)
        temporary = None
        try:
            with NamedTemporaryFile(mode="w", encoding="utf-8", dir=self.directory, delete=False) as output:
                temporary = Path(output.name)
                json.dump(mission.model_dump(mode="json"), output, ensure_ascii=False, indent=2, allow_nan=False)
                output.write("\n")
                output.flush()
                os.fsync(output.fileno())
            os.replace(temporary, path)
        finally:
            if temporary is not None:
                temporary.unlink(missing_ok=True)

    def duplicate(self, mission_id):
        with self.lock:
            original = self._read(self.path(mission_id))
            now = datetime.now(timezone.utc)
            copy = original.model_copy(update={
                "id": uuid4().hex, "name": original.name[:113] + " (copy)",
                "created_at": now, "updated_at": now,
            })
            self._write(self.path(copy.id), copy)
            return copy

    def import_manifest(self, manifest):
        comparison = self.calculate(manifest.input)
        if not any(route.strategy == manifest.selected_route.strategy for route in comparison.routes):
            raise HTTPException(422, "The selected strategy is unavailable with the current Gale elevation data.")
        mission = SavedMission(
            id=uuid4().hex, name=manifest.name, description=manifest.description,
            region="Gale Crater", start=manifest.input.start, destination=manifest.input.destination,
            settings=RouteSettings.model_validate(manifest.input.model_dump()),
            selected_strategy=manifest.selected_route.strategy, comparison=comparison,
            provenance=self.provenance(comparison), created_at=datetime.now(timezone.utc), updated_at=datetime.now(timezone.utc),
        )
        with self.lock:
            self._write(self.path(mission.id), mission)
        return mission

    def delete(self, mission_id):
        with self.lock:
            try:
                self.path(mission_id).unlink()
            except FileNotFoundError as error:
                raise HTTPException(404, "Saved mission not found.") from error


def saved_mission_router(store):
    router = APIRouter(prefix="/api/saved-missions", tags=["saved missions"])

    def storage_call(operation, *args):
        try:
            return operation(*args)
        except OSError as error:
            raise HTTPException(500, "Saved mission storage is unavailable.") from error

    @router.get("")
    def list_missions() -> MissionIndex:
        return storage_call(store.list)

    if store.calculate is not None:
        @router.post("/import", status_code=201)
        def import_mission(payload: ManifestImport) -> SavedMission:
            return storage_call(store.import_manifest, payload)

    @router.post("/{mission_id}/duplicate", status_code=201)
    def duplicate_mission(mission_id: str) -> SavedMission:
        return storage_call(store.duplicate, mission_id)

    @router.get("/{mission_id}")
    def get_mission(mission_id: str) -> SavedMission:
        return storage_call(store.get, mission_id)

    @router.post("", status_code=201)
    def create_mission(payload: MissionWrite) -> SavedMission:
        return storage_call(store.save, payload)

    @router.put("/{mission_id}")
    def update_mission(mission_id: str, payload: MissionWrite) -> SavedMission:
        return storage_call(store.save, payload, mission_id)

    @router.delete("/{mission_id}", status_code=204)
    def delete_mission(mission_id: str):
        storage_call(store.delete, mission_id)
        return Response(status_code=204)

    return router
