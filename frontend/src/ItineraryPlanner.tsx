import { useEffect, useMemo, useState } from 'react';
import { MarsMap } from './MarsMap';
import { DeviceLocation } from './DeviceLocation';
import { distanceKm, moveWaypoint, parseLibrary, STORAGE_KEY, validCoordinate, type Itinerary, type MarsWaypoint } from './itinerary';
import { gale, type Feature, type MapLayer, type Point, type Traverse } from './model';
const emptyPoints: [null, null] = [null, null];
const emptyRoutes: [] = [];
function newItinerary(): Itinerary { return { version: 1, id: crypto.randomUUID(), name: 'New Mars itinerary', waypoints: [], pace: null }; }
export function ItineraryPlanner({ layers, features, traverse, bounds, onDirty, initialMission }: { initialMission?: Itinerary; layers: MapLayer[]; features: Feature[]; traverse?: Traverse; bounds?: number[]; onDirty: (dirty: boolean) => void }) {
  const [mission, setMission] = useState<Itinerary>(() => initialMission ?? newItinerary());
  const [library, setLibrary] = useState<Itinerary[]>(() => { try { return parseLibrary(localStorage.getItem(STORAGE_KEY)); } catch { return []; } });
  const [error, setError] = useState(() => { try { parseLibrary(localStorage.getItem(STORAGE_KEY)); return ''; } catch (cause) { return String(cause); } });
  const [notice, setNotice] = useState('');
  const [dirty, setDirty] = useState(!!initialMission);
  useEffect(() => { onDirty(dirty); return () => onDirty(false); }, [dirty, onDirty]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  const [picking, setPicking] = useState(false);
  const [visible, setVisible] = useState(true);
  const [fit, setFit] = useState(0);
  const [selected, setSelected] = useState<string>();
  const [focus, setFocus] = useState({ point: gale, zoom: 10 });
  const [layerId, setLayerId] = useState('ctx');
  const [showScience, setShowScience] = useState(true);
  const [showTraverse, setShowTraverse] = useState(true);
  const [showBounds, setShowBounds] = useState(false);
  const [science, setScience] = useState<Feature | null>(null);
  const [editor, setEditor] = useState({ name: '', lat: '', lon: '', description: '' });
  const [editing, setEditing] = useState<string | null>(null);
  const legs = useMemo(() => mission.waypoints.map((point, i) => i ? distanceKm(mission.waypoints[i - 1], point) : 0), [mission.waypoints]);
  const total = legs.reduce((sum, leg) => sum + leg, 0);
  const active = mission.waypoints.find(point => point.id === selected);
  function update(next: Itinerary) { setMission(next); setDirty(true); setNotice(''); }
  function discardAllowed() { return !dirty || window.confirm('Discard unsaved itinerary changes?'); }
  function add(point: Point, feature?: Feature) {
    if (!validCoordinate(point.lat, point.lon)) { setError('Enter a Mars latitude from −90 to 90 and longitude from −180 to 360.'); return; }
    if (mission.waypoints.length >= 100) { setError('An itinerary supports up to 100 locations.'); return; }
    const waypoint: MarsWaypoint = { ...point, id: crypto.randomUUID(), name: feature?.name ?? (mission.waypoints.length ? `Destination ${mission.waypoints.length}` : 'Mars start'), description: feature?.description ?? '', sourceId: feature?.id };
    update({ ...mission, waypoints: [...mission.waypoints, waypoint] });
    setSelected(waypoint.id); setPicking(false); setVisible(true); setError('');
  }
  function inspect(id: string) {
    const point = mission.waypoints.find(item => item.id === id);
    if (point) { setSelected(id); setFocus({ point, zoom: 10 }); }
  }
  function edit(point: MarsWaypoint) {
    setEditing(point.id); setEditor({ name: point.name, lat: String(point.lat), lon: String(point.lon), description: point.description });
  }
  function persist(action: 'save' | 'delete', id = mission.id) {
    try {
      const current = parseLibrary(localStorage.getItem(STORAGE_KEY));
      const next = current.filter(item => item.id !== id);
      if (action === 'save') next.push({ ...mission, name: mission.name.trim() });
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      setLibrary(next); setError(''); setNotice(action === 'save' ? 'Itinerary saved in this browser.' : 'Saved itinerary deleted.');
      if (action === 'save') setDirty(false);
      if (action === 'delete' && id === mission.id) setDirty(true);
    } catch (cause) { setError(`Could not ${action} itinerary. ${String(cause)}`); }
  }
  function exportItinerary() {
    if (!mission.name.trim() || (mission.pace !== null && (!Number.isFinite(mission.pace) || mission.pace <= 0 || mission.pace > 10))) {
      setError('Enter a mission name and a valid optional pace before exporting.');
      return;
    }
    const url = URL.createObjectURL(new Blob([JSON.stringify({ ...mission, distance_model: 'Mars great-circle estimates, radius 3389.5 km; hazards not evaluated', total_distance_km: total }, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = `AEROSMITH_ITINERARY_${mission.id}.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <main className="itinerary-page">
    <div className="mission-head"><div><div className="kicker">MARS MISSION PLANNING</div><h1>Exploration itinerary</h1></div>
      <button className="secondary" onClick={() => { if (discardAllowed()) { setMission(newItinerary()); setDirty(false); setSelected(undefined); setEditing(null); setPicking(false); setNotice('New itinerary'); } }}>New itinerary</button></div>
    <div className="itinerary-layout">
      <aside className="panel itinerary-panel"><div className="panel-title"><h2>Mission details</h2></div><div className="panel-body">
        <label>Mission name<input maxLength={120} value={mission.name} onChange={event => update({ ...mission, name: event.target.value })}/></label>
        <p className="itinerary-summary">{Math.max(0, mission.waypoints.length - 1)} destinations · {total.toFixed(2)} km estimated</p>
        <p className="muted">Dashed paths are surface-distance estimates. Terrain and hazards are not evaluated. Use the Mission map for MOLA terrain routing in Gale.</p>
        <label>Illustrative pace (km/h)<input type="number" min="0.1" max="10" step="0.1" value={mission.pace ?? ''} onChange={event => update({ ...mission, pace: event.target.value ? Number(event.target.value) : null })}/></label>
        <p>Estimated travel time · {mission.pace && mission.pace > 0 && mission.pace <= 10 ? `${(total / mission.pace).toFixed(2)} hours at your pace, excluding stops` : 'Enter a pace from 0.1 to 10 km/h'}</p>
        <div className="itinerary-controls"><button className="primary" onClick={() => { setPicking(!picking); setVisible(true); }}>{picking ? 'Cancel map selection' : mission.waypoints.length ? 'Add destination on map' : 'Select Mars start on map'}</button>
          <button className="secondary" disabled={!mission.waypoints.length} onClick={() => { setVisible(true); setFit(value => value + 1); }}>Fit itinerary</button>
          <button className="secondary" disabled={mission.waypoints.length < 2} onClick={() => update({ ...mission, waypoints: [...mission.waypoints].reverse() })}>Reverse itinerary</button>
          <button className="secondary" disabled={!mission.waypoints.length} onClick={() => { if (window.confirm('Clear all locations from this itinerary?')) { update({ ...mission, waypoints: [] }); setSelected(undefined); setEditing(null); } }}>Clear route</button></div>
        {picking && <p role="status">Click the Mars map to add {mission.waypoints.length ? 'a destination' : 'your starting point'}.</p>}
        <label className="toggle">Show itinerary<input type="checkbox" checked={visible} onChange={event => setVisible(event.target.checked)}/></label>
        <ol className="waypoint-list">{mission.waypoints.map((point, index) => <li key={point.id} className={selected === point.id ? 'selected' : ''}>
          <button className="waypoint-title" onClick={() => inspect(point.id)}>{index === 0 ? 'Start' : index} · {point.name}</button>
          <p>{point.lat.toFixed(5)}°, {point.lon.toFixed(5)}° E</p><p className="muted">{index ? `${legs[index].toFixed(2)} km from previous location` : 'Selected Mars coordinates'}</p>
          <div className="itinerary-controls"><button className="secondary" onClick={() => edit(point)}>Edit</button>
            <button className="secondary" aria-label={`Move ${point.name} up`} disabled={index === 0} onClick={() => update({ ...mission, waypoints: moveWaypoint(mission.waypoints, index, -1) })}>↑</button>
            <button className="secondary" aria-label={`Move ${point.name} down`} disabled={index === mission.waypoints.length - 1} onClick={() => update({ ...mission, waypoints: moveWaypoint(mission.waypoints, index, 1) })}>↓</button>
            <button className="secondary" onClick={() => { update({ ...mission, waypoints: mission.waypoints.filter(item => item.id !== point.id) }); if (editing === point.id) setEditing(null); }}>Remove</button></div>
        </li>)}</ol>
        <form className="waypoint-editor" onSubmit={event => {
          event.preventDefault();
          const point = { lat: Number(editor.lat), lon: Number(editor.lon) };
          if (!validCoordinate(point.lat, point.lon)) { setError('Invalid Mars coordinates.'); return; }
          if (editing) update({ ...mission, waypoints: mission.waypoints.map(item => item.id === editing ? { ...item, ...point, name: editor.name.trim(), description: editor.description, sourceId: undefined } : item) });
          else {
            if (mission.waypoints.length >= 100) { setError('An itinerary supports up to 100 locations.'); return; }
            const waypoint = { ...point, id: crypto.randomUUID(), name: editor.name.trim(), description: editor.description };
            update({ ...mission, waypoints: [...mission.waypoints, waypoint] }); setSelected(waypoint.id);
          }
          setFocus({ point, zoom: 10 }); setVisible(true); setEditing(null); setEditor({ name: '', lat: '', lon: '', description: '' }); setError('');
        }}><h3>{editing ? 'Edit Mars waypoint' : 'Add Mars coordinates'}</h3>
          <label>Location name<input required maxLength={120} value={editor.name} onChange={event => setEditor({ ...editor, name: event.target.value })}/></label>
          <div className="fields"><label>Latitude<input required type="number" min="-90" max="90" step="any" value={editor.lat} onChange={event => setEditor({ ...editor, lat: event.target.value })}/></label><label>Longitude °E<input required type="number" min="-180" max="360" step="any" value={editor.lon} onChange={event => setEditor({ ...editor, lon: event.target.value })}/></label></div>
          <label>Description<textarea maxLength={2000} value={editor.description} onChange={event => setEditor({ ...editor, description: event.target.value })}/></label>
          <button className="secondary" disabled={!editor.name.trim()}>{editing ? 'Apply waypoint changes' : 'Add location'}</button>
          {editing && <button type="button" className="secondary" onClick={() => { setEditing(null); setEditor({ name: '', lat: '', lon: '', description: '' }); }}>Cancel edit</button>}
        </form>
        <div className="itinerary-controls"><button className="primary" disabled={!mission.name.trim() || (mission.pace !== null && (!Number.isFinite(mission.pace) || mission.pace <= 0 || mission.pace > 10))} onClick={() => persist('save')}>Save itinerary</button><button className="secondary" onClick={exportItinerary}>Export itinerary</button></div>
        <p className="muted">{dirty ? 'Unsaved changes. ' : ''}Saved locally in this browser on this site. This library is separate from backend saved missions.</p>
        {error && <p role="alert" className="error">{error}</p>}{notice && <p role="status">{notice}</p>}
        <h3>Saved itineraries</h3>{library.length === 0 && <p className="muted">No saved itineraries.</p>}
        {library.map(item => <div className="itinerary-saved" key={item.id}><span>{item.name}</span><button className="secondary" onClick={() => { if (discardAllowed()) { setMission(item); setDirty(false); setSelected(undefined); setEditing(null); setPicking(false); setVisible(true); setFit(value => value + 1); setNotice('Itinerary opened'); } }}>Open</button><button className="secondary" onClick={() => { if (window.confirm(`Delete saved itinerary “${item.name}”?`)) persist('delete', item.id); }}>Delete</button></div>)}
        <DeviceLocation/>
      </div></aside>
      <div className="itinerary-map-area"><div className="itinerary-map-controls"><label>Map layer<select value={layerId} onChange={event => setLayerId(event.target.value)}>{layers.map(layer => <option key={layer.id} value={layer.id}>{layer.name}</option>)}</select></label>
        <label><input type="checkbox" checked={showScience} onChange={event => setShowScience(event.target.checked)}/> Science locations</label>
        <label><input type="checkbox" checked={showTraverse} onChange={event => setShowTraverse(event.target.checked)}/> Curiosity traverse</label>
        <label><input type="checkbox" checked={showBounds} onChange={event => setShowBounds(event.target.checked)}/> MOLA coverage</label></div>
        <MarsMap layers={layers} layerId={layerId} features={features} showFeatures={showScience} showBounds={showBounds} bounds={bounds} traverse={showTraverse ? traverse : undefined} points={emptyPoints} routes={emptyRoutes} inspectedPoint={null} picking={picking} focus={focus} onPoint={point => add(point)} onFeature={setScience} itinerary={visible ? mission.waypoints : undefined} activeWaypoint={selected} onWaypoint={inspect} fitItinerary={fit}/>
        {active && visible && <section className="waypoint-popup" aria-label="Selected waypoint"><button className="secondary" aria-label="Close waypoint details" onClick={() => setSelected(undefined)}>Close</button><h3>{active.name}</h3><p>{active.description || 'No description supplied.'}</p><p>{active.lat.toFixed(5)}°, {active.lon.toFixed(5)}° E · Terrain and hazards unassessed</p>{active.sourceId && features.find(item => item.id === active.sourceId) && <a href={features.find(item => item.id === active.sourceId)!.url} target="_blank" rel="noreferrer">Scientific source</a>}</section>}
        {science && <section className="waypoint-popup" aria-label="Scientific location"><h3>{science.name}</h3><p>{science.description}</p><p className="muted">{science.accuracy}</p><a href={science.url} target="_blank" rel="noreferrer">Scientific reference</a><div className="itinerary-controls">{science.coordinate && <button className="secondary" onClick={() => { add(science.coordinate!, science); setScience(null); }}>Add to itinerary</button>}<button className="secondary" onClick={() => setScience(null)}>Close science details</button></div></section>}
      </div>
    </div>
  </main>;
}
