export type MarsWaypoint = { id: string; name: string; lat: number; lon: number; description: string; sourceId?: string };
export type Itinerary = { version: 1; id: string; name: string; waypoints: MarsWaypoint[]; pace: number | null };
export const STORAGE_KEY = 'aerosmith.itineraries.v1';
export const MARS_RADIUS_KM = 3389.5;
const radians = (value: number) => value * Math.PI / 180;
export function validCoordinate(lat: number, lon: number) {
  return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && lon >= -180 && lon <= 360;
}
export function distanceKm(a: MarsWaypoint, b: MarsWaypoint) {
  const latitude = radians(b.lat - a.lat);
  const longitude = radians(b.lon - a.lon);
  const h = Math.sin(latitude / 2) ** 2 + Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(longitude / 2) ** 2;
  return 2 * MARS_RADIUS_KM * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))));
}
export function moveWaypoint(points: MarsWaypoint[], index: number, offset: number) {
  const next = index + offset;
  if (index < 0 || index >= points.length || next < 0 || next >= points.length) return points;
  const result = [...points];
  [result[index], result[next]] = [result[next], result[index]];
  return result;
}
export function parseLibrary(raw: string | null): Itinerary[] {
  if (!raw) return [];
  const value = JSON.parse(raw);
  if (!Array.isArray(value) || !value.every(item => item.version === 1 && typeof item.id === 'string' && typeof item.name === 'string'
    && (item.pace === null || (Number.isFinite(item.pace) && item.pace > 0 && item.pace <= 10))
    && Array.isArray(item.waypoints) && item.waypoints.length <= 100 && item.waypoints.every((point: MarsWaypoint) =>
      typeof point.id === 'string' && typeof point.name === 'string' && typeof point.description === 'string'
      && (point.sourceId === undefined || typeof point.sourceId === 'string') && validCoordinate(point.lat, point.lon)))) {
    throw new Error('The itinerary library is invalid. Existing storage has been preserved.');
  }
  return value;
}
// Sample great-circle arcs, unwrapping longitude so dateline crossings stay short.
export function itineraryLine(points: MarsWaypoint[]): number[][] {
  if (!points.length) return [];
  const coordinates: number[][] = [[((points[0].lon + 540) % 360) - 180, points[0].lat]];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const latitude = radians(a.lat), longitude = radians(a.lon);
    const deltaLongitude = radians(b.lon - a.lon);
    const bearing = Math.atan2(Math.sin(deltaLongitude) * Math.cos(radians(b.lat)),
      Math.cos(latitude) * Math.sin(radians(b.lat)) - Math.sin(latitude) * Math.cos(radians(b.lat)) * Math.cos(deltaLongitude));
    const angle = distanceKm(a, b) / MARS_RADIUS_KM;
    const steps = Math.max(1, Math.ceil(angle / radians(1)));
    for (let step = 1; step <= steps; step++) {
      const arc = angle * step / steps;
      const lat = Math.asin(Math.max(-1, Math.min(1, Math.sin(latitude) * Math.cos(arc) + Math.cos(latitude) * Math.sin(arc) * Math.cos(bearing))));
      let lon = (longitude + Math.atan2(Math.sin(bearing) * Math.sin(arc) * Math.cos(latitude), Math.cos(arc) - Math.sin(latitude) * Math.sin(lat))) * 180 / Math.PI;
      const previous = coordinates[coordinates.length - 1][0];
      lon += 360 * Math.round((previous - lon) / 360);
      coordinates.push([lon, step === steps ? b.lat : lat * 180 / Math.PI]);
    }
  }
  return coordinates;
}
