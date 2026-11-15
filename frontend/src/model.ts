export type Point = { lon: number; lat: number };
export type Feature = {
  id: string; name: string; subtitle: string; category: string; mission: string;
  region: string; description: string; coordinate: Point | null; accuracy: string; url: string;
};
export type Observation = {
  id: string; featureId: string | null; title: string; mission: string; region: string;
  camera: string; sol: string | null; date: string | null; description: string;
  credit: string; image: string; url: string;
};
export type Source = {
  id: string; name: string; source: string; status: string; coverage: string; crs: string;
  bounds?: [number, number, number, number]; resolution: string; description: string;
  attribution: string; url: string;
};
export type MapLayer = Source & {
  bounds: [number, number, number, number]; layer: string; matrixSet: string; template: string; format: string; raster?: string;
  matrices: { id: string; origin: number[]; size: number[]; tileSize: number[] }[];
};
export type Strategy = 'conservative' | 'direct' | 'science';
export type RouteSettings = {
  max_grade_deg: number; grade_weight: number; terrain_screening?: boolean;
  pace_kmh: number | null; waypoint_id: string | null;
};
export type Plan = RouteSettings & { start: Point; destination: Point };
export type Sample = { point: Point; distance_m: number; elevation_m: number };
export type Route = {
  id: string; strategy: Strategy; terrain_id?: string; distance_m: number; ascent_m: number; descent_m: number;
  max_segment_grade_deg: number; net_elevation_m: number; modeled_cost_m: number;
  duration_min: number | null; terrain_weight: number; poi_ids: string[];
  waypoint_id: string | null; profile: Sample[];
};
export type Comparison = {
  id: string; request: Plan; routes: Route[]; unavailable: Partial<Record<Strategy, string>>;
  limits: string[]; advisory: string;
};
export const strategies = {
  conservative: { name: 'Conservative', color: '#c5e985', code: 'A' },
  direct: { name: 'Direct', color: '#7cdce3', code: 'B' },
  science: { name: 'Science priority', color: '#f5bd78', code: 'C' },
};
export const gale = { lon: 137.59, lat: -4.88 };
export const jezero = { lon: 77.45088, lat: 18.44463 };
export const east = (lon: number) => (lon + 360) % 360;
export const coord = (point: Point | null, decimals = 3) => point
  ? `${Math.abs(point.lat).toFixed(decimals)}° ${point.lat < 0 ? 'S' : 'N'} · ${east(point.lon).toFixed(decimals)}° E`
  : 'Awaiting coordinates';

export async function api(path: string, payload?: unknown, method = payload === undefined ? 'GET' : 'POST'): Promise<Response> {
  const response = await fetch('/api' + path, payload === undefined ? { method } : {
    method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
  if (response.ok) return response;
  const raw = await response.json().catch(() => null);
  const detail = raw?.detail;
  throw new Error(typeof detail === 'string' ? detail : Array.isArray(detail)
    ? detail.map(item => `${item.loc.slice(1).join('.')} · ${item.msg}`).join('; ')
    : `API request failed (${response.status}).`);
}
export async function read<T>(path: string, payload?: unknown, method?: string): Promise<T> {
  return (await api(path, payload, method)).json();
}

export type Traverse = { source: string; firstSol: number; lastSol: number; paths: number[][][]; waypoints: (Point & { sol: number })[] };
