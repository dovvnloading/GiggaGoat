import test from 'node:test';
import assert from 'node:assert/strict';
import { summarize, classifyRenderer, createIntervalTracker } from './living-world-acceptance-metrics.mjs';

test('nearest-rank statistics keep every slow frame and empty evidence is not zero latency',()=>{
  const times=[40,10,20,30,33,33.01];
  assert.deepEqual(summarize(times),{count:6,p50Ms:30,p95Ms:40,p99Ms:40,worstMs:40,over33Ms:2});
  assert.deepEqual(times,[40,10,20,30,33,33.01]);
  assert.equal(summarize([]).p95Ms,null);
  assert.throws(()=>summarize([NaN]),RangeError);
  assert.throws(()=>summarize([-1]),RangeError);
});
test('software and unknown renderer identities never become hardware evidence',()=>{
  assert.equal(classifyRenderer(true,'NVIDIA RTX'),'production-software-fallback');
  for(const name of ['ANGLE (Google, SwiftShader Device)','llvmpipe','Microsoft Basic Render Driver','WARP','lavapipe'])
    assert.equal(classifyRenderer(false,name),'software-webgl');
  for(const name of [null,'','WebGL','WebKit WebGL','ANGLE'])
    assert.equal(classifyRenderer(false,name),'unverified-webgl');
  assert.equal(classifyRenderer(false,'NVIDIA RTX'),'hardware-candidate-unverified');
});
test('pause, quality and resize boundaries do not silently become active-frame intervals',()=>{
  const clock=createIntervalTracker();
  assert.equal(clock.sample(10,'high:1280x720'),null);
  assert.equal(clock.sample(26,'high:1280x720'),16);
  assert.equal(clock.sample(76,'high:1280x720'),50);
  assert.equal(clock.sample(90,'low:1280x720'),null);
  assert.equal(clock.sample(110,'low:640x360'),null);
  clock.reset();
  assert.equal(clock.sample(5000,'low:640x360'),null);
  assert.equal(clock.sample(5020,'low:640x360'),20);
});
