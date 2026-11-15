import { useEffect, useRef, useState } from 'react';
import * as T from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { coord, read, type Point, type Route } from './model';

type Grid = { bounds: number[]; width: number; height: number; nodata: number; heights: number[]; raster?: string; source: { url: string } };

export default function LocalTerrain({ route, detail = false, routeOutside = false }: { route?: Route; detail?: boolean; routeOutside?: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const overlay = useRef<T.Group | null>(null);
  const project = useRef<((point: Point, elevation: number) => T.Vector3) | null>(null);
  const [grid, setGrid] = useState<Grid>();
  const [textureReady, setTextureReady] = useState(false);
  const [error, setError] = useState('');
  const [sampleIndex, setSampleIndex] = useState(0);
  const [range, setRange] = useState<[number, number]>();
  useEffect(() => {
    let active = true;
    read<Grid>(detail ? '/terrain/hirise' : '/terrain/gale').then(result => { if (active) setGrid(result); })
      .catch(cause => { if (active) setError(String(cause)); });
    return () => { active = false; };
  }, [detail]);
  useEffect(() => { setSampleIndex(0); }, [route]);
  const sample = route?.profile[sampleIndex];
  useEffect(() => {
    if (!grid || !host.current) return;
    const target = host.current;
    let renderer: T.WebGLRenderer;
    try { renderer = new T.WebGLRenderer({ antialias: true }); }
    catch { setError('WebGL is unavailable. Open the mission map to inspect your route.'); return; }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    target.appendChild(renderer.domElement);
    const scene = new T.Scene();
    scene.background = new T.Color('#0B0B10');
    const camera = new T.PerspectiveCamera(45, 1, .1, 2000);
    const controls = new OrbitControls(camera, renderer.domElement);
    const [west, south, east, north] = grid.bounds;
    const middleLat = (south + north) / 2;
    const middleLon = (west + east) / 2;
    const kmPerDegree = 3396 * Math.PI / 180;
    const xScale = kmPerDegree * Math.cos(middleLat * Math.PI / 180);
    const toVector = (point: Point, elevation: number) => new T.Vector3(
      (point.lon - middleLon) * xScale, elevation / 1000, (middleLat - point.lat) * kmPerDegree);
    project.current = toVector;
    const positions = [], colors = [], indices = [], uv = [];
    let minimum = Infinity, maximum = -Infinity;
    for (const value of grid.heights) if (value !== grid.nodata) { minimum = Math.min(minimum, value); maximum = Math.max(maximum, value); }
    setRange([minimum, maximum]);
    const span = (east - west) * xScale;
    const middleElevation = (minimum + maximum) / 2000;
    controls.target.set(0, middleElevation, 0);
    camera.position.set(span * .9, middleElevation + span, span * .9);
    camera.near = span / 1000;
    camera.updateProjectionMatrix();
    controls.update();
    const low = new T.Color('#343774'), high = new T.Color('#ffd19a');
    const color = new T.Color();
    for (let row = 0; row < grid.height; row++) {
      for (let col = 0; col < grid.width; col++) {
        const index = row * grid.width + col;
        const height = grid.heights[index];
        const point = { lat: north - (row + .5) * (north - south) / grid.height, lon: west + (col + .5) * (east - west) / grid.width };
        positions.push(...toVector(point, height === grid.nodata ? 0 : height).toArray());
        color.copy(low).lerp(high, (height - minimum) / (maximum - minimum || 1));
        colors.push(color.r, color.g, color.b);
        uv.push((col + .5) / grid.width, 1 - (row + .5) / grid.height);
        if (row && col) {
          const upper = index - grid.width;
          for (const triangle of [[upper - 1, index - 1, upper], [upper, index - 1, index]]) {
            if (triangle.every(i => grid.heights[i] !== grid.nodata)) indices.push(...triangle);
          }
        }
      }
    }
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
    geometry.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const material = new T.MeshStandardMaterial({ vertexColors: true });
    scene.add(new T.Mesh(geometry, material), new T.HemisphereLight('#ffffff', '#63536b', 2));
    const sun = new T.DirectionalLight('#fff3dc', 2);
    sun.position.set(-100, 75, -40);
    scene.add(sun);
    const group = new T.Group();
    overlay.current = group;
    scene.add(group);
    const draw = () => renderer.render(scene, camera);
    let alive = true;
    const texture = grid.raster ? new T.TextureLoader().load(grid.raster, loaded => {
      if (!alive) return;
      loaded.colorSpace = T.SRGBColorSpace;
      setTextureReady(true);
      material.map = loaded;
      material.vertexColors = false;
      material.needsUpdate = true;
      draw();
    }, undefined, () => { if (alive) setError('Orthoimage unavailable. Showing elevation colors.'); }) : undefined;
    controls.addEventListener('change', draw);
    const resize = new ResizeObserver(() => {
      if (!target.clientWidth || !target.clientHeight) return;
      camera.aspect = target.clientWidth / target.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(target.clientWidth, target.clientHeight);
      draw();
    });
    resize.observe(target);
    group.addEventListener('childadded', draw);
    group.addEventListener('childremoved', draw);
    return () => {
      alive = false; texture?.dispose();
      resize.disconnect(); controls.dispose(); renderer.dispose(); geometry.dispose(); material.dispose();
      renderer.domElement.remove(); overlay.current = null; project.current = null;
    };
  }, [grid]);
  useEffect(() => {
    const group = overlay.current, toVector = project.current;
    if (!group || !toVector || !route || !grid) return;
    const vectors = route.profile.map(item => toVector(item.point, item.elevation_m + (detail ? .25 : 35)));
    const path = [];
    const [west, south, east, north] = grid.bounds;
    const cell = (point: Point) => [Math.round((point.lon - west) * grid.width / (east - west) - .5), Math.round((north - point.lat) * grid.height / (north - south) - .5)];
    for (let i = 0; i < vectors.length; i++) {
      if (i) {
        const a = route.profile[i - 1].point, b = route.profile[i].point;
        const [ax, ay] = cell(a), [bx, by] = cell(b);
        if ((ax - bx) * (ay - by) > 0) {
          const height = (grid.heights[ay * grid.width + bx] + grid.heights[by * grid.width + ax]) / 2;
          path.push(toVector({ lat: (a.lat + b.lat) / 2, lon: (a.lon + b.lon) / 2 }, height + (detail ? .25 : 35)));
        }
      }
      path.push(vectors[i]);
    }
    const line = new T.Line(new T.BufferGeometry().setFromPoints(path), new T.LineBasicMaterial({ color: '#E52E50' }));
    const dots = [vectors[0], vectors.at(-1), vectors[sampleIndex]].filter((point): point is T.Vector3 => !!point);
    const markers = new T.Points(new T.BufferGeometry().setFromPoints(dots), new T.PointsMaterial({ color: '#ffad82', size: 7, sizeAttenuation: false }));
    group.add(line, markers);
    return () => { group.remove(line, markers); line.geometry.dispose(); line.material.dispose(); markers.geometry.dispose(); markers.material.dispose(); };
  }, [grid, route, sampleIndex, detail]);
  return <section className="map-shell local-terrain" aria-label="Local Gale elevation model">
    <div className="map-canvas" ref={host}/>
    <div className="local-terrain-info">
      <strong>{detail ? 'Gale sulfate beds · HiRISE · 1.012 m posting' : 'Gale terrain · MOLA · approximately 463 m cells'}</strong>
      {error ? <p role="alert">{error}</p> : !range ? <p role="status">Loading elevation grid…</p> :
        <p><a href={grid?.source.url}>NASA PDS</a> · {textureReady ? 'Registered orthoimage · ' : 'Elevation colors · '}{range[0].toFixed(1)} to {range[1].toFixed(1)} m above areoid · True vertical scale</p>}
      {routeOutside && <p>Switch terrain views to display the selected route on its elevation dataset.</p>}
      {sample && route && <label>Simulated position · route sample {sampleIndex + 1} of {route.profile.length}
        <input type="range" min={0} max={route.profile.length - 1} value={sampleIndex} onChange={event => setSampleIndex(Number(event.target.value))}/>
        <output>{coord(sample.point)} · {sample.elevation_m} m · {((route.distance_m - sample.distance_m) / 1000).toFixed(2)} km remaining{route.profile[sampleIndex + 1] && ` · ${((route.profile[sampleIndex + 1].distance_m - sample.distance_m) / 1000).toFixed(2)} km to next sample`}</output>
      </label>}
    </div>
  </section>;
}
