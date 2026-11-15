import { MathUtils, Vector3 } from 'three';

export const EQUATOR_KM = 3396.2;
export const POLAR_KM = 3376.2;
export const Y_RATIO = POLAR_KM / EQUATOR_KM;

export function geoToVector3(lat: number, lon: number, radius = 2, yRatio = Y_RATIO) {
  const phi = MathUtils.degToRad(90 - lat);
  const theta = MathUtils.degToRad(lon + 180);
  return new Vector3(-radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi) * yRatio, radius * Math.sin(phi) * Math.sin(theta));
}

export function vector3ToGeo(vector: Vector3, yRatio = Y_RATIO) {
  const point = vector.clone();
  point.y /= yRatio;
  point.normalize();
  const lat = MathUtils.radToDeg(Math.asin(MathUtils.clamp(point.y, -1, 1)));
  const lon = MathUtils.radToDeg(Math.atan2(point.z, -point.x));
  return { lat, lon: (lon + 360) % 360 - 180 };
}
