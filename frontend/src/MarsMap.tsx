import { useEffect, useRef, useState } from 'react';
import { Compass, Crosshair, Minus, Plus } from 'lucide-react';
import 'ol/ol.css';
import Map from 'ol/Map';
import View from 'ol/View';
import Feature from 'ol/Feature';
import { defaults as defaultControls } from 'ol/control/defaults';
import PointGeometry from 'ol/geom/Point';
import LineString from 'ol/geom/LineString';
import Polygon from 'ol/geom/Polygon';
import ImageLayer from 'ol/layer/Image';
import ImageStatic from 'ol/source/ImageStatic';
import MultiLineString from 'ol/geom/MultiLineString';
import MultiPoint from 'ol/geom/MultiPoint';
import TileLayer from 'ol/layer/Tile';
import VectorLayer from 'ol/layer/Vector';
import Projection from 'ol/proj/Projection';
import WMTS from 'ol/source/WMTS';
import VectorSource from 'ol/source/Vector';
import WMTSTileGrid from 'ol/tilegrid/WMTS';
import { Circle, RegularShape, Fill, Stroke, Style, Text } from 'ol/style';
import { itineraryLine, type MarsWaypoint } from './itinerary';
import { coord, east, gale, read, strategies, type Feature as ScienceFeature, type Point, type MapLayer, type Route, type Traverse } from './model';

const projection = new Projection({
  code: 'MARS:104905', units: 'degrees', extent: [-180, -90, 180, 90], global: true,
  metersPerUnit: 3396000 * Math.PI / 180,
});
const resolutions = Array.from({ length: 19 }, (_, z) => 360 / (512 * 2 ** z));
const xy = (point: Point) => [((point.lon + 540) % 360) - 180, point.lat];

// Round the display near existing turns. Keep straight sections and the endpoints intact.
function routeDisplay(points: number[][]) {
  const track = [points[0]];
  const markers = [points[0]];
  const interpolate = (a: number[], b: number[], t: number) =>
    a.map((value, axis) => value + (b[axis] - value) * t);
  for (let index = 1; index < points.length - 1; index++) {
    const [before, corner, after] = points.slice(index - 1, index + 2);
    const cross = (corner[0] - before[0]) * (after[1] - corner[1])
      - (corner[1] - before[1]) * (after[0] - corner[0]);
    if (Math.abs(cross) < 1e-14) {
      track.push(corner);
      markers.push(corner);
      continue;
    }
    const entry = interpolate(corner, before, 0.32);
    const exit = interpolate(corner, after, 0.32);
    for (let step = 0; step <= 8; step++) {
      const t = step / 8;
      const position = interpolate(interpolate(entry, corner, t), interpolate(corner, exit, t), t);
      track.push(position);
      if (step === 4) markers.push(position);
    }
  }
  track.push(points[points.length - 1]);
  markers.push(points[points.length - 1]);
  return { track, markers };
}

const marker = (label: string, color: string) => new Style({
  image: new Circle({ radius: 5, fill: new Fill({ color }), stroke: new Stroke({ color: '#141711', width: 2 }) }),
  text: new Text({ text: label, offsetY: -17, font: '600 12px Barlow, sans-serif', padding: [3, 7, 3, 7],
    fill: new Fill({ color: '#f6f3e8' }), backgroundFill: new Fill({ color: '#151813e6' }) }),
  zIndex: 5,
});

