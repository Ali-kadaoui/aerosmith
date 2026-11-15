# Saved mission storage

AEROSMITH is a local prototype. File-per-mission JSON provides persistence and readable backups with the Python standard library and existing Pydantic models. Scientific catalogues and NASA/USGS assets remain in their existing locations.

## Location and contents

The API automatically creates `backend/storage/saved_missions/` on the first list or save. Each record is stored as `<mission_id>.json`, where the ID is a server-generated, 32-character lowercase UUID. Saved records are excluded from version control.

Each record contains a schema version, ID, name, optional description, region, UTC creation and modification times, optional endpoints, editable routing settings, and optional selected strategy. A calculated mission also contains the full server-generated comparison, including the settings used for that calculation, route metrics, geometry and elevation profiles, advisory and limitations, and the elevation dataset reference and checksum. Drafts can be saved before choosing endpoints or calculating a route.

## API

| Method and path | Result |
|---|---|
| `GET /api/saved-missions` | Returns `missions` summaries ordered by modification time and `warnings` for unreadable or invalid records that can be skipped. |
| `POST /api/saved-missions` | Creates a mission and returns the record with status 201. |
| `GET /api/saved-missions/{mission_id}` | Returns a full saved record, including its comparison and profiles. |
| `PUT /api/saved-missions/{mission_id}` | Replaces the editable mission contents and updates the modification time. |
| `DELETE /api/saved-missions/{mission_id}` | Removes the file and returns status 204. |

POST and PUT accept the editable fields and an optional `comparison_id`. For a new comparison, the ID must reference a server-generated result in the current route cache. A PUT may also reference the comparison already stored in that mission, even after restarting the backend. A selected strategy must exist in the comparison, and route endpoints must match the mission. Invalid payloads return 422, malformed IDs return 400, unknown IDs return 404, and corrupt records or expired comparison references return 409. Storage I/O failures return 500. The rover catalogue continues to be served by `GET /api/missions`.

## Persistence and limits

The backend validates the full record and replaces it atomically using a flushed temporary file in the same directory. Writes and reads are serialized within a single backend process. A saved comparison includes the data the map, globe, and elevation chart need, so reopening it does not depend on the transient route cache. An unsaved calculation that expires must be calculated again before saving.

This design serves a single local backend process. It has no accounts, cross-device sync, automatic backups, cross-process locking, or edit history. Deletion removes the JSON file. Copy the directory to back up saved plans. The existing JSON manifest export remains available separately.

## Import, duplicate, and share

`POST /api/saved-missions/import` accepts a version-1 AEROSMITH mission export. The app uses its inputs and selected strategy to calculate a new comparison against the installed Gale DEM. Imported metrics are recomputed from that dataset. The result is saved as a new record and opened in the planner. The library file picker accepts JSON files up to 5 MB.

`POST /api/saved-missions/{mission_id}/duplicate` copies the stored mission and any saved comparison under a new ID, even after the route cache expires. The library opens the copy for editing. Its **Brief** action downloads a plain-text summary with coordinates, route parameters, selected metrics, and the source dataset link where available.
