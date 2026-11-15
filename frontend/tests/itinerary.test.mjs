import { test } from 'node:test';
import assert from 'node:assert/strict';
import { distanceKm, MARS_RADIUS_KM, moveWaypoint, parseLibrary, itineraryLine, validCoordinate } from '../src/itinerary.ts';
const a = { id:'a', name:'Start', lat:0, lon:0, description:'' };
const b = { ...a, id:'b', lon:90 };
test('Mars distances match quarter circumference, zero and antipodes', () => {
  assert.equal(distanceKm(a,a),0);
  assert.ok(Math.abs(distanceKm(a,b)-Math.PI*MARS_RADIUS_KM/2)<1e-8);
  assert.ok(Math.abs(distanceKm(a,{...b,lon:180})-Math.PI*MARS_RADIUS_KM)<1e-6);
});
test('dateline uses short distance and continuous display path', () => {
  const points=[{...a,lon:179},{...b,lon:-179}];
  assert.ok(distanceKm(...points)<120);
  const line=itineraryLine(points);
  assert.ok(Math.abs(line.at(-1)[0]-line[0][0]-2)<1e-8);
  assert.ok(line.every(point=>point.every(Number.isFinite)));
});
test('reordering preserves data and does not mutate original',()=>{
  const points=[a,b];assert.deepEqual(moveWaypoint(points,1,-1),[b,a]);assert.deepEqual(points,[a,b]);assert.deepEqual(moveWaypoint(points,0,-1),points);
});
test('library round trip, removal and reversal',()=>{
  const mission={version:1,id:'mission',name:'Test',pace:2,waypoints:[a,b]};
  assert.deepEqual(parseLibrary(JSON.stringify([mission])),[mission]);
  assert.deepEqual(parseLibrary(null),[]);
  assert.equal([...mission.waypoints].reverse()[0].id,'b');
  assert.equal(mission.waypoints.filter(point=>point.id!=='b').length,1);
  assert.throws(()=>parseLibrary(JSON.stringify([{...mission,waypoints:[{...a,lat:91}]}])));
  assert.throws(()=>parseLibrary('{broken'));
  assert.throws(()=>parseLibrary(JSON.stringify([{...mission,pace:-1}])));
});
test('coordinates reject invalid values and accept signed or east longitudes',()=>{
  assert.equal(validCoordinate(NaN,0),false);assert.equal(validCoordinate(0,361),false);assert.equal(validCoordinate(-90,-180),true);assert.equal(validCoordinate(90,360),true);
});
