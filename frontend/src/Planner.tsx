import { useState, type FormEvent } from 'react';
import { ArrowDownToLine, ArrowRight, LocateFixed, Route as RouteIcon, RotateCcw, SlidersHorizontal } from 'lucide-react';
import { Profile, RouteComparison } from './RouteAnalysis';
import { coord, strategies, type Comparison, type Feature, type Plan, type Point, type Route, type RouteSettings, type Sample, type Strategy } from './model';

export type PlannerSettings = { grade: string; weight: string; pace: string; waypoint: string; terrainScreening?: boolean };

export function routeSettings(settings: PlannerSettings): RouteSettings {
  return { terrain_screening: settings.terrainScreening ?? true, max_grade_deg: Number(settings.grade), grade_weight: Number(settings.weight),
    pace_kmh: settings.pace ? Number(settings.pace) : null, waypoint_id: settings.waypoint || null };
}

type Props = {
  settings: PlannerSettings; onSettings: (settings: PlannerSettings) => void;
  points: [Point | null, Point | null]; picking: number | null; terrain: boolean;
  comparison: Comparison | null; selected?: Route; features: Feature[]; busy: boolean; exporting: boolean;
  recommended?: Strategy; reviewNotice: string; error: string; onPick: (index: number) => void; onSet: (index: number, point: Point) => void;
  onLocalExample?: () => void;
  onReset: () => void; onExample: () => void; onCalculate: (request: Plan) => void;
  onSelect: (id: string) => void; onSample: (sample: Sample | null) => void; onExport: () => void;
};
export function Planner(props: Props) {
  const { grade, weight, pace, waypoint } = props.settings;
  const [coordinateText, setCoordinateText] = useState(['', '']);
  const targets = props.features.filter(feature => feature.coordinate && feature.region === 'Gale Crater');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const [start, destination] = props.points;
    if (start && destination) props.onCalculate({
      start, destination, ...routeSettings(props.settings), terrain_screening: true,
    });
  };
  return <aside className="panel planner">
    <div className="panel-title"><RouteIcon size={18} /><h2>Traverse planner</h2><button className="icon subtle" aria-label="Reset route" title="Reset route" onClick={() => { props.onReset(); setCoordinateText(['', '']); }}><RotateCcw size={15} /></button></div>
    <div className="panel-body">
      <div className="section-label">Endpoints <button className="text-button" onClick={props.onExample}>Load example</button></div>
      {props.onLocalExample && <button className="text-button" onClick={props.onLocalExample}>Load HiRISE example</button>}
      <form onSubmit={submit}>
        {props.points.map((point, i) => <button key={i} type="button" onClick={() => props.onPick(i)} className={`endpoint ${props.picking === i ? 'active' : ''}`}>
          <span className={`point-id point-${i}`}>{i ? 'B' : 'A'}</span><span><b>{i ? 'Destination' : 'Start point'}</b><small>{props.picking === i ? 'Click a location on the map' : coord(point)}</small></span><LocateFixed size={16} />
        </button>)}
        <details className="settings">
          <summary><SlidersHorizontal size={15} /> Route settings &amp; input</summary>
          <div className="settings-body">
            {props.points.map((_, i) => <div className="point-entry" key={i}>
              <label>Point {i ? 'B' : 'A'}<select value="" onChange={event => {
                const target = targets.find(feature => feature.id === event.target.value);
                if (target?.coordinate) props.onSet(i, target.coordinate);
              }}><option value="" disabled>Select a mapped feature</option>{targets.map(feature => <option key={feature.id} value={feature.id}>{feature.name}</option>)}</select></label>
              <div className="coordinate-entry"><input aria-label={`Point ${i ? 'B' : 'A'} latitude, longitude`} placeholder="Latitude, longitude" value={coordinateText[i]} onChange={event => setCoordinateText(values => values.map((value, j) => i === j ? event.target.value : value))} /><button className="secondary" type="button" disabled={!/^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/.test(coordinateText[i].trim())} onClick={() => { const [lat, lon] = coordinateText[i].split(',').map(Number); props.onSet(i, { lat, lon }); }}>Set</button></div>
            </div>)}
            <div className="fields"><label>Grade cap (°)<input type="number" min=".1" max="45" step=".1" value={grade} onChange={event => props.onSettings({ ...props.settings, grade: event.target.value })} required /></label><label>Slope weight<input type="number" min="0" max="50" step=".1" value={weight} onChange={event => props.onSettings({ ...props.settings, weight: event.target.value })} required /></label></div>
            <label>Illustrative pace (km/h)<input type="number" placeholder="Optional" min=".1" max="10" step=".1" value={pace} onChange={event => props.onSettings({ ...props.settings, pace: event.target.value })} /></label>
            <label>Science waypoint<select value={waypoint} onChange={event => props.onSettings({ ...props.settings, waypoint: event.target.value })}><option value="">Choose by route cost</option>{targets.map(feature => <option key={feature.id} value={feature.id}>{feature.name}</option>)}</select></label>
          </div>
        </details>
        <button className="primary full" type="submit" disabled={!props.terrain || props.points.includes(null) || props.busy}>{props.busy ? 'Checking terrain and reviewing routes…' : 'Find routes with AI'}<ArrowRight size={16} /></button>
      </form>
      {props.error && <p className="error" role="alert">{props.error}</p>}
      {!props.terrain && <p className="muted">The Gale elevation grid is unavailable.</p>}
      {props.comparison ? <>
        {props.reviewNotice && <p className="muted" role="status">{props.reviewNotice}</p>}
        <div className="section-label with-gap">Terrain route options</div>
        {props.comparison.routes.length === 1 && <p className="muted">Only one distinct path met the terrain constraints.</p>}
        {props.comparison.routes.length === 0 && <p role="status">No route meets the configured terrain constraints.</p>}
        {props.comparison.routes.map(route => {
          const config = strategies[route.strategy];
          return <button type="button" className={`route-option ${route.id === props.selected?.id ? 'active' : ''}`} key={route.id}
            aria-pressed={route.id === props.selected?.id} onClick={() => props.onSelect(route.id)}
            style={{ '--accent': config.color } as React.CSSProperties}>
            <span>{config.code}</span><b>{route.strategy === props.recommended ? 'AI recommended' : config.name}
              <small>{route.max_segment_grade_deg.toFixed(1)}° peak sampled grade</small></b>
            <strong>{(route.distance_m / 1000).toFixed(2)} km</strong>
          </button>;
        })}
        <p className="muted">Elevation coverage limits what the planner can detect. Human access and small obstacles remain unverified.</p>
        {props.comparison.routes.length > 0 && <RouteComparison routes={props.comparison.routes} selected={props.selected} onSelect={props.onSelect}/>}
        {props.selected && <>
          <p className="muted">Route endpoints snap to {props.selected.terrain_id === 'hirise-sulfate' ? 'HiRISE 1.012 m' : 'MOLA ~463 m'} cell centers.<br/>
            Routed start: {coord(props.selected.profile[0].point, 5)}<br/>
            Routed finish: {coord(props.selected.profile.at(-1)!.point, 5)}
          </p>
          <Profile key={props.selected.id} route={props.selected} onSample={props.onSample} />
          <div className="route-metrics">
            <div><small>Ascent / descent</small><b>+{props.selected.ascent_m} / −{props.selected.descent_m} m</b></div>
            <div><small>Net elevation</small><b>{props.selected.net_elevation_m} m</b></div>
            <div><small>Modeled cost</small><b>{(props.selected.modeled_cost_m / 1000).toFixed(2)} km eq.</b></div>
            <div><small>Estimated duration</small><b>{props.selected.duration_min === null ? 'Pace required' : `${Math.round(props.selected.duration_min)} min`}</b></div>
          </div>
          <p className="muted">{props.selected.poi_ids.length} mapped POIs along sampled cells{props.selected.poi_ids.length > 0 && ` · ${props.selected.poi_ids.map(id => props.features.find(feature => feature.id === id)?.name ?? id).join(', ')}`}</p>
          <button className="secondary full" onClick={props.onExport} disabled={props.exporting}><ArrowDownToLine size={15} />{props.exporting ? 'Exporting…' : 'Export mission manifest'}</button>
        </>}
        <details className="advisory"><summary>Simulated mission advisory</summary><p>{props.comparison.advisory}</p><ul>{props.comparison.limits.map(limit => <li key={limit}>{limit}</li>)}</ul></details>
      </> : <div className="empty-route"><RouteIcon size={27} /><strong>Awaiting traverse</strong><p>Set two points within the Gale elevation grid to compare routes.</p></div>}
    </div>
    <div className="panel-foot"><span className="dot"/> MOLA DEM · 128 PIXELS / DEGREE</div>
  </aside>;
}
