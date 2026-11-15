import { useEffect, useRef, useState } from 'react';
import { Crosshair, Map as MapIcon } from 'lucide-react';
import * as T from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { coord, gale, strategies, type Feature, type MapLayer, type Point, type Route, type Traverse } from './model';
import { EQUATOR_KM, Y_RATIO, geoToVector3, vector3ToGeo } from './marsGeodesy';

const files: Record<string, string> = {
  viking: '/rasters/viking-4096.jpg', mola: '/rasters/mola-4096.jpg',
  hrsc: '/rasters/hrsc-4096.jpg', ctx: '/rasters/ctx-4096.jpg', roughness: '/rasters/roughness-1024.jpg',
};
const shapeOptions = { oblate: Y_RATIO, exaggerated: 1 - 6 * (1 - Y_RATIO), sphere: 1 };
const radius = 2;
const focusDistance = radius * (1 + 370 / EQUATOR_KM);
const fullDistance = 7.8;
const vector = (point: Point, r = radius) => geoToVector3(point.lat, point.lon, r, 1);

type Props = {
  layers: MapLayer[]; layerId: string; onLayer: (id: string) => void;
  features: Feature[]; dossier: Feature | null; focus: { point: Point };
  points: [Point | null, Point | null]; inspectedPoint: Point | null; routes: Route[]; selected?: string;
  picking: boolean; onPoint: (point: Point) => void; onFeature: (feature: Feature) => void;
  onOpenMap: (point: Point) => void; traverse?: Traverse; bounds?: number[];
};

function makeLabel(text: string, color: string) {
  const canvas = document.createElement('canvas');
  canvas.width = 320; canvas.height = 112;
  const context = canvas.getContext('2d')!;
  context.strokeStyle = color;
  context.lineWidth = 5;
  context.beginPath(); context.arc(160, 84, 12, 0, 2 * Math.PI); context.stroke();
  context.font = 'bold 24px Barlow, sans-serif';
  const width = Math.min(310, context.measureText(text).width + 20);
  context.fillStyle = '#121911e8'; context.fillRect((320 - width) / 2, 24, width, 36);
  context.textAlign = 'center'; context.fillStyle = color; context.fillText(text, 160, 50, 306);
  const texture = new T.CanvasTexture(canvas);
  texture.colorSpace = T.SRGBColorSpace;
  const sprite = new T.Sprite(new T.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, alphaTest: .08 }));
  sprite.center.set(.5, .25);
  return sprite;
}

function disposeGroup(group: T.Group) {
  group.traverse(object => {
    if (object instanceof T.Line || object instanceof T.Points) object.geometry.dispose();
    if (object instanceof T.Mesh) { object.geometry.dispose(); object.material.dispose(); }
    if (object instanceof T.Line || object instanceof T.Points || object instanceof T.Sprite) {
      if (object instanceof T.Sprite) object.material.map?.dispose();
      object.material.dispose();
    }
  });
  group.clear();
}

