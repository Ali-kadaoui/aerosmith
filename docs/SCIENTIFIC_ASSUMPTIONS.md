# Scientific assumptions

## Observations and processed data

The rover gallery contains archival observations and one historical planning illustration. The CTX mosaic is resampled orbital imagery. The MOLA elevation product represents median altimetry within a cell and includes interpolated values where observations are missing. The globe texture joins NASA Trek’s two unmodified global level-0 tiles. It displays the color relief on a sphere and does not introduce local terrain deformation.

Published point coordinates represent landing solutions or geographic reference centers. USGS feature centers do not identify safe stopping areas, specific outcrops, or rover camera positions. Features with unavailable vetted coordinates remain browseable in the catalogue.

## Calculated quantities

A* considers eight adjacent cells per step. Horizontal distance is a great-circle arc using a spherical radius of 3,396 km from the MOLA PDS product label. Segment grade is atan(|rise| / horizontal distance). The planner applies the same grade limit to all strategies. Its heuristic uses remaining great-circle distance, a lower bound on the weighted path cost.

The edge cost is horizontal distance multiplied by 1 + weight × (rise/run)². Conservative uses the configured weight, direct uses zero, and science uses half the configured weight. Science joins two routes through a verified intermediate point, selecting the lowest weighted cost among eligible science waypoints unless the user chooses one. POI counts represent mapped waypoint cells intersected by a modeled path. This does not establish a line of sight or ground accessibility. Path metrics start and end at snapped cell centers.

Ascent and descent are sums of positive and negative elevation steps. The reported maximum grade is derived from neighboring elevation samples. Small hazards, footing, peak in-cell grade and actual path conditions cannot be resolved by this grid. Strategies can coincide when they select the same cells.

## Estimates and unavailable information

Duration is horizontal distance divided by a user-entered constant pace. It excludes stops, fatigue, elevation-related change in walking speed, life support and contingencies. Without a pace the duration is unknown. Advisory text compares the computed results deterministically.

No synthetic terrain appears in the application. Small synthetic fixtures are used only in automated tests. The roughness layer is a visual composite, so its RGB values are not passed to the route engine. Mineralogical raster layers, certified hazards, radiation maps, weather, and life-support predictions are unavailable.

## Globe geometry and display

The real-shape setting uses IAU/IAG Mars equatorial and polar radii of 3,396.2 km and 3,376.2 km. The texture, markers, raycast results, and paths share the specified scaled-sphere mapping. Its latitude parameter matches the source raster and supplied transform. It is not an ellipsoidal surveying or navigation model. The alternate sphere and six-times flattening settings are view controls.

Directional light and the MOLA-derived normal map modify apparent shading. The display mesh is not displaced by terrain, so the normal map does not cast geometric terrain shadows. Altitude is measured from the current reference-shape surface along the camera's radial direction. Hover telemetry reports coordinate and Gale DEM coverage. It does not infer terrain types or hazards.

CRISM, RAD and dust risk are marked unavailable because compatible verified rasters are not configured. The HUD shows archived Curiosity sols and does not simulate a live DSN uplink.
