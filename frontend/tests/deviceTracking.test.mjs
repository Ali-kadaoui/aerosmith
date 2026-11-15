import { test } from 'node:test';
import assert from 'node:assert/strict';
import { watchEarthLocation, locationErrorMessage } from '../src/deviceTracking.ts';
test('continuous updates and watcher cleanup suppress late callbacks',()=>{
  let success, failure, cleared;const received=[];
  const stop=watchEarthLocation({watchPosition(ok,fail,options){success=ok;failure=fail;assert.equal(options.timeout,15000);return 7;},clearWatch(id){cleared=id;}}, value=>received.push(value), error=>received.push(error.code));
  success({coords:{latitude:1}});success({coords:{latitude:2}});failure({code:2});assert.equal(received.length,3);
  stop();assert.equal(cleared,7);success({coords:{latitude:3}});failure({code:3});assert.equal(received.length,3);
});
test('permission denial, unavailable and timeout have distinct feedback',()=>{
  assert.match(locationErrorMessage(1),/permission denied/);assert.match(locationErrorMessage(2),/unavailable/);assert.match(locationErrorMessage(3),/timed out/);
});
