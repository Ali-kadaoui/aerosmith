"""Generate the layer registry from archived NASA Trek capabilities."""
import json
from pathlib import Path
import xml.etree.ElementTree as ET

root = Path(__file__).resolve().parents[1] / "data/metadata"
ns = {"w": "http://www.opengis.net/wmts/1.0", "o": "http://www.opengis.net/ows/1.1"}
products = [
    ("viking", "Viking color mosaic", "Global Mars", "232 m source", "USGS colorized Viking Orbiter MDIM 2.1 mosaic.", "NASA/USGS Astrogeology"),
    ("mola", "MOLA color relief", "Global Mars", "463 m", "Colorized terrain relief from Mars Global Surveyor laser altimetry.", "NASA/JPL-Caltech, MGS MOLA Team"),
    ("ctx", "Gale CTX mosaic", "Gale Crater", "6 m", "Regional grayscale orbital mosaic from the Mars Reconnaissance Orbiter Context Camera.", "NASA/JPL-Caltech/MSSS"),
    ("hrsc", "HRSC/MOLA relief", "Global Mars", "200 m grid", "Color relief from the Mars Express stereo camera and MGS MOLA elevation blend.", "ESA/DLR/FU Berlin, NASA/MGS MOLA Team"),
    ("roughness", "MOLA roughness", "Global Mars", "8 pixels/degree", "RGB composite of roughness at 9.2, 2.4 and 0.6 km baselines.", "NASA/MGS MOLA Team, Kreslavsky and Head"),
]
layers = []
for key, title, coverage, resolution, description, credit in products:
    contents = ET.parse(root / f"{key}.xml").find("w:Contents", ns)
    layer = contents.find("w:Layer", ns)
    identity = layer.findtext("o:Identifier", namespaces=ns)
    matrix_id = layer.findtext("w:TileMatrixSetLink/w:TileMatrixSet", namespaces=ns)
    matrix = next(m for m in contents.findall("w:TileMatrixSet", ns)
                  if m.findtext("o:Identifier", namespaces=ns) == matrix_id)
    tile = layer.find("w:ResourceURL", ns).attrib
    base = tile["template"].split("/1.0.0/")[0] + "/1.0.0/"
    corners = [float(value) for name in ("LowerCorner", "UpperCorner")
               for value in layer.findtext(f"o:BoundingBox/o:{name}", namespaces=ns).split()]
    layer_data = {
        "id": key, "name": title, "source": "NASA Mars Trek", "status": "available",
        "url": base + "WMTSCapabilities.xml", "coverage": coverage, "bounds": corners,
        "crs": matrix.findtext("o:SupportedCRS", namespaces=ns), "resolution": resolution,
        "description": description, "attribution": credit, "layer": identity, "matrixSet": matrix_id,
        "format": tile["format"], "template": tile["template"].replace("/1.0.0//{Style}", "/1.0.0/default"),
        "matrices": []
    }
    for level in matrix.findall("w:TileMatrix", ns):
        def field(name):
            return float(level.findtext(f"w:{name}", namespaces=ns))
        layer_data["matrices"].append({
            "id": level.findtext("o:Identifier", namespaces=ns),
            "origin": list(map(float, level.findtext("w:TopLeftCorner", namespaces=ns).split())),
            "size": [int(field("MatrixWidth")), int(field("MatrixHeight"))],
            "tileSize": [int(field("TileWidth")), int(field("TileHeight"))],
            "scaleDenominator": field("ScaleDenominator")
        })
    layers.append(layer_data)
(root / "layers.json").write_text(json.dumps(layers, indent=2) + "\n")
