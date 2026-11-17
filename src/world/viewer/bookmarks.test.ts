import * as THREE from 'three';
import { describe, it } from 'vitest';
import { generateIsland, heightAt } from '../index';
import type { PropDescriptor, Vec3 } from '../types';

function roundHalf(x: number): number { return Math.round(x * 2) / 2; }
function renderPoint(camera: Vec3, target: Vec3, fov: number, point: Vec3) {
  const view = new THREE.PerspectiveCamera(fov, 16 / 9, 0.25, 4000);
  view.position.set(camera.x, camera.y, camera.z);
  view.lookAt(target.x, target.y, target.z);
  view.updateMatrixWorld();
  const projected = new THREE.Vector3(point.x, point.y, point.z).project(view);
  return { x: +projected.x.toFixed(4), y: +projected.y.toFixed(4), z: +projected.z.toFixed(4) };
}
function inside(x: number, z: number, p: PropDescriptor) {
  const dx = x - p.transform.position.x, dz = z - p.transform.position.z;
  const c = Math.cos(p.transform.rotationY), s = Math.sin(p.transform.rotationY);
  return Math.abs(c * dx - s * dz) <= p.size.x / 2 &&
    Math.abs(s * dx + c * dz) <= p.size.z / 2;
}
function vec(x: number, y: number, z: number) { return { x, y, z }; }
function toHalf(p: Vec3) { return vec(roundHalf(p.x), roundHalf(p.y), roundHalf(p.z)); }
describe('temporary default-island bookmark measurement', () => {
  it('prints generated coordinates and projected key points (removed before merge)', () => {
    const island = generateIsland({ seed: 'billy-isle', size: 600, resolution: 193 });
    const get = (poi: string, kind: string) => island.props.filter(p => p.poiId === poi && p.kind === kind);
    const P = get('baa-ardwalk', 'pier')[0]!;
    const landEnd = P.transform.position.z - P.size.z / 2;
    const wheel = get('baa-ardwalk', 'ferris-wheel')[0]!;
    const kiosk = get('baa-ardwalk', 'booth')[0]!;
    const boardCam = vec(P.transform.position.x - 7,
      heightAt(island, P.transform.position.x - 7, landEnd - 14) + 4.5,
      landEnd - 14);
    const boardTarget = vec(wheel.transform.position.x,
      wheel.transform.position.y + 2, wheel.transform.position.z);
    const columns = get('crane-yard', 'concrete-column').sort((a,b)=>
      b.transform.position.y + b.size.y / 2 - a.transform.position.y - a.size.y / 2);
    const col = columns[0]!;
    const crane = get('crane-yard','crane').sort((a,b)=>b.size.y - a.size.y)[0]!;
    const fence = get('crane-yard','chain-fence')
      .filter(p => p.transform.position.z > island.pois.find(q=>q.id==='crane-yard')!.center.z)
      .sort((a,b)=>Math.abs(a.transform.position.x-island.pois.find(q=>q.id==='crane-yard')!.center.x)-
        Math.abs(b.transform.position.x-island.pois.find(q=>q.id==='crane-yard')!.center.x))[0]!;
    const site = island.pois.find(p=>p.id==='crane-yard')!.center;
    const craneCam = vec(site.x + 12, site.y + 4.5, site.z + 46);
    const craneTarget = vec(site.x - 4, site.y + 12, site.z - 10);
    const keyTarget = vec(0, 40, 0);
    const obstacles = island.props.filter(p =>
      ['house','barn','shop','cottage','control-house','windmill','silo','tree-oak','tree-pine'].includes(p.kind));
    const keyCandidates: Array<{camera: Vec3, blocking: string[]}> = [];
    for(let step=0;step<30;step++){
      const x = -190 + step*2*190/Math.hypot(190,110);
      const z = 110 - step*2*110/Math.hypot(190,110);
      const blocking = obstacles.filter(p=>inside(x,z,p)).map(p=>p.id);
      keyCandidates.push({camera: vec(x,heightAt(island,x,z)+3,z),blocking});
    }
    const key = keyCandidates.find(s=>s.blocking.length===0) || keyCandidates[0]!;
    const windmill = get('hoofington','windmill')[0]!;
    const summit = island.pois.find(p=>p.id==='mt-gigga')!.center;
    const keyPoints = { windmill: windmill.transform.position, summit:vec(summit.x,heightAt(island,0,0),summit.z) };
    const boardPoints = {
      firstKiosk:kiosk.transform.position, wheel: wheel.transform.position,
      pierLandEnd:vec(P.transform.position.x,P.transform.position.y+P.size.y/2,landEnd),
    };
    const cranePoints = {
      columnTop:vec(col.transform.position.x,col.transform.position.y+col.size.y/2,col.transform.position.z),
      craneTop:vec(crane.transform.position.x,crane.transform.position.y+crane.size.y/2,crane.transform.position.z),
      frontFence:fence.transform.position,
    };
    const report = {
      terrain:{keyOriginGround:heightAt(island,-190,110),boardGround:heightAt(island,boardCam.x,boardCam.z),cranePadY:site.y},
      firstPier:{position:P.transform.position,size:P.size,landEnd},
      firstKiosk:kiosk.transform.position, wheel:wheel.transform.position,
      craneSite:site,
      candidates:keyCandidates.slice(0,12),firstClear:key,
      camera:{
        '07':{camera:toHalf(key.camera),target:keyTarget,fov:55},
        '09':{camera:toHalf(boardCam),target:toHalf(boardTarget),fov:58},
        '10':{camera:toHalf(craneCam),target:toHalf(craneTarget),fov:60}
      },
      projections:Object.fromEntries([
        ['07',{camera:key.camera,target:keyTarget,fov:55,points:keyPoints}],
        ['09',{camera:boardCam,target:boardTarget,fov:58,points:boardPoints}],
        ['10',{camera:craneCam,target:craneTarget,fov:60,points:cranePoints}]
      ].map(([id,setting])=>{
        const s=setting as {camera:Vec3,target:Vec3,fov:number,points:Record<string,Vec3>};
        const exact=Object.fromEntries(Object.entries(s.points).map(([name,p])=>
          [name,renderPoint(s.camera,s.target,s.fov,p)]));
        const rounded=Object.fromEntries(Object.entries(s.points).map(([name,p])=>
          [name,renderPoint(toHalf(s.camera),toHalf(s.target),s.fov,p)]));
        return [id,{exact,rounded,pointCoordinates:s.points}];
      }))
    };
    console.log('BOOKMARK_PROBE ' + JSON.stringify(report));
    throw new Error('BOOKMARK_PROBE_DIAGNOSTIC: use logged coordinates, replace this test before merge');
  });
});