export default function MarsGlobe(props: Props) {
  const host = useRef<HTMLDivElement>(null);
  const current = useRef(props);
  current.current = props;
  const [shape, setShape] = useState<keyof typeof shapeOptions>('oblate');
  const [relief, setRelief] = useState(1);
  const [hover, setHover] = useState<Point | null>(null);
  const [point, setPoint] = useState<Point | null>(null);
  const [zoom, setZoom] = useState({ altitude: 0, percent: 0 });
  const [error, setError] = useState('');
  const [textureStatus, setTextureStatus] = useState('Loading');
  const engine = useRef<{
    camera: T.PerspectiveCamera; globe: T.Group; material: T.MeshStandardMaterial;
    markers: T.Group; overlays: T.Group; inspection: T.Group; renderer: T.WebGLRenderer;
    fly: (point: Point, distance: number) => void; textures: Map<string, Promise<T.Texture>>;
  } | null>(null);

  useEffect(() => {
    const target = host.current!;
    const canvas = document.createElement('canvas');
    let renderer: T.WebGLRenderer;
    try {
      const context = canvas.getContext('webgl2', { antialias: true, alpha: true });
      if (!context) throw new Error('WebGL2 unavailable');
      renderer = new T.WebGLRenderer({ canvas, context, antialias: true, alpha: true });
    } catch {
      setError('WebGL2 is unavailable on this device. Use the mission map to explore Mars.');
      return;
    }
    renderer.setPixelRatio(Math.min(1.75, window.devicePixelRatio));
    target.append(canvas);
    const scene = new T.Scene();
    const camera = new T.PerspectiveCamera(42, 1, .005, 40);
    camera.position.copy(vector(current.current.focus.point, fullDistance));
    const controls = new OrbitControls(camera, canvas);
    controls.minDistance = 2.035; controls.maxDistance = 12;
    controls.enablePan = false; controls.enableDamping = true;
    const globe = new T.Group();
    globe.scale.y = Y_RATIO;
    scene.add(globe);
    const geometry = new T.SphereGeometry(radius, 256, 256);
    const material = new T.MeshStandardMaterial({ roughness: .94, metalness: .02, color: '#ffffff' });
    const planet = new T.Mesh(geometry, material);
    globe.add(planet);
    const atmosphere = new T.Mesh(new T.SphereGeometry(2.022, 96, 64),
      new T.MeshBasicMaterial({ color: '#df7b40', side: T.BackSide, blending: T.AdditiveBlending,
        transparent: true, opacity: .22, depthWrite: false }));
    globe.add(atmosphere);
    const markers = new T.Group(), overlays = new T.Group(), inspection = new T.Group();
    globe.add(markers, overlays, inspection);
    const sun = new T.DirectionalLight('#fff3e8', 2.05);
    sun.position.copy(camera.position).add(new T.Vector3(2, 4, -1));
    scene.add(sun, new T.AmbientLight('#e5ecff', .65));
    const textures = new Map<string, Promise<T.Texture>>();
    let fly: { from: T.Vector3; to: T.Vector3; start: number } | undefined;
    engine.current = { camera, globe, material, markers, overlays, inspection, renderer, textures,
      fly: (destination, distance) => { fly = { from: camera.position.clone(), to: vector(destination, distance), start: performance.now() }; },
    };

    const resize = new ResizeObserver(() => {
      if (!target.clientWidth || !target.clientHeight) return;
      camera.aspect = target.clientWidth / target.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(target.clientWidth, target.clientHeight);
    });
    resize.observe(target);
    const ray = new T.Raycaster();
    const mouse = new T.Vector2();
    let down = [0, 0];
    const getHit = (event: PointerEvent) => {
      const box = canvas.getBoundingClientRect();
      mouse.set((event.clientX - box.left) / box.width * 2 - 1, 1 - (event.clientY - box.top) / box.height * 2);
      ray.setFromCamera(mouse, camera);
      return ray.intersectObject(planet)[0];
    };
    const pointerDown = (event: PointerEvent) => { fly = undefined; down = [event.clientX, event.clientY]; };
    let lastHoverUpdate = 0;
    const pointerMove = (event: PointerEvent) => {
      const now = performance.now();
      if (now - lastHoverUpdate < 50) return;
      lastHoverUpdate = now;
      const hit = getHit(event);
      canvas.style.cursor = current.current.picking ? 'crosshair' : 'grab';
      setHover(hit ? vector3ToGeo(globe.worldToLocal(hit.point), 1) : null);
    };
    const pointerUp = (event: PointerEvent) => {
      if (Math.hypot(event.clientX - down[0], event.clientY - down[1]) > 5) return;
      const hit = getHit(event);
      if (!current.current.picking) {
        const marker = ray.intersectObjects(markers.children.filter(child => child.visible))
          .find(item => !hit || item.distance < hit.distance + .025);
        if (marker) {
          current.current.onFeature(marker.object.userData.feature);
          return;
        }
      }
      if (!hit) return;
      const location = vector3ToGeo(globe.worldToLocal(hit.point), 1);
      setPoint(location);
      if (current.current.picking) current.current.onPoint(location);
    };
    const leave = () => setHover(null);
    canvas.addEventListener('pointerdown', pointerDown);
    canvas.addEventListener('pointermove', pointerMove);
    canvas.addEventListener('pointerup', pointerUp);
    canvas.addEventListener('pointerleave', leave);
    const markerPosition = new T.Vector3();
    const facing = new T.Vector3();
    const direction = new T.Vector3();
    const rotation = new T.Quaternion();
    const partial = new T.Quaternion();
    let lastAltitude = -1;
    let lastTelemetryUpdate = 0;
    renderer.setAnimationLoop(time => {
      if (document.hidden) return;
      if (fly) {
        const t = Math.min(1, (performance.now() - fly.start) / 850);
        const eased = t * t * (3 - 2 * t);
        direction.copy(fly.from).normalize();
        rotation.setFromUnitVectors(direction, fly.to.clone().normalize());
        partial.identity().slerp(rotation, eased);
        camera.position.copy(direction.applyQuaternion(partial).multiplyScalar(T.MathUtils.lerp(fly.from.length(), fly.to.length(), eased)));
        if (t === 1) fly = undefined;
      }
      controls.update();
      direction.copy(camera.position).normalize();
      const surface = radius / Math.hypot(direction.x, direction.y / globe.scale.y, direction.z);
      const altitude = Math.round((camera.position.length() - surface) / radius * EQUATOR_KM);
      if (altitude !== lastAltitude && time - lastTelemetryUpdate >= 100) {
        lastTelemetryUpdate = time;
        lastAltitude = altitude;
        setZoom({ altitude, percent: Math.round(100 * (12 - camera.position.length()) / (12 - controls.minDistance)) });
      }
      for (const sprite of markers.children) {
        markerPosition.copy(sprite.position); markerPosition.y *= globe.scale.y;
        facing.set(markerPosition.x, markerPosition.y / globe.scale.y**2, markerPosition.z).normalize();
        const distance = markerPosition.distanceTo(camera.position);
        sprite.visible = facing.dot(direction.copy(camera.position).sub(markerPosition).normalize()) > .05;
        const size = T.MathUtils.clamp(distance * .14, .012, .69);
        sprite.scale.set(size, size * .35, 1);
      }
      for (const child of overlays.children) {
        if (child.userData.beacon) child.scale.setScalar((1 + .22 * Math.sin(time / 170)) * T.MathUtils.clamp(camera.position.length() - 2, .20, 1));
      }
      renderer.render(scene, camera);
    });
    return () => {
      engine.current = null;
      renderer.setAnimationLoop(null); resize.disconnect(); controls.dispose();
      disposeGroup(markers); disposeGroup(overlays); disposeGroup(inspection);
      geometry.dispose(); material.dispose(); atmosphere.geometry.dispose(); atmosphere.material.dispose();
      for (const texture of textures.values()) void texture.then(value => value.dispose()).catch(() => {});
      renderer.dispose(); canvas.remove();
    };
  }, []);

  const layer = props.layers.find(item => item.id === props.layerId);
  useEffect(() => {
    const state = engine.current;
    if (!state || !layer) return;
    let active = true;
    const load = (url: string, srgb: boolean) => {
      if (!state.textures.has(url)) {
        const request = new T.TextureLoader().loadAsync(url).then(texture => {
          texture.colorSpace = srgb ? T.SRGBColorSpace : T.NoColorSpace;
          texture.wrapS = T.RepeatWrapping; texture.wrapT = T.ClampToEdgeWrapping;
          texture.anisotropy = Math.min(16, state.renderer.capabilities.getMaxAnisotropy());
          return texture;
        });
        state.textures.set(url, request);
        request.catch(() => state.textures.delete(url));
      }
      return state.textures.get(url)!;
    };
    setTextureStatus('Loading');
    state.material.map = null;
    state.material.needsUpdate = true;
    const large = layer.id === 'viking' && state.renderer.capabilities.maxTextureSize >= 8192;
    load(layer.raster ?? (large ? '/rasters/viking-8192.jpg' : files[layer.id]), true)
      .catch(error => { if (large) return load(files.viking, true); throw error; })
      .then(texture => {
        if (!active) return;
        state.material.map = texture; state.material.needsUpdate = true;
        const width = (texture.image as HTMLImageElement).width;
        setTextureStatus(`${width >= 4096 ? Math.round(width / 1024) + "K" : width + " px"} archive`);
      }).catch(() => { if (active) setTextureStatus('Raster unavailable'); });
    load('/rasters/mars_normal_4k.png', false).then(texture => {
      if (!active) return;
      state.material.normalMap = texture; state.material.needsUpdate = true;
    }).catch(() => { if (active) setError('The MOLA relief normal map could not be loaded.'); });
    return () => { active = false; };
  }, [layer]);

  useEffect(() => { if (engine.current) engine.current.globe.scale.y = shapeOptions[shape]; }, [shape]);
  useEffect(() => { engine.current?.material.normalScale.setScalar(relief); }, [relief]);
  useEffect(() => { engine.current?.fly(props.focus.point, fullDistance); }, [props.focus]);
  useEffect(() => {
    const feature = props.dossier;
    if (feature?.coordinate) engine.current?.fly(feature.coordinate, focusDistance);
  }, [props.dossier]);
  useEffect(() => {
    const group = engine.current?.markers;
    if (!group) return;
    disposeGroup(group);
    for (const feature of props.features) {
      if (!feature.coordinate) continue;
      const color = feature.id === props.dossier?.id ? '#96e7f4' : feature.category === 'Landmark' ? '#f2d99b' : '#daf2ad';
      const label = feature.id === 'bradbury' ? 'Curiosity' : feature.id === 'jezero' ? 'Perseverance' : feature.name;
      const sprite = makeLabel(label, color);
      sprite.position.copy(vector(feature.coordinate, 2.001));
      sprite.userData.feature = feature;
      group.add(sprite);
    }
  }, [props.features, props.dossier]);
  useEffect(() => {
    const group = engine.current?.overlays;
    if (!group) return;
    disposeGroup(group);
    if (props.traverse) {
      const segments = props.traverse.paths.flatMap(path => path.slice(1).flatMap((point, i) =>
        [path[i], point].map(([lon, lat]) => vector({ lon, lat }, 2.00025))));
      group.add(new T.LineSegments(new T.BufferGeometry().setFromPoints(segments), new T.LineBasicMaterial({ color: '#f59e0b' })));
      group.add(new T.Points(new T.BufferGeometry().setFromPoints(props.traverse.waypoints.map(stop => vector(stop, 2.0004))),
        new T.PointsMaterial({ color: '#fff', size: 2, sizeAttenuation: false })));
    }
    for (const route of props.routes) {
      const selected = route.id === props.selected;
      const geometry = new T.BufferGeometry().setFromPoints(route.profile.map(sample => vector(sample.point, selected ? 2.0011 : 2.0007)));
      const color = strategies[route.strategy].color;
      const line = new T.Line(geometry, new T.LineBasicMaterial({ color, transparent: !selected, opacity: selected ? 1 : .62 }));
      line.renderOrder = selected ? 3 : 1;
      group.add(line);
    }
    if (props.bounds) {
      const [w,s,e,n] = props.bounds;
      const coordinates = [[w,s],[e,s],[e,n],[w,n],[w,s]];
      const path = coordinates.slice(1).flatMap(([lon,lat], i) => Array.from({length: 9}, (_, step) =>
        vector({lon:T.MathUtils.lerp(coordinates[i][0],lon,step/8),lat:T.MathUtils.lerp(coordinates[i][1],lat,step/8)},2.0004)));
      group.add(new T.Line(new T.BufferGeometry().setFromPoints(path), new T.LineBasicMaterial({ color: '#c5e985' })));
    }
    props.points.forEach((location, i) => {
      if (!location) return;
      const mesh = new T.Mesh(new T.SphereGeometry(.005, 12, 8),
        new T.MeshBasicMaterial({ color: i ? '#f5bd78' : '#75f1a0' }));
      mesh.position.copy(vector(location, 2.0016)); mesh.userData.beacon = true;
      group.add(mesh);
    });
  }, [props.routes, props.points, props.selected, props.traverse, props.bounds]);

  useEffect(() => {
    const group = engine.current?.inspection;
    if (!group) return;
    disposeGroup(group);
    if (!props.inspectedPoint) return;
    const point = new T.Mesh(new T.SphereGeometry(.0018, 16, 12),
      new T.MeshBasicMaterial({ color: '#fff' }));
    point.position.copy(vector(props.inspectedPoint, 2.0025));
    group.add(point);
  }, [props.inspectedPoint]);

  const focusGale = () => engine.current?.fly(gale, focusDistance);
  const focusRoute = () => {
    const [start, end] = props.points;
    if (!start) return;
    engine.current?.fly(end ? { lat: (start.lat + end.lat) / 2, lon: (start.lon + end.lon) / 2 } : start, 2.055);
  };
  const withinGrid = hover && hover.lon >= 136 && hover.lon < 138.75 && hover.lat > -5.75 && hover.lat <= -3.5;
  return <section className="map-shell globe-shell" aria-label="Interactive Mars globe">
    <div className="globe-canvas" ref={host} />
    <div className="globe-layer-bar" aria-label="Globe layers">{props.layers.map(item =>
      <button key={item.id} title={item.description} className="secondary" aria-pressed={props.layerId === item.id} onClick={() => props.onLayer(item.id)}>{item.name}</button>
    )}</div>
    {error && <p className="globe-error" role="alert">{error}</p>}
    <div className="globe-actions">
      <button className="secondary" onClick={focusGale}><Crosshair size={15}/>Focus Gale Crater</button>
      <button className="secondary" disabled={!props.points[0]} onClick={focusRoute}>Focus route</button>
      <button className="secondary" onClick={() => engine.current?.fly(gale, fullDistance)}>Global view</button>
      <button className="secondary" disabled={!point} onClick={() => point && props.onOpenMap(point)}><MapIcon size={15}/>Open in map</button>
    </div>
    <div className="globe-settings">
      <label>Relief {relief.toFixed(1)}× <input aria-label="Relief shading" type="range" min="0" max="3.5" step=".1" value={relief} onChange={event => setRelief(Number(event.target.value))}/></label>
      <label>Shape <select aria-label="Globe shape" value={shape} onChange={event => setShape(event.target.value as keyof typeof shapeOptions)}>
        <option value="oblate">Oblate spheroid</option><option value="exaggerated">Flattening ×6</option><option value="sphere">Perfect sphere</option>
      </select></label>
    </div>
    <div className="globe-telemetry">
      <span>{layer?.name ?? 'Globe'} · {textureStatus}{layer?.id === 'ctx' && ' · HRSC background'}</span>
      <span>{zoom.percent}% zoom · {zoom.altitude.toLocaleString()} km altitude · {shape === 'oblate' ? 'IAU/IAG 2000' : 'Illustrative shape'}</span>
      <span>{coord(hover ?? point)}{hover && (withinGrid ? ' · Gale DEM coverage' : ' · Outside EVA grid')}</span>
      <span>{props.picking ? 'Select a route point' : props.traverse ? `Curiosity archive · Sol ${props.traverse.firstSol}–${props.traverse.lastSol}` : 'Archival orbital data'}</span>
    </div>
  </section>;
}
