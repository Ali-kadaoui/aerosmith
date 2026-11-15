# Gale sulfate beds HiRISE candidate

The [March 2022 HiRISE release](https://www.uahirise.org/dtm/summaries/HIRISE_DTM_PDS_March_2022.pdf) pairs DTM DTEEC_012907_1745_013540_1745_A01 with orthoimage ESP_012907_1745_RED_C_01_ORTHO, near 5.3°S, 137.2°E. Its paired panels show matching ridges and overlapping terrain. Credit NASA/JPL/University of Arizona.

The [product page](https://www.uahirise.org/dtm/dtm.php?ID=ESP_012907_1745) lists a 282 MB IMG and 27 MB JPEG 2000 orthoimage (309 MB total before derived assets). The producer README specifies 1 m DTM posting in Mars equirectangular coordinates, areoid elevations tied to MOLA, and 1 m orthoimage sampling by product code. It reports approximately 8.4 m X, 24.3 m Y and 2.0 m Z RMS components, plus a 2.27 m mean difference from MOLA. These are production diagnostics, not independent absolute accuracy guarantees.

Before ingest, confirm full projection parameters and pixel offsets from the product labels, intersect valid footprints, check landmarks and control points, and preserve no-data and stereo quality information. Then select a small common crop and budget temporary decode and export space. Neither raster has been downloaded or integrated. The local viewer currently uses the bundled 128 pixels/degree Gale MOLA grid, with derived height colors.

## Phase 2.2 integration

The PDS3 labels match on dimensions (6,457 columns × 10,921 rows),
equirectangular projection, center latitude −5°, center longitude 137.21°E,
sphere radius 3,396,036.813 m, line/sample offsets −306352.5 / 3224.5 and
1.011673 m pixel scale. Latitude is planetocentric, longitude east positive,
and DTM values are float32 meters above the Mars 2000 equipotential surface.
The orthoimage is 8-bit red-band JPEG 2000 and explicitly references this DTM.

Fetch the DTM first record (bytes 0–25827), DTM rows 4800–5823
(bytes 124000228–150448099; verify HTTP 206 and Content-Range), the JP2,
and its LBL. Pass the directory containing dtm.lbl, rows.bin, ortho.jp2
and ortho.lbl to scripts/import_hirise_crop.py. Only the 257 × 257 window
starting at zero-based column 3048, row 5184 is deployed. No resampling was
used. The IMG missing-value bit pattern is 0xFF7FFFFB and ortho null is DN 0.
Both masks are valid across the crop and agree at 99.89% over the sampled strip.
This checks shared grid registration, not independent absolute control.

The float32 crop is 258 KiB. The orthoimage and derived slope PNGs are
approximately 37 and 75 KiB. The detailed viewer loads its grid on demand.
A* selects HiRISE when both endpoints fall inside the crop, otherwise it uses
MOLA. It does not switch between grids mid-route or bypass a failed HiRISE
grade constraint using a coarse route. HiRISE posting does not establish
walking safety. The slope overlay represents a finite-difference gradient;
no verified boulder or dune mask has been integrated.

The contours layer interpolates along the same triangle split used in the 3D
mesh. Cyan lines mark 10 m intervals and amber lines mark 50 m intervals;
the higher raster dimensions smooth line rendering without increasing source
resolution. Generate it with scripts/hirise_contours.py. Clicking a HiRISE
layer returns the elevation of the sampled DEM cell above the areoid.
