import { useEffect, useState, type FormEvent } from 'react';
import { Copy, Download, FolderOpen, Upload, Save, Trash2 } from 'lucide-react';
import { api, read, type Comparison, coord, strategies, type Point, type RouteSettings, type Strategy } from './model';

export type MissionDraft = {
  region: 'Gale Crater' | 'Jezero Crater';
  start: Point | null; destination: Point | null; settings: RouteSettings;
  selected_strategy: Strategy | null; comparison_id: string | null;
};
export type MissionSummary = {
  id: string; name: string; description: string; updated_at: string;
  region: MissionDraft['region']; selected_strategy: Strategy | null;
};
export type SavedMission = MissionSummary & Omit<MissionDraft, 'comparison_id'> & {
  created_at: string; comparison: Comparison | null; provenance?: { dataset?: { name: string; url: string } };
};
type MissionIndex = { missions: MissionSummary[]; warnings: string[] };
const path = '/saved-missions';

function downloadBrief(mission: SavedMission) {
  const route = mission.comparison?.routes.find(item => item.strategy === mission.selected_strategy);
  const settings = mission.comparison?.request ?? mission.settings;
  const dataset = mission.provenance?.dataset;
  const brief = [
    mission.name, mission.description, '',
    `Region: ${mission.region}`, `Start: ${coord(mission.start)}`, `Destination: ${coord(mission.destination)}`,
    `Grade cap: ${settings.max_grade_deg}° · Slope weight: ${settings.grade_weight}`,
    `Pace: ${settings.pace_kmh ?? 'Unspecified'}`,
    ...(route ? [
      `Selected strategy: ${strategies[route.strategy].name}`,
      `Distance: ${(route.distance_m / 1000).toFixed(2)} km · Climb: ${route.ascent_m} m · Descent: ${route.descent_m} m · Peak sampled grade: ${route.max_segment_grade_deg}°`,
    ] : ['Draft or no selected route']),
    ...(dataset ? [`Dataset: ${dataset.name} — ${dataset.url}`] : []),
    ...(mission.comparison?.limits ?? []),
  ].join('\n');
  const url = URL.createObjectURL(new Blob([brief], { type: 'text/plain;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url; link.download = `AEROSMITH_BRIEF_${mission.id}.txt`; link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function SavedMissions({ draft, active, onSaved, onOpen, onNew }: {
  draft: MissionDraft; active: MissionSummary | null;
  onSaved: (mission: MissionSummary | null) => void; onOpen: (mission: SavedMission) => void; onNew: () => void;
}) {
  const [index, setIndex] = useState<MissionIndex>({ missions: [], warnings: [] });
  const [name, setName] = useState(active?.name ?? '');
  const [description, setDescription] = useState(active?.description ?? '');
  const [busy, setBusy] = useState(true);
  const [confirm, setConfirm] = useState<MissionSummary | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function perform(action: () => Promise<void>) {
    setBusy(true); setError(''); setNotice('');
    try { await action(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not access saved missions.'); }
    finally { setBusy(false); }
  }
  async function refresh() { setIndex(await read<MissionIndex>(path)); }
  useEffect(() => { void perform(refresh); }, []);

  function save(event: FormEvent) {
    event.preventDefault();
    void perform(async () => {
      const saved = await read<SavedMission>(active ? `${path}/${active.id}` : path,
        { ...draft, name, description }, active ? 'PUT' : 'POST');
      onSaved(saved); setName(saved.name); setDescription(saved.description);
      setNotice(active ? 'Mission updated.' : 'Mission saved.');
      await refresh();
    });
  }

  function importFile(file: File) {
    void perform(async () => {
      if (file.size > 5_000_000) throw new Error('Choose an AEROSMITH manifest smaller than 5 MB.');
      let manifest: unknown;
      try { manifest = JSON.parse(await file.text()); }
      catch { throw new Error('The file does not contain valid JSON.'); }
      if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error('Choose an AEROSMITH manifest JSON object.');
      const imported = await read<SavedMission>(path + '/import', {
        ...manifest, name: file.name.replace(/\.json$/i, '').slice(0, 120).trim() || 'Imported Gale mission',
      });
      onOpen(imported);
    });
  }

  function remove(mission: MissionSummary) {
    void perform(async () => {
      await api(`${path}/${mission.id}`, undefined, 'DELETE');
      setConfirm(null);
      if (active?.id === mission.id) { onSaved(null); setName(''); setDescription(''); }
      setNotice('Mission deleted.');
      await refresh();
    });
  }

  return <main className="library saved-library">
    <div className="library-heading"><h1>Saved missions</h1><p>Open a saved plan or keep a copy of your current traverse on this computer.</p></div>
    <div className="saved-layout">
      <form className="panel saved-panel" onSubmit={save}>
        <h2>{active ? 'Update current mission' : 'Save current mission'}</h2>
        <p className="muted">{draft.region} · {draft.comparison_id ? 'Route comparison' : 'Draft plan'}</p>
        <label>Mission name<input required maxLength={120} value={name} onChange={event => setName(event.target.value)}/></label>
        <label>Description <span className="muted">(optional)</span><textarea rows={4} maxLength={2000} value={description} onChange={event => setDescription(event.target.value)}/></label>
        <button className="primary" disabled={busy || !name.trim()}><Save size={15}/>{active ? 'Update mission' : 'Save mission'}</button>
        {active && <button type="button" className="secondary" disabled={busy} onClick={onNew}>Start new mission</button>}
      </form>
      <section className="panel saved-panel" aria-label="Saved mission list">
        <h2>Mission library</h2>
        <label className="mission-import"><span><Upload size={15}/> Import AEROSMITH manifest</span>
          <input type="file" accept=".json,application/json" disabled={busy} onChange={event => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = '';
            if (file) importFile(file);
          }}/>
        </label>
        <p className="muted">Import recalculates the route with the bundled Gale elevation grid.</p>
        {busy && <p className="muted" role="status">Working…</p>}
        {!busy && !error && !index.missions.length && <p className="muted">No saved missions yet.</p>}
        {index.missions.map(mission => <article className="saved-row" key={mission.id}>
          <h3>{mission.name}{active?.id === mission.id && <small> · Current</small>}</h3>
          <p className="muted">{mission.region} · {new Date(mission.updated_at).toLocaleString()}</p>
          {mission.description && <p>{mission.description}</p>}
          {confirm?.id === mission.id ? <div className="saved-buttons">
            <span>Delete this saved mission?</span>
            <button className="secondary" disabled={busy} onClick={() => remove(mission)}>Confirm deletion</button>
            <button className="secondary" disabled={busy} onClick={() => setConfirm(null)}>Cancel</button>
          </div> : <div className="saved-buttons">
            <button className="secondary" disabled={busy} onClick={() => void perform(async () => onOpen(await read<SavedMission>(`${path}/${mission.id}`)))}><FolderOpen size={15}/>Open</button>
            <button className="secondary" disabled={busy} onClick={() => void perform(async () => {
              const copy = await read<SavedMission>(path + '/' + mission.id + '/duplicate', undefined, 'POST');
              onOpen(copy);
            })}><Copy size={15}/>Duplicate</button>
            <button className="secondary" disabled={busy} onClick={() => void perform(async () => {
              downloadBrief(await read<SavedMission>(path + '/' + mission.id));
            })}><Download size={15}/>Brief</button>
            <button aria-label={`Delete ${mission.name}`} className="secondary" disabled={busy} onClick={() => setConfirm(mission)}><Trash2 size={15}/>Delete</button>
          </div>}
        </article>)}
        {index.warnings.map(warning => <p className="error" key={warning}>{warning}</p>)}
      </section>
    </div>
    {notice && <p role="status">{notice}</p>}
    {error && <p className="error" role="alert">{error} <button className="text-button" onClick={() => void perform(refresh)}>Reload library</button></p>}
  </main>;
}