type Props = {
  nextPosition?: Point; overview?: number; inspectionLabel?: string; itinerary?: MarsWaypoint[]; activeWaypoint?: string; fitItinerary?: number; onWaypoint?: (id: string) => void;
  layers: MapLayer[]; layerId: string; features: ScienceFeature[]; showFeatures: boolean;
  showBounds: boolean; traverse?: Traverse; bounds?: number[]; points: [Point | null, Point | null]; picking: boolean;
  routes: Route[]; inspectedPoint: Point | null; selected?: string; focus: { point: Point; zoom: number };
  onPoint: (point: Point) => void; onFeature: (feature: ScienceFeature) => void;
};
export function MarsMap(props: Props) {
  const target = useRef<HTMLDivElement>(null);
  const map = useRef<Map | null>(null);
  const itinerarySource = useRef(new VectorSource());
  const inspection = useRef(new VectorSource());
  const vectors = useRef(new VectorSource());
  const callbacks = useRef(props);
  callbacks.current = props;
  const [view, setView] = useState({ point: gale, zoom: 10 });
  const [contrast, setContrast] = useState(1);
  const [coverage, setCoverage] = useState(true);
  const sampleTicket = useRef(0);
  const [terrainSample, setTerrainSample] = useState('');
  useEffect(() => {
    sampleTicket.current++;
    setTerrainSample('');
    return () => { sampleTicket.current++; };
  }, [props.layerId, props.picking]);
  const [status, setStatus] = useState('Connecting');
  const layer = props.layers.find(item => item.id === props.layerId);

  useEffect(() => {
    const instance = new Map({
      target: target.current!, view: new View({
        projection, center: xy(callbacks.current.focus.point), zoom: callbacks.current.focus.zoom,
        resolutions, minZoom: 2, maxZoom: 18, enableRotation: false,
      }), layers: [new VectorLayer({ source: itinerarySource.current, zIndex: 12 }), new VectorLayer({ source: vectors.current, zIndex: 10 }), new VectorLayer({ source: inspection.current, zIndex: 11 })],
      controls: defaultControls({ zoom: false, attribution: false, rotate: false }),
    });
    map.current = instance;
    const update = () => {
      const center = instance.getView().getCenter()!;
      setView({ point: { lon: east(center[0]), lat: center[1] }, zoom: instance.getView().getZoom()! });
    };
    update();
    instance.on('moveend', update);
    instance.on('singleclick', event => {
      const current = callbacks.current;
      const waypointId = instance.forEachFeatureAtPixel(event.pixel, feature => feature.get('waypointId'), { hitTolerance: 8 });
      if (!current.picking && waypointId) { current.onWaypoint?.(waypointId); return; }
      const featureId = instance.forEachFeatureAtPixel(event.pixel, feature => feature.get('scienceId'), { hitTolerance: 6 });
      if (!current.picking && featureId) {
        const feature = current.features.find(item => item.id === featureId);
        if (feature) { current.onFeature(feature); return; }
      }
      const point = { lon: east(event.coordinate[0]), lat: event.coordinate[1] };
      if (current.picking) { current.onPoint(point); return; }
      if (!current.layerId.startsWith('hirise-')) return;
      if (point.lat < -90 || point.lat > 90) return;
      const ticket = ++sampleTicket.current;
      setTerrainSample('Reading terrain…');
      void read<{ point: Point; elevation_m: number; pixel_m: number }>(
        `/terrain/hirise/sample?lat=${point.lat}&lon=${point.lon}`,
      ).then(sample => {
        if (ticket === sampleTicket.current) {
          setTerrainSample(`${coord(sample.point, 6)} · ${sample.elevation_m.toFixed(1)} m above areoid · HiRISE ${sample.pixel_m.toFixed(3)} m posting`);
        }
      }).catch(cause => {
        if (ticket === sampleTicket.current) setTerrainSample(String(cause.message ?? cause));
      });
    });
    instance.on('pointermove', event => {
      const hit = instance.forEachFeatureAtPixel(event.pixel, feature => feature.get('scienceId') || feature.get('waypointId'), { hitTolerance: 5 });
      target.current!.style.cursor = callbacks.current.picking ? 'crosshair' : hit ? 'pointer' : '';
    });
    return () => { instance.setTarget(undefined); map.current = null; };
  }, []);

  useEffect(() => {
    map.current?.getView().animate({ center: xy(props.focus.point), zoom: props.focus.zoom, duration: 380 });
  }, [props.focus]);

  useEffect(() => {
    setCoverage(layer?.id !== 'ctx' || (view.point.lon >= layer.bounds[0] && view.point.lon <= layer.bounds[2]
      && view.point.lat >= layer.bounds[1] && view.point.lat <= layer.bounds[3]));
  }, [layer, view.point]);

  useEffect(() => {
    if (!map.current || !layer) return;
    const instance = map.current;
    if (layer.raster) {
      const source = new ImageStatic({ url: layer.raster, imageExtent: layer.bounds, projection });
      setStatus('Loading raster');
      source.on('imageloadend', () => setStatus('Archive available'));
      source.on('imageloaderror', () => setStatus('Raster unavailable'));
      const raster = new ImageLayer({ source, zIndex: 1 });
      const ortho = (layer.id === 'hirise-slope' || layer.id === 'hirise-contours') ? new ImageLayer({
        source: new ImageStatic({ url: '/rasters/gale-hirise.png', imageExtent: layer.bounds, projection }), zIndex: 0,
      }) : null;
      if (ortho) instance.addLayer(ortho);
      instance.addLayer(raster);
      return () => {
        instance.removeLayer(raster); source.dispose();
        if (ortho) { instance.removeLayer(ortho); ortho.getSource()?.dispose(); }
      };
    }
    const makeTiles = (item: MapLayer) => new WMTS({
      url: item.template, projection, layer: item.layer, matrixSet: item.matrixSet,
      format: item.format, style: 'default', requestEncoding: 'REST', wrapX: true,
      tileGrid: new WMTSTileGrid({
        origins: item.matrices.map(level => level.origin),
        resolutions: item.matrices.map((_, i) => resolutions[i]),
        matrixIds: item.matrices.map(level => level.id),
        sizes: item.matrices.map(level => level.size),
        tileSizes: item.matrices.map(level => level.tileSize),
      }),
    });
    const source = makeTiles(layer);
    let loaded = false;
    setStatus('Connecting');
    source.on('tileloadend', () => { loaded = true; setStatus('Archive available'); });
    source.on('tileloaderror', () => setStatus(loaded ? 'Some tiles unavailable' : 'Tiles unavailable'));
    const raster = new TileLayer({ source, extent: layer.id === 'ctx' ? layer.bounds : undefined, zIndex: 1 });
    const fallback = props.layers.find(item => item.id === 'mola');
    const backdrop = layer.id === 'ctx' && fallback ? new TileLayer({ source: makeTiles(fallback), zIndex: 0 }) : null;
    if (backdrop) instance.addLayer(backdrop);
    instance.addLayer(raster);
    return () => {
      instance.removeLayer(raster);
      if (backdrop) instance.removeLayer(backdrop);
      source.dispose();
      backdrop?.getSource()?.dispose();
    };
  }, [layer, props.layers]);

  useEffect(() => {
    const source = vectors.current;
    source.clear();
    const bounds = props.bounds;
    if (props.showBounds && bounds) {
      const [w, s, e, n] = bounds;
      const box = new Feature(new Polygon([[[w, s], [e, s], [e, n], [w, n], [w, s]]]));
      box.setStyle(new Style({ stroke: new Stroke({ color: '#d3f7aabb', width: 1.5, lineDash: [8, 5] }) }));
      source.addFeature(box);
    }
    if (props.traverse) {
      const line = new Feature(new MultiLineString(props.traverse.paths));
      line.setStyle(new Style({ stroke: new Stroke({ color: '#f59e0b', width: 2 }) }));
      const stops = new Feature(new MultiPoint(props.traverse.waypoints.map(xy)));
      stops.setStyle(new Style({ image: new Circle({ radius: 2, fill: new Fill({ color: '#fff' }) }) }));
      source.addFeatures([line, stops]);
    }
    for (const route of props.routes) {
      // A track requires at least two routed samples.
      if (route.profile.length < 2) continue;
      const primary = props.selected === route.id;
      const { track, markers } = routeDisplay(route.profile.map(sample => xy(sample.point)));
      const line = new Feature(new LineString(track));
      const width = primary ? 4 : 3;
      const zIndex = primary ? 4 : 2;
      line.setStyle([
        new Style({
          stroke: new Stroke({ color: '#17121bcc', width: width + 2, lineCap: 'round', lineJoin: 'round' }),
          zIndex,
        }),
        new Style({
          stroke: new Stroke({ color: strategies[route.strategy].color, width, lineCap: 'round', lineJoin: 'round' }),
          zIndex: zIndex + 0.1,
        }),
      ]);
      const stride = Math.max(1, Math.ceil(markers.length / 45));
      const dots = new Feature(new MultiPoint(markers.filter((_, index) =>
        index % stride === 0 || index === markers.length - 1)));
      dots.setStyle(new Style({
        image: new Circle({
          radius: primary ? 3.3 : 2.6,
          fill: new Fill({ color: '#fff8ed' }),
          stroke: new Stroke({ color: strategies[route.strategy].color, width: 1 }),
        }),
        zIndex: zIndex + 0.2,
      }));
      source.addFeatures([line, dots]);
      if (primary && route.profile.length) {
        for (const [label, sample] of [['Routed start', route.profile[0]], ['Routed finish', route.profile[route.profile.length - 1]]] as const) {
          const endpoint = new Feature(new PointGeometry(xy(sample.point)));
          endpoint.setStyle(marker(label, '#F2EEE9'));
          source.addFeature(endpoint);
        }
      }
    }
    if (props.showFeatures) for (const science of props.features) {
      if (!science.coordinate) continue;
      const feature = new Feature({ geometry: new PointGeometry(xy(science.coordinate)), scienceId: science.id });
      const symbol = marker(science.name, '#caeaa0');
      const category = science.category.toLowerCase();
      const points = /crater|landing/.test(category) ? 4 : /ridge|mount|valley|geolog/.test(category) ? 3 : 5;
      symbol.setImage(new RegularShape({ points, radius: 7, radius2: points === 5 ? 3 : undefined, angle: points === 4 ? Math.PI / 4 : 0,
        fill: new Fill({ color: points === 3 ? '#f5bd78' : points === 4 ? '#7cdce3' : '#caeaa0' }),
        stroke: new Stroke({ color: '#141711', width: 2 }),
      }));
      feature.setStyle(symbol);
      source.addFeature(feature);
    }
    props.points.forEach((point, index) => {
      if (!point) return;
      const feature = new Feature(new PointGeometry(xy(point)));
      feature.setStyle(marker(index ? 'B · Destination' : 'A · Start', index ? '#f5bd78' : '#7cdce3'));
      source.addFeature(feature);
    });
  }, [props.bounds, props.features, props.points, props.routes, props.selected, props.showBounds, props.showFeatures, props.traverse]);

  useEffect(() => {
    const source = inspection.current;
    source.clear();
    if (props.nextPosition) {
      const next = new Feature(new PointGeometry(xy(props.nextPosition)));
      next.setStyle(marker('Next route sample', '#f5bd78'));
      source.addFeature(next);
    }
    if (props.inspectedPoint) {
      const point = new Feature(new PointGeometry(xy(props.inspectedPoint)));
      point.setStyle(marker(props.inspectionLabel ?? 'Profile sample', '#fff'));
      source.addFeature(point);
    }
  }, [props.inspectedPoint, props.inspectionLabel, props.nextPosition]);

  useEffect(() => {
    const source = itinerarySource.current;
    source.clear();
    const points = props.itinerary ?? [];
    const coordinates = itineraryLine(points);
    if (coordinates.length > 1) {
      const line = new Feature(new LineString(coordinates));
      line.setStyle(new Style({ stroke: new Stroke({ color: '#69C7D0', width: 3, lineDash: [8, 6] }) }));
      source.addFeature(line);
    }
    points.forEach((point, index) => {
      const feature = new Feature({ geometry: new PointGeometry(xy(point)), waypointId: point.id });
      feature.setStyle(marker(`${index === 0 ? 'Start' : index} · ${point.name}`, props.activeWaypoint === point.id ? '#ffffff' : '#F07848'));
      source.addFeature(feature);
    });
  }, [props.itinerary, props.activeWaypoint]);
  useEffect(() => {
    if (!props.fitItinerary || !props.itinerary?.length) return;
    const geometry = new LineString(itineraryLine(props.itinerary));
    map.current?.getView().fit(geometry.getExtent(), { padding: [70, 60, 70, 60], maxZoom: 11, duration: 400 });
  }, [props.fitItinerary]);

  useEffect(() => {
    const route = props.routes.find(item => item.id === props.selected);
    if (props.overview && route) map.current?.getView().fit(new LineString(route.profile.map(sample => xy(sample.point))).getExtent(), { padding: [90, 80, 80, 80], maxZoom: 17, duration: 300 });
  }, [props.overview]);
  const zoom = (delta: number) => {
    const current = map.current?.getView();
    current?.animate({ zoom: current.getZoom()! + delta, duration: 160 });
  };
  const kmPerPx = resolutions[0] / 2 ** view.zoom * 3396 * Math.PI / 180 * Math.cos(view.point.lat * Math.PI / 180);
  const magnitude = 10 ** Math.floor(Math.log10(kmPerPx * 92));
  const scale = [1, 2, 5, 10].map(n => n * magnitude).find(value => value / kmPerPx >= 55) ?? magnitude;
  return <section className={`map-shell ${props.picking ? 'picking' : ''}`} aria-label="Interactive Mars map">
    <div className="map-canvas" style={{ filter: `contrast(${contrast})` }} ref={target} tabIndex={0} aria-label="Mars map. Use arrow keys to pan and plus or minus to zoom." />
    <div className="map-grid" />
    <div className="map-label"><span className="dot" /> {layer?.name ?? 'Mars map'} · {layer?.resolution} <span className="map-label-status">· {coverage ? status : 'Outside regional coverage'}</span></div>
    <div className="map-tools"><label className="contrast-control">Contrast<input aria-label="Terrain contrast" type="range" min="0.8" max="1.4" step="0.05" value={contrast} onChange={event => setContrast(Number(event.target.value))}/></label>
      <div className="north"><Compass size={20} /><small>N</small></div>
      <div className="zoom-tools">
        <button title="Zoom in" aria-label="Zoom in" onClick={() => zoom(1)}><Plus size={19} /></button>
        <button title="Zoom out" aria-label="Zoom out" onClick={() => zoom(-1)}><Minus size={19} /></button>
      </div>
      <button title="Recenter map" aria-label="Recenter map" onClick={() => map.current?.getView().animate({ center: xy(props.focus.point), zoom: props.focus.zoom, duration: 320 })}><Crosshair size={18} /></button>
    </div>
    <div className="marker-legend">▲ Geological formation · ◆ Crater / landing · ★ Science / landmark</div><div className="map-scale"><div style={{ width: scale / kmPerPx }} />{scale >= 1 ? `${scale} km` : `${Math.round(scale * 1000)} m`} E–W</div>
    {!props.picking && layer?.id.startsWith('hirise-') && <div className="terrain-readout" role="status">
      {terrainSample || 'Click the map to inspect HiRISE elevation.'}
    </div>}
    <div className="map-credit">{layer?.attribution ?? 'NASA Mars Trek'}{layer?.id === 'ctx' && ' · MOLA backdrop'}</div>
    <div className="map-meter"><span>{coord(view.point)}</span><span>ZOOM {view.zoom.toFixed(1)}</span><span>PLANETOCENTRIC / +E</span></div>
  </section>;
}
