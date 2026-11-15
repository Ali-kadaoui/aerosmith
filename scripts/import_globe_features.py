"""Create shared archival landmark, landing and MMGIS traverse records."""
import json
from pathlib import Path
import re
import sys

names, waypoints, traverse = map(Path, sys.argv[1:])
root = Path(__file__).resolve().parents[1] / "data/metadata"
html = names.read_text()
landmarks = ["Olympus Mons", "Valles Marineris", "Hellas Planitia", "Gale", "Jezero",
             "Elysium Mons", "Utopia Planitia", "Ascraeus Mons", "Pavonis Mons", "Arsia Mons",
             "Argyre Planitia", "Isidis Planitia"]
rows = {}
for row in html.split("</tr>"):
    match = re.search(r'cleanFeatureNameColumn hidden">([^<]+)', row)
    if not match or match[1] not in landmarks or 'targetColumn hidden">Mars<' not in row:
        continue
    feature = re.search(r'href="/Feature/(\d+)"', row)[1]
    lat, lon = map(float, re.findall(r'centerLatLonColumn hidden">\s*([-\d.]+)', row)[:2])
    rows[match[1]] = (feature, lat, lon)

def record(id, name, subtitle, category, mission, region, lat, lon, description, url):
    return dict(id=id, name=name, subtitle=subtitle, category=category, mission=mission, region=region,
                description=description, coordinate=dict(lat=lat, lon=lon),
                accuracy="Published reference coordinate. Marker is shown at the source precision.", url=url)

features = []
for name in landmarks:
    id, lat, lon = rows[name]
    display = {"Gale": "Gale Crater", "Jezero": "Jezero Crater"}.get(name, name)
    region = display if name in {"Gale", "Jezero"} else "Mars"
    features.append(record(f"usgs-{id}", display, "USGS Gazetteer", "Landmark", "Mars cartography",
                           region, lat, lon, "Published geographic center of the named Martian feature.",
                           f"https://planetarynames.wr.usgs.gov/Feature/{id}"))

landers = [
    ("viking-1", "Viking 1", 22.27, 312.05, "Chryse Planitia", "Landing site · mission ended"),
    ("viking-2", "Viking 2", 48.27, 134.28, "Utopia Planitia", "Landing site · mission ended"),
    ("pathfinder", "Pathfinder", 19.47, 326.75, "Ares Vallis", "Landing site · mission ended"),
    ("spirit", "Spirit", -14.57, 175.48, "Gusev Crater", "Landing site · mission ended"),
    ("opportunity", "Opportunity", -1.95, 354.47, "Meridiani Planum", "Landing site · mission ended"),
    ("phoenix", "Phoenix", 68.22, 234.25, "Vastitas Borealis", "Landing site · mission ended"),
    ("insight", "InSight", 4.50, 135.62, "Elysium Planitia", "Landing site · mission ended"),
    ("zhurong", "Zhurong", 25.07, 109.93, "Utopia Planitia", "Landing site · archived position"),
    ("schiaparelli", "Schiaparelli", -2.07, 353.79, "Meridiani Planum", "ExoMars 2016 impact site"),
]
for id, name, lat, lon, region, label in landers:
    features.append(record(id, name, label, "Impact site" if id == "schiaparelli" else "Landing site",
                           name, region, lat, lon, f"{label} in {region}.",
                           "https://www.giss.nasa.gov/tools/mars24/help/landers.html"))
(root / "globe_features.json").write_text(json.dumps(features, indent=2) + "\n")
points = []
for item in json.loads(waypoints.read_text())["features"]:
    lon, lat, *_ = item["geometry"]["coordinates"]
    points.append(dict(lon=lon, lat=lat, sol=item["properties"]["sol"]))
paths = []
for feature in json.loads(traverse.read_text())["features"]:
    geometry = feature["geometry"]
    lines = [geometry["coordinates"]] if geometry["type"] == "LineString" else geometry["coordinates"]
    paths.extend([[round(lon, 7), round(lat, 7)] for lon, lat, *_ in line] for line in lines if len(line) > 1)
(root / "curiosity_traverse.json").write_text(json.dumps({
    "source": "https://mars.nasa.gov/mmgis-maps/MSL/Layers/json/MSL_traverse.json",
    "waypointSource": "https://mars.nasa.gov/mmgis-maps/MSL/Layers/json/MSL_waypoints.json",
    "firstSol": min(p["sol"] for p in points), "lastSol": max(p["sol"] for p in points),
    "paths": paths, "waypoints": points[::30] + points[-1:]
}, separators=(",", ":")) + "\n")
