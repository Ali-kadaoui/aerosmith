import { test } from 'node:test';
import assert from 'node:assert/strict';
import { geoToVector3, vector3ToGeo, Y_RATIO } from '../src/marsGeodesy.ts';

test('reference spheroid radius and flattening', () => {
  assert.ok(Math.abs(geoToVector3(0, 0).length() - 2) < 1e-12);
  assert.ok(Math.abs(geoToVector3(90, 0).y - 2 * Y_RATIO) < 1e-12);
});

test('coordinates round-trip at Gale and either side of the antimeridian', () => {
  for (const ratio of [Y_RATIO, 1, 1 - 6 * (1 - Y_RATIO)]) {
    for (const [lat, lon] of [[-4.88,137.59], [62,-179.999], [-62,179.999], [0,0], [20,180]]) {
      const point = vector3ToGeo(geoToVector3(lat, lon, 2, ratio), ratio);
      assert.ok(Math.abs(point.lat - lat) < 1e-10);
      assert.ok(Math.abs(((point.lon - lon + 540) % 360) - 180) < 1e-10);
    }
  }
});
