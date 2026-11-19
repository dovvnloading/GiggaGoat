import * as THREE from 'three';
import type { Toybox, ToyCue, ToyId } from './Toybox';
import type { Vec3 } from '../physics';

const PALETTE: Record<ToyId, number> = {gas:0x9edb42,glob:0x79f735,brew:0xf448a2,sock:0xbe82ff,pogo:0x88cb41,duck:0xffba27};

/** Reuse a fixed set of opaque meshes. Toy use never adds particles to the physics world. */
export class ToyEffects {
  readonly root = new THREE.Group();
  private readonly ball = new THREE.SphereGeometry(1, 12, 8);
  private readonly materials = new Map<number, THREE.MeshToonMaterial>();
  private readonly duck = new THREE.Group();
  private readonly glob: THREE.Mesh;
  private readonly motes: { mesh: THREE.Mesh; velocity: THREE.Vector3; age: number; radius: number }[] = [];
  private slot = 0;
  private trailAt = 0;
  private lastTime = -1;
  private readonly pulse = (cue: ToyCue) => {
    const count = cue.toy === 'gas' ? 16 : 7;
    for (let i=0; i<count; i++) {
      const a = i * 2.39996;
      const radius = (cue.toy === 'gas' ? .52 : .18) * cue.strength;
      this.spawn(cue.position, PALETTE[cue.toy], radius, Math.cos(a)*2.6, .6+i%4*.65, Math.sin(a)*2.6);
    }
  };
  constructor(private readonly toys: Toybox) {
    const bulb = (parent: THREE.Group, color: number, x:number,y:number,z:number, sx:number,sy:number,sz:number) => {
      const mesh = new THREE.Mesh(this.ball, this.material(color));
      mesh.position.set(x,y,z); mesh.scale.set(sx,sy,sz); parent.add(mesh); return mesh;
    };
    this.root.name='Free-roam toys';
    this.root.add(this.duck);
    bulb(this.duck,0xffbd19,0,.33,0,.49,.31,.62);
    bulb(this.duck,0xffce2c,0,.75,-.27,.35,.34,.34);
    bulb(this.duck,0xff7828,0,.69,-.59,.22,.084,.20);
    for (const side of [-1,1]) {
      bulb(this.duck,0x2c2138,side*.19,.82,-.51,.054,.065,.049);
      bulb(this.duck,0xff9e1b,side*.43,.39,.03,.12,.15,.31);
    }
    this.glob=bulb(this.root,PALETTE.glob,0,0,0,.24,.19,.31);
    for(let i=0;i<48;i++) {
      const mesh=bulb(this.root,PALETTE.gas,0,0,0,1,1,1);
      mesh.visible=false;
      this.motes.push({mesh,velocity:new THREE.Vector3(),age:1,radius:0});
    }
    this.duck.visible=this.glob.visible=false;
    toys.listeners.add(this.pulse);
  }
  private material(color:number): THREE.MeshToonMaterial {
    let mat=this.materials.get(color);
    if(!mat) {mat=new THREE.MeshToonMaterial({color});this.materials.set(color,mat);}
    return mat;
  }
  private spawn(p:Vec3,color:number,radius:number,x:number,y:number,z:number):void {
    const m=this.motes[this.slot++ % this.motes.length]!;
    m.age=0;m.radius=radius;m.velocity.set(x,y,z);
    m.mesh.position.set(p.x,p.y,p.z);m.mesh.scale.setScalar(radius*.55);
    m.mesh.material=this.material(color);m.mesh.visible=true;
  }
  update(now:number, p:Vec3):void {
    const dt=this.lastTime<0 ? 0 : Math.min(.1, Math.max(0,now-this.lastTime));
    this.lastTime=now;
    this.root.visible=this.toys.available;
    this.duck.visible=!!this.toys.duck;
    if(this.toys.duck) {
      const d=this.toys.duck.position;
      this.duck.position.set(d.x,d.y+.04,d.z);
      this.duck.rotation.y=now*.8;
    }
    const shot=this.toys.glob;
    this.glob.visible=!!shot;
    if(shot) {
      this.glob.position.set(shot.position.x,shot.position.y,shot.position.z);
      const s=shot.stuck ? .34+.065*Math.sin(now*30) : .23;
      this.glob.scale.set(s,s*.85,s);
    }
    if(now>=this.trailAt) {
      this.trailAt=now+.08;
      if(this.toys.brew>0) this.spawn(p,Math.floor(now*12)%2 ? 0xff76c6 : 0x50e8ec,.20,0,-1,0);
      if(this.toys.magnet>0) {
        const a=now*7;
        this.spawn({x:p.x+2*Math.cos(a),y:p.y+.4,z:p.z+2*Math.sin(a)},PALETTE.sock,.14,-Math.cos(a)*2,0,-Math.sin(a)*2);
      }
      if(shot && !shot.stuck) this.spawn(shot.position,PALETTE.glob,.13,0,-.5,0);
    }
    for(const m of this.motes) {
      if(!m.mesh.visible) continue;
      m.age+=dt;
      if(m.age>=.62) {m.mesh.visible=false;continue;}
      m.mesh.position.addScaledVector(m.velocity,dt);
      m.mesh.scale.setScalar(m.radius*(.6+Math.sin(m.age/.62*Math.PI)*.7)*(1-m.age/.62));
    }
  }
  dispose():void {
    this.toys.listeners.delete(this.pulse);
    this.root.removeFromParent();this.ball.dispose();
    for(const m of this.materials.values()) m.dispose();
  }
}
