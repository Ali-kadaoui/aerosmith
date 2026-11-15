import { useState } from 'react';
import { strategies, type Route, type Sample } from './model';

function sampledDistance3d(route: Route) {
  return route.profile.slice(1).reduce((distance, sample, index) => {
    const previous = route.profile[index];
    return distance + Math.hypot(sample.distance_m - previous.distance_m, sample.elevation_m - previous.elevation_m);
  }, 0);
}

export function RouteComparison({ routes, selected, onSelect }: {
  routes: Route[]; selected?: Route; onSelect: (id: string) => void;
}) {
  return <details className="route-comparison" open>
    <summary>Compare route metrics</summary>
    <div className="comparison-scroll"><table>
      <thead><tr><th scope="col">Metric</th>{routes.map(route => <th scope="col" key={route.id}>
        <button type="button" aria-label={`Highlight ${strategies[route.strategy].name} route`}
          aria-pressed={route.id === selected?.id} onClick={() => onSelect(route.id)}
          style={{ color: strategies[route.strategy].color }}>{strategies[route.strategy].code}</button>
      </th>)}</tr></thead>
      <tbody>
        <tr><th scope="row">Horizontal distance (km)</th>{routes.map(route => <td key={route.id}>{(route.distance_m / 1000).toFixed(2)}</td>)}</tr>
        <tr><th scope="row">Sampled 3D distance (km)</th>{routes.map(route => <td key={route.id}>{(sampledDistance3d(route) / 1000).toFixed(2)}</td>)}</tr>
        <tr><th scope="row">Climb (m)</th>{routes.map(route => <td key={route.id}>{route.ascent_m}</td>)}</tr>
        <tr><th scope="row">Peak grade (°)</th>{routes.map(route => <td key={route.id}>{route.max_segment_grade_deg.toFixed(1)}</td>)}</tr>
        <tr><th scope="row">Science POIs</th>{routes.map(route => <td key={route.id}>{route.poi_ids.length}</td>)}</tr>
      </tbody>
    </table></div>
  </details>;
}

export function Profile({ route, onSample }: { route: Route; onSample: (sample: Sample | null) => void }) {
  const [index, setIndex] = useState<number | null>(null);
  const series = route.profile;
  const min = Math.min(...series.map(item => item.elevation_m));
  const max = Math.max(...series.map(item => item.elevation_m));
  const x = (sample: Sample) => 8 + sample.distance_m / route.distance_m * 284;
  const y = (sample: Sample) => 77 - (sample.elevation_m - min) / (max - min || 1) * 65;
  const points = series.map(item => `${x(item)},${y(item)}`).join(' ');
  const active = index === null ? null : series[index];
  const inspect = (next: number | null) => {
    setIndex(next);
    onSample(next === null ? null : series[next]);
  };
  return <div className="profile">
    <div className="section-label">Elevation profile <span>MOLA / M ABOVE AREOID</span></div>
    <svg viewBox="0 0 300 88" role="img" aria-label={`Elevation profile, ${min} to ${max} meters over ${(route.distance_m / 1000).toFixed(2)} kilometers`}
      onPointerMove={event => {
        const box = event.currentTarget.getBoundingClientRect();
        const distance = ((event.clientX - box.left) / box.width * 300 - 8) / 284 * route.distance_m;
        const next = series.reduce((nearest, sample, i) =>
          Math.abs(sample.distance_m - distance) < Math.abs(series[nearest].distance_m - distance) ? i : nearest, 0);
        if (next !== index) inspect(next);
      }} onPointerLeave={() => inspect(null)}>
      {[12, 44.5, 77].map(line => <line key={line} x1={8} x2={292} y1={line} y2={line} stroke="#394339" strokeDasharray="3 5" />)}
      <polygon points={`8,77 ${points} 292,77`} fill={strategies[route.strategy].color} opacity=".12" />
      <polyline points={points} fill="none" stroke={strategies[route.strategy].color} strokeWidth="1.6" />
      {active && <><line x1={x(active)} x2={x(active)} y1={8} y2={79} stroke="#fff" strokeDasharray="2 3" />
        <circle cx={x(active)} cy={y(active)} r={3} fill="#fff" /></>}
    </svg>
    <div className="profile-scale"><span>{min} to {max} m</span><span>{(route.distance_m / 1000).toFixed(2)} km</span></div>
    <label className="profile-scrubber">Inspect profile sample
      <input type="range" min="0" max={series.length - 1} value={index ?? 0}
        aria-valuetext={active ? `${(active.distance_m / 1000).toFixed(2)} km, ${active.elevation_m} m` : 'Start of route'}
        onFocus={() => inspect(index ?? 0)} onBlur={() => inspect(null)} onChange={event => inspect(Number(event.target.value))} />
    </label>
    {active && <output className="profile-scale">{(active.distance_m / 1000).toFixed(2)} km · {active.elevation_m} m above areoid</output>}
  </div>;
}
