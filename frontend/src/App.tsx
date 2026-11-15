import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Aperture, ArrowUpRight, BookOpen, Camera, Database, FolderOpen, Globe2, Layers3, Map as MapIcon, Route as RouteIcon, X } from 'lucide-react';
import { MissionNavigation, type NavigationState } from './MissionNavigation';
import { MarsMap } from './MarsMap';
import { MissionAssistant, type CommanderAction } from './MissionAssistant';
import { Planner, routeSettings, type PlannerSettings } from './Planner';
import { SavedMissions, type SavedMission, type MissionDraft, type MissionSummary } from './SavedMissions';
import { Dossier, Gallery, ScienceCatalogue, Sources } from './Science';
import { api, gale, jezero, read, type Comparison, type Feature, type MapLayer, type Observation, type Plan, type Point, type Source, type Traverse } from './model';

const LocalTerrain = lazy(() => import('./LocalTerrain'));
const Globe = lazy(() => import('./MarsGlobe'));
type Page = 'map' | 'gallery' | 'sources' | 'globe' | 'saved';
const nav = [
  { id: 'map', name: 'Mission map', icon: MapIcon },
  { id: 'globe', name: 'Mars globe', icon: Globe2 },
  { id: 'gallery', name: 'Observations', icon: Camera },
  { id: 'saved', name: 'Saved missions', icon: FolderOpen },
  { id: 'sources', name: 'Data registry', icon: Database },
] as const;
const blank: [null, null] = [null, null];
const defaultFocus = { point: gale, zoom: 10 };

