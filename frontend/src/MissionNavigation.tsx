import { useState, type Dispatch, type SetStateAction } from 'react';
import { distanceKm, type MarsWaypoint } from './itinerary';
import { coord, type Feature, type Route, type Sample } from './model';

export type NavigationState = { index: number; paused: boolean; notes: { text: string; sample: Sample; time: string }[] };
export function MissionNavigation({ route, features, state, setState, onPosition, onOverview, onEnd }: {
  state: NavigationState; setState: Dispatch<SetStateAction<NavigationState>>; route: Route; features: Feature[]; onPosition: (sample: Sample) => void; onEnd: () => void; onOverview: () => void;
}) {
  const { index, paused, notes } = state;
  const [note, setNote] = useState('');
  const sample = route.profile[index];
  const next = route.profile[Math.min(index + 1, route.profile.length - 1)];
  const remaining = Math.max(0, route.distance_m - sample.distance_m);
  const progress = route.distance_m ? sample.distance_m / route.distance_m : 1;
  const grade = Math.atan2(Math.abs(next.elevation_m - sample.elevation_m), next.distance_m - sample.distance_m) * 180 / Math.PI;
  const nearby = features.filter(feature => feature.coordinate).map(feature => ({ feature,
    distance: distanceKm(sample.point as MarsWaypoint, feature.coordinate! as MarsWaypoint),
  })).filter(item => item.distance <= 5).sort((a, b) => a.distance - b.distance).slice(0, 4);
  function exportLog() {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ route, observations: notes, simulated: true }, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'mission-observations.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <aside className="panel planner active-navigation"><div className="panel-title"><h2>Mission navigation</h2></div><div className="panel-body">
    <p className="kicker">SIMULATED POSITION · {paused ? 'PAUSED' : progress >= 1 ? 'ARRIVED' : 'ACTIVE'}</p>
    <h3>Destination</h3><p>{coord(route.profile.at(-1)!.point, 5)}</p>
    <progress max={1} value={progress}/><p>{Math.round(progress * 100)}% complete · {(remaining / 1000).toFixed(2)} km remaining</p>
    <p>Estimated remaining time · {route.duration_min === null ? 'Set a pace before planning' : `${Math.round(route.duration_min * (1 - progress))} min at configured pace`}</p>
    <label>Move simulated astronaut<input aria-label="Simulated astronaut position" type="range" min={0} max={route.profile.length - 1} value={index} disabled={paused} onChange={event => { const value = Number(event.target.value); setState(current => ({ ...current, index: value })); onPosition(route.profile[value]); }}/></label>
    <p>Position · {coord(sample.point, 5)}</p><p>Elevation · {sample.elevation_m.toFixed(1)} m above areoid</p>
    <p>Next route sample · {coord(next.point, 5)}</p><p>Next segment grade · {grade.toFixed(1)}°</p>
    <p>Terrain · {route.terrain_id === 'hirise-sulfate' ? 'HiRISE ~1 m posting' : 'MOLA ~463 m grid'}</p>
    <p className="muted">Sampled slopes indicate terrain difficulty. Obstacles, radiation, weather and resource consumption are unassessed.</p>
    <h3>Nearby scientific locations · within 5 km</h3>{nearby.length ? nearby.map(item => <p key={item.feature.id}>{item.feature.name} · {item.distance.toFixed(2)} km surface distance</p>) : <p>No catalogued locations within 5 km.</p>}
    <h3>Scientific locations on route</h3>{features.filter(feature => route.poi_ids.includes(feature.id)).map(feature => <p key={feature.id}>{feature.name}</p>)}
    <div className="itinerary-controls"><button className="secondary" onClick={onOverview}>Mission overview</button><button className="secondary" onClick={() => setState(current => ({ ...current, paused: !current.paused }))}>{paused ? 'Resume Mission' : 'Pause Mission'}</button><button className="secondary" onClick={() => onPosition(sample)}>Focus position</button><button className="secondary" onClick={() => { if (window.confirm('End this simulated mission? Export observations first to keep them.')) onEnd(); }}>End Mission</button></div>
    <h3>Field observations</h3><label>Simulation note<textarea maxLength={1500} value={note} onChange={event => setNote(event.target.value)}/></label>
    <button className="secondary" disabled={!note.trim()} onClick={() => { setState(current => ({ ...current, notes: [...current.notes, { text: note.trim(), sample, time: new Date().toISOString() }] })); setNote(''); }}>Record observation</button>
    {notes.map((item, i) => <p key={i}>{item.text} · {coord(item.sample.point)}</p>)}
    <button className="secondary" onClick={exportLog}>Export mission observations</button>
  </div></aside>;
}