export function App() {
  const [navigationState, setNavigationState] = useState<NavigationState>({ index: 0, paused: false, notes: [] });
  const [overview, setOverview] = useState(0);
  const [navigation, setNavigation] = useState<NonNullable<Comparison['routes'][number]> | null>(null);
  const [search, setSearch] = useState('');
  const [searchError, setSearchError] = useState('');
  const [reviewNotice, setReviewNotice] = useState('');
  const [hiddenCategories, setHiddenCategories] = useState<string[]>([]);
  const [detailTerrain, setDetailTerrain] = useState(false);
  const [localTerrain, setLocalTerrain] = useState(false);
  const [page, setPage] = useState<Page>('map');
  const [layers, setLayers] = useState<MapLayer[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [features, setFeatures] = useState<Feature[]>([]);
  const [observations, setObservations] = useState<Observation[]>([]);
  const [traverse, setTraverse] = useState<Traverse>();
  const [showTraverse, setShowTraverse] = useState(false);
  const [traverseError, setTraverseError] = useState(false);
  const [savedMission, setSavedMission] = useState<MissionSummary | null>(null);
  const [plannerSettings, setPlannerSettings] = useState<PlannerSettings>({ grade: '15', weight: '8', pace: '', waypoint: '' });
  const [inspectedPoint, setInspectedPoint] = useState<Point | null>(null);
  const [terrain, setTerrain] = useState(false);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [layerId, setLayerId] = useState('ctx');
  const [left, setLeft] = useState<'layers' | 'science'>('layers');
  const [dossier, setDossier] = useState<Feature | null>(null);
  const [image, setImage] = useState<Observation | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const [showFeatures, setShowFeatures] = useState(true);
  const [showBounds, setShowBounds] = useState(true);
  const [region, setRegion] = useState('Gale Crater');
  const [focus, setFocus] = useState(defaultFocus);
  const [points, setPoints] = useState<[Point | null, Point | null]>(blank);
  const [picking, setPicking] = useState<number | null>(null);
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [selection, setSelection] = useState<string>();
  const [recommended, setRecommended] = useState<Comparison['routes'][number]['strategy']>();
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(0);
  const selected = comparison?.routes.find(route => route.id === selection);
  const activeLayer = layers.find(layer => layer.id === layerId);
  const detailBounds = sources.find(source => source.id === 'hirise-sulfate')?.bounds;
  const bounds = sources.find(source => source.id === 'mola-dem')?.bounds;

  useEffect(() => {
    if (!showTraverse || traverse) return;
    let current = true;
    setTraverseError(false);
    void read<Traverse>('/map/traverse').then(track => {
      if (current) setTraverse(track);
    }).catch(() => {
      if (current) setTraverseError(true);
    });
    return () => { current = false; };
  }, [showTraverse, traverse]);

  async function load() {
    setLoading(true);
    setFailed(false);
    try {
      const [health, layerList, registry, science, pictures, detailLayers] = await Promise.all([
        read<{ terrain: boolean }>('/health'), read<MapLayer[]>('/map/layers'), read<Source[]>('/data-sources'),
        read<Feature[]>('/science/features'), read<Observation[]>('/images'), read<MapLayer[]>('/map/hirise-layers').catch(() => []),
      ]);
      setTerrain(health.terrain); setLayers([...layerList, ...detailLayers]); setSources(registry); setFeatures(science); setObservations(pictures);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void load(); }, []);
  useEffect(() => {
    if (image && !dialog.current?.open) dialog.current?.showModal();
    if (!image && dialog.current?.open) dialog.current.close();
  }, [image]);

  async function calculate(request: Plan) {
    const ticket = ++pending.current;
    setInspectedPoint(null); setError(''); setReviewNotice(''); setBusy(true); setComparison(null); setSelection(undefined); setRecommended(undefined);
    try {
      const result = await read<Comparison>('/routes/multi', request);
      if (ticket !== pending.current) return;
      if (!result.routes.length) {
        setComparison(result);
        return result;
      }
      let routes = result.routes;
      let recommendation: Comparison['routes'][number]['strategy'] | undefined;
      try {
        const review = await read<{ options: string[]; recommended: Comparison['routes'][number]['strategy'] | null; used_api: boolean }>(
          `/routes/${result.id}/review`, {},
        );
        if (ticket !== pending.current) return;
        routes = review.options.flatMap(strategy => result.routes.filter(route => route.strategy === strategy));
        recommendation = review.used_api ? review.recommended ?? undefined : undefined;
      } catch {
        if (ticket !== pending.current) return;
        const paths = new Set<string>();
        routes = [...result.routes].sort((a, b) => a.max_segment_grade_deg - b.max_segment_grade_deg ||
          a.ascent_m - b.ascent_m || a.distance_m - b.distance_m).filter(route => {
          const key = JSON.stringify(route.profile.map(sample => sample.point));
          if (paths.has(key)) return false;
          paths.add(key);
          return true;
        });
        setReviewNotice('AI ranking unavailable. Showing terrain-checked routes ordered by peak grade, climb, and distance.');
      }
      const reviewed = { ...result, routes };
      setComparison(reviewed);
      setPlannerSettings(settings => ({ ...settings, terrainScreening: result.request.terrain_screening ?? false }));
      setRecommended(recommendation);
      return reviewed;
    } catch (cause) {
      if (ticket === pending.current) setError(cause instanceof Error ? cause.message : 'Route calculation failed.');
    } finally {
      if (ticket === pending.current) setBusy(false);
    }
  }
  function resetResult() {
    setNavigation(null);
    setReviewNotice('');
    ++pending.current;
    setInspectedPoint(null); setBusy(false); setComparison(null); setSelection(undefined); setRecommended(undefined); setError('');
  }
  function setEndpoint(index: number, point: Point) {
    const next: [Point | null, Point | null] = [...points];
    next[index] = point;
    resetResult();
    setPoints(next);
    setPicking(index === 0 && !next[1] ? 1 : null);
  }
  function changeRegion(next: string) {
    if (navigation && !window.confirm('End the simulation to change region? Export observations first to keep them.')) return;
    setNavigation(null); setInspectedPoint(null);
    setRegion(next); setPicking(null); setDossier(null);
    if (next !== 'Gale Crater' && (layerId === 'ctx' || layerId.startsWith('hirise-'))) setLayerId('mola');
    setFocus({ point: next === 'Gale Crater' ? gale : jezero, zoom: 10 });
  }
  function openDossier(feature: Feature) {
    setLeft('science'); setDossier(feature);
  }
  function selectLayer(id: string) {
    setLayerId(id);
    if (id.startsWith('hirise-') && detailBounds) {
      const [west, south, east, north] = detailBounds;
      setFocus({ point: { lat: (north + south) / 2, lon: (west + east) / 2 }, zoom: 16 });
    }
  }
  async function exportManifest() {
    if (!selected || !comparison) return;
    setExporting(true); setError('');
    try {
      const response = await api('/mission/export', { request: comparison.request, strategy: selected.strategy });
      const name = response.headers.get('content-disposition')?.match(/filename="([^"]+)"/)?.[1];
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url; link.download = name ?? 'AEROSMITH_MARS_EVA_MANIFEST.json';
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Manifest export failed.');
    } finally {
      setExporting(false);
    }
  }
  function newMission() {
    if (navigation && !window.confirm('End the current simulation and start a new plan? Export observations first to keep them.')) return;
    resetResult(); setSavedMission(null); setPoints(blank); setPicking(null); 
    setPlannerSettings({ grade: '15', weight: '8', pace: '', waypoint: '' });
    setPage('map');
  }
  function restoreMission(mission: SavedMission) {
    if (navigation && !window.confirm('End the current simulation to open this plan? Export observations first to keep them.')) return;
    resetResult();
    setRegion(mission.region);
    setPoints([mission.start, mission.destination]);
    setComparison(mission.comparison);
    setSelection(mission.comparison?.routes.find(route => route.strategy === mission.selected_strategy)?.id);
    const settings = mission.comparison?.request ?? mission.settings;
    setPlannerSettings({
      terrainScreening: settings.terrain_screening ?? false, grade: String(settings.max_grade_deg), weight: String(settings.grade_weight),
      pace: settings.pace_kmh === null ? '' : String(settings.pace_kmh),
      waypoint: settings.waypoint_id ?? '',
    });
    setPicking(null); setDossier(null); setSavedMission(mission);
    setFocus({ point: mission.start ?? mission.destination ?? (mission.region === 'Gale Crater' ? gale : jezero), zoom: 9 });
    setPage('map');
  }
  const draft: MissionDraft = {
    region: region === 'Jezero Crater' ? 'Jezero Crater' : 'Gale Crater',
    start: region === 'Gale Crater' ? points[0] : null,
    destination: region === 'Gale Crater' ? points[1] : null,
    settings: routeSettings(plannerSettings),
    comparison_id: region === 'Gale Crater' ? comparison?.id ?? null : null,
    selected_strategy: region === 'Gale Crater' ? selected?.strategy ?? null : null,
  };

  async function applyCommanderActions(actions: CommanderAction[]) {
    if (navigation) throw new Error('End the active simulation before changing the plan.');
    let latestComparison = comparison;
    let endpoints: [Point | null, Point | null] = [...points];
    for (const action of actions) {
      const feature = features.find(item => item.id === action.target);
      if (['focus', 'start', 'destination'].includes(action.kind)) {
        if (!feature?.coordinate) throw new Error('Scientific location is unavailable.');
        if (action.kind !== 'focus' && feature.region !== 'Gale Crater') throw new Error('Terrain routing is available in Gale Crater.');
        changeRegion(feature.region); setPage('map'); openDossier(feature);
        setFocus({ point: feature.coordinate, zoom: 11 });
        if (action.kind !== 'focus') {
          const index = action.kind === 'start' ? 0 : 1;
          endpoints[index] = feature.coordinate; latestComparison = null; resetResult(); setPoints([...endpoints]);
        }
      } else if (action.kind === 'overlay') {
        const [name, value] = action.target.split(':');
        if (name === 'science') setShowFeatures(value === 'on');
        if (name === 'traverse') setShowTraverse(value === 'on');
        if (name === 'coverage') setShowBounds(value === 'on');
      } else if (action.kind === 'region') changeRegion(action.target);
      else if (action.kind === 'layer') selectLayer(action.target);
      else if (action.kind === 'globe') setPage('globe');
      else if (action.kind === 'select_route') {
        const route = latestComparison?.routes.find(item => item.strategy === action.target);
        if (!route) throw new Error('Calculate routes before selecting this alternative.');
        setSelection(route.id);
      } else if (action.kind === 'calculate') {
        if (!endpoints[0] || !endpoints[1]) throw new Error('Choose both mission endpoints first.');
        latestComparison = await calculate({ ...routeSettings(plannerSettings), terrain_screening: true, start: endpoints[0], destination: endpoints[1] }) ?? null;
        if (!latestComparison?.routes.length) throw new Error('Route calculation failed or no alternative satisfies the settings. Review the planner.');
      }
    }
    const results = latestComparison?.routes.map(route => `${route.strategy}: ${(route.distance_m / 1000).toFixed(2)} km, ascent ${route.ascent_m} m, peak segment grade ${route.max_segment_grade_deg}°, duration ${route.duration_min === null ? 'pace required' : route.duration_min + ' min'}`).join('\n');
    return 'Proposal applied. ' + (results || 'Review the updated map.');
  }
  const localFeatures = useMemo(() => features.filter(feature => feature.region === region), [features, region]);
  return <div className="application">
    <header className="topbar">
      <button className="brand" onClick={() => setPage('map')} aria-label="Aerosmith home"><span className="brand-icon"><img src="/mars-logo.png" alt="" width="40" height="40" /></span><span><strong>AEROSMITH</strong><small>MARS EXPLORATION OPERATIONS SYSTEM</small></span></button>
      <nav aria-label="Main navigation">{nav.map(({ id, name, icon: Icon }) => <button key={id} aria-label={name} title={name} className={page === id ? 'active' : ''} aria-current={page === id ? 'page' : undefined} onClick={() => setPage(id)}><Icon size={16}/>{name}</button>)}</nav>
      <div className="prototype"><span className="dot"/> STUDENT PROTOTYPE</div>
    </header>
    {failed && <div className="connection" role="alert">Local API unavailable. Start FastAPI and retry. <button className="secondary" onClick={load}>Retry connection</button></div>}
    {(page === 'map' || page === 'globe') && <>
      <div className="mission-head">
        <div><div className="kicker"><span className="dot"/> MARS SURFACE OPERATIONS</div><h1>{page === 'globe' ? 'Mars globe' : region === 'Gale Crater' ? 'Mount Sharp' : 'Jezero Crater'} <span>/ {region === 'Gale Crater' ? 'Gale Crater' : 'Mars 2020'}</span></h1></div>
        <div className="mission-actions">
          {page === 'globe' && localTerrain && region === 'Gale Crater' && detailBounds && <button className="secondary" onClick={() => setDetailTerrain(value => !value)}>{detailTerrain ? 'Regional MOLA terrain' : 'Detailed HiRISE terrain'}</button>}
          {page === 'globe' && region === 'Gale Crater' && <button className="secondary" aria-pressed={localTerrain} onClick={() => setLocalTerrain(value => !value)}>{localTerrain ? 'Global globe' : 'Local Gale terrain'}</button>}
          <button className="secondary" onClick={() => setPage('saved')}>{savedMission ? "Manage saved mission" : "Save current mission"}</button><label className="region-select">MISSION REGION<select value={region} onChange={event => changeRegion(event.target.value)}><option>Gale Crater</option><option value="Jezero Crater">Jezero Crater · Explore only</option></select></label></div>
      </div>
      <section className="destination-search" aria-label="Find destination">
        <input aria-label="Search Mars destinations" disabled={!!navigation} placeholder="Search a location, geology, or latitude, longitude" value={search} onChange={event => { setSearch(event.target.value); setSearchError(''); }}/>
        {search && !navigation && <div className="search-results">{features.filter(feature => [feature.name, feature.category, feature.description].join(' ').toLowerCase().includes(search.toLowerCase())).slice(0, 8).map(feature => <button key={feature.id} onClick={() => { changeRegion(feature.region); openDossier(feature); if (feature.coordinate) setFocus({ point: feature.coordinate, zoom: 11 }); setSearch(''); }}>{feature.name} · {feature.region}</button>)}
        <button onClick={() => { const parts = search.split(',').map(value => value.trim()); const values = parts.map(Number); if (parts.length === 2 && parts.every(Boolean) && values.every(Number.isFinite) && Math.abs(values[0]) <= 90 && values[1] >= -180 && values[1] <= 360) { setFocus({ point: { lat: values[0], lon: values[1] }, zoom: 12 }); setSearch(''); } else setSearchError('Enter both latitude and longitude, or select a location.'); }}>Locate coordinates</button>{searchError && <p role="alert">{searchError}</p>}</div>}
      </section>
      <main className={`workspace ${navigation ? 'navigating' : ''}`}>

        <aside className="panel explorer">
          <div className="panel-title"><Aperture size={18}/><h2>Surface explorer</h2></div>
          <div className="panel-tabs"><button className={left === 'layers' ? 'active' : ''} onClick={() => setLeft('layers')}><Layers3 size={14}/> Layers</button><button className={left === 'science' ? 'active' : ''} onClick={() => setLeft('science')}><BookOpen size={14}/> Science</button></div>
          <div className="panel-body">{left === 'layers' ? <>
            <div className="section-label">Basemap <span>NASA TREK</span></div>
            {layers.map(layer => <label key={layer.id} title={layer.description} className={`layer-option ${layer.id === layerId ? 'active' : ''}`}>
              <span className={`layer-chip ${layer.id}`}/><span><b>{layer.name}</b><small>{layer.coverage} · {layer.resolution}</small></span><input type="radio" aria-describedby={`layer-description-${layer.id}`} name="map-layer" checked={layer.id === layerId} onChange={() => selectLayer(layer.id)}/>
              <span className="layer-hover-description" id={`layer-description-${layer.id}`}>{layer.description}</span>
            </label>)}
            {loading && <p className="muted">Loading scientific layers…</p>}
            {activeLayer && <div className="active-source"><p>{activeLayer.description}</p><a className="source-link" href={activeLayer.url} target="_blank" rel="noreferrer">Source details <ArrowUpRight size={13}/></a></div>}
            {sources.filter(source => ['crism','radiation','dust'].includes(source.id)).map(source =>
              <p key={source.id} className="muted unavailable-layer">{source.name} · Unavailable</p>)}
            <div className="section-label with-gap">Scientific categories</div>
            {[...new Set(localFeatures.map(feature => feature.category))].map(category => <label className="toggle" key={category}>{category}<input type="checkbox" checked={!hiddenCategories.includes(category)} onChange={() => setHiddenCategories(items => items.includes(category) ? items.filter(item => item !== category) : [...items, category])}/></label>)}
            <div className="section-label with-gap">Overlays</div>
            <label className="toggle">Curiosity historical track<input type="checkbox" checked={showTraverse} onChange={event => setShowTraverse(event.target.checked)}/></label>
            {showTraverse && !traverse && <p role="status">{traverseError ? 'Track unavailable. Toggle off and on to retry.' : 'Loading historical track…'}</p>}
            <label className="toggle">Science locations<input type="checkbox" checked={showFeatures} onChange={event => setShowFeatures(event.target.checked)}/></label>
            <label className="toggle">MOLA routing coverage<input type="checkbox" checked={showBounds} disabled={!terrain} onChange={event => setShowBounds(event.target.checked)}/></label>
          </> : dossier ? <Dossier feature={dossier} observations={observations} onImage={setImage} onClose={() => setDossier(null)}
            onLocate={() => dossier.coordinate && setFocus({ point: dossier.coordinate, zoom: 11 })}
            onUse={index => { if (!navigation && dossier.coordinate) setEndpoint(index, dossier.coordinate); }}/>
            : <ScienceCatalogue features={localFeatures} onSelect={openDossier}/>}</div>
          <div className="panel-foot"><span className="dot"/> ARCHIVAL PLANETARY DATA</div>
        </aside>
        {page === 'globe' ? <Suspense fallback={<section className="map-shell">Loading globe…</section>}>{localTerrain && region === 'Gale Crater' ? <LocalTerrain key={String(detailTerrain)} detail={detailTerrain} routeOutside={!!selected && (selected.terrain_id === 'hirise-sulfate') !== detailTerrain} route={selected && ((selected.terrain_id === 'hirise-sulfate') === detailTerrain) ? selected : undefined}/> : <Globe
          layers={layers.filter(layer => !layer.id.startsWith('hirise-'))} layerId={layerId.startsWith('hirise-') ? 'ctx' : layerId} onLayer={selectLayer} features={showFeatures ? features : []}
          dossier={dossier} focus={focus} inspectedPoint={inspectedPoint} points={points} routes={comparison?.routes ?? []} selected={selection}
          picking={picking !== null} onFeature={openDossier} onPoint={point => picking !== null && setEndpoint(picking, point)}
          onOpenMap={point => { setFocus({ point, zoom: 10 }); setPage('map'); }}
          traverse={showTraverse ? traverse : undefined} bounds={showBounds ? bounds : undefined}
        />}</Suspense> : <MarsMap overview={overview} nextPosition={navigation?.profile[Math.min(navigationState.index + 1, navigation.profile.length - 1)]?.point} inspectionLabel={navigation ? "Simulated astronaut" : undefined} inspectedPoint={inspectedPoint} traverse={showTraverse ? traverse : undefined} layers={layers} layerId={layerId} features={localFeatures.filter(feature => !hiddenCategories.includes(feature.category))} showFeatures={showFeatures} showBounds={showBounds}
          bounds={bounds} points={region === 'Gale Crater' ? points : blank} routes={navigation ? [navigation] : region === 'Gale Crater' ? comparison?.routes ?? [] : []}
          picking={picking !== null} selected={selection} focus={focus}
          onPoint={point => picking !== null && setEndpoint(picking, point)} onFeature={openDossier}/>}
        {navigation ? <MissionNavigation key={navigation.id} route={navigation} state={navigationState} setState={setNavigationState} onOverview={() => setOverview(value => value + 1)} features={features} onPosition={sample => { setInspectedPoint(sample.point); setFocus({ point: sample.point, zoom: navigation.terrain_id === 'hirise-sulfate' ? 16 : 11 }); }} onEnd={() => { setNavigation(null); setInspectedPoint(null); }}/> : region === 'Gale Crater' ? <Planner settings={plannerSettings} onSettings={settings => { resetResult(); setPlannerSettings(settings); }} points={points} picking={picking} terrain={terrain} comparison={comparison} selected={selected}
          features={features} recommended={recommended} reviewNotice={reviewNotice} busy={busy} exporting={exporting} error={error} onPick={setPicking} onSet={setEndpoint}
          onReset={() => { resetResult(); setPoints(blank); setPicking(null); }}
          onExample={() => { resetResult(); setPoints([{ lat: -4.62, lon: 137.38 }, { lat: -4.94, lon: 137.59 }]); setPicking(null); setFocus({ point: { lon: 137.49, lat: -4.78 }, zoom: 9.3 }); }}
          onLocalExample={detailBounds ? () => {
            const [west, south, east, north] = detailBounds;
            resetResult(); setPicking(null);
            setPoints([{ lat: south + (north-south)*.2, lon: west + (east-west)*.65 }, { lat: south + (north-south)*.8, lon: west + (east-west)*.7 }]);
            setPlannerSettings({ grade: '30', weight: '8', pace: '', waypoint: '' });
            setLayerId('hirise-image');
            setFocus({ point: { lat: (south+north)/2, lon: (west+east)/2 }, zoom: 16 });
          } : undefined}
          onCalculate={calculate} onSample={sample => setInspectedPoint(sample?.point ?? null)} onSelect={id => { setSelection(id); setInspectedPoint(null); }} onExport={exportManifest}/>
          : <aside className="panel planner"><div className="panel-title"><RouteIcon size={18}/><h2>Traverse planner</h2></div><div className="panel-body"><p>Terrain routing is available for the Gale Crater elevation grid.</p><button className="secondary" onClick={() => changeRegion('Gale Crater')}>Return to Gale Crater</button></div></aside>}
      </main>
      {selected && !navigation && region === 'Gale Crater' && <button className="primary start-mission" onClick={() => { setNavigationState({ index: 0, paused: false, notes: [] }); setNavigation(selected); setPage('map'); setInspectedPoint(selected.profile[0].point); }}>START MISSION · Simulation</button>}
    </>}
    {page === 'gallery' && <Gallery observations={observations} onImage={setImage}/>}
    {page === 'sources' && <Sources sources={sources}/>}
    {page === 'saved' && <SavedMissions draft={draft} active={savedMission} onSaved={setSavedMission} onOpen={restoreMission} onNew={newMission}/>}
    <footer><span>TEAM AEROSMITH · MEOS</span><span>Educational prototype · Archival data and modeled routes</span></footer>
    <MissionAssistant onAction={applyCommanderActions} context={{
      page, region, simulation: navigation ? { status: navigationState.paused ? "paused" : "active", route_id: navigation.id, position: inspectedPoint } : null, map_center: focus.point, layer: activeLayer?.name,
      start: points[0], destination: points[1], mission: savedMission,
      selected_route: selection, settings: routeSettings(plannerSettings),
      routes: comparison?.routes.map(({ profile, ...route }) => ({ ...route,
        profile: profile.filter((_, index) => index % Math.max(1, Math.ceil(profile.length / 6)) === 0),
        profile_sampling: 'Up to 6 samples; summary metrics use the complete route',
      })), limitations: comparison?.limits, advisory: comparison?.advisory,
      selected_science: dossier,
      observations: dossier ? observations.filter(item => item.featureId === dossier.id).slice(0, 2).map(({ title, description, url }) => ({ title, description, url })) : [],
      sources: sources.filter(source => source.id === layerId || source.id === selected?.terrain_id).map(({ name, url, status, resolution }) => ({ name, url, status, resolution })),
    }}/>
    <dialog ref={dialog} onClose={() => setImage(null)} className="lightbox">
      {image && <><div className="lightbox-title"><h2>{image.title}</h2><button className="icon" aria-label="Close image" onClick={() => setImage(null)}><X size={22}/></button></div><img src={image.image} alt={image.title}/>
        <p>{image.mission} · {image.region} · {image.camera}{image.sol && ` · Sol ${image.sol} · ${image.date}`}</p><p>{image.description}</p><div className="lightbox-footer"><small>{image.credit} · {image.id}</small><a className="source-link" href={image.url} target="_blank" rel="noreferrer">Original NASA/JPL image <ArrowUpRight size={14}/></a></div></>}
    </dialog>
  </div>;
}
