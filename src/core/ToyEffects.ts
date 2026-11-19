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
  private readonly can = new THREE.Group();
  private readonly pickle = new THREE.Group();
  private readonly cylinder = new THREE.CylinderGeometry(1,1,1,16);
  private readonly coil = new THREE.TorusGeometry(.19,.035,6,16);
  private pickleAge = 10;
  private sipAge = 10;
  private readonly motes: { mesh: THREE.Mesh; velocity: THREE.Vector3; age: number; radius: number }[] = [];
  private slot = 0;
  private trailAt = 0;
  private lastTime = -1;
  private readonly pulse = (cue: ToyCue) => {
    if (cue.toy === 'pogo') this.pickleAge = 0;
    if (cue.toy === 'brew') this.sipAge = 0;
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
    const tin = (color:number, y:number, radius:number, height:number) => {
      const mesh=new THREE.Mesh(this.cylinder,this.material(color));
      mesh.position.y=y; mesh.scale.set(radius,height,radius);
      this.can.add(mesh);
    };
    tin(0xdf2887,0,.20,.55);
    tin(0xe4ece7,.29,.21,.033); tin(0xf2d6ca,-.29,.21,.036);
    tin(0xfce08e,-.07,.204,.12);
    bulb(this.can,0x64344f,0,.31,-.055,.078,.012,.046);
    bulb(this.pickle,0x6eaf29,0,.12,0,.26,.19,.50);
    for (let i=0;i<5;i++) {
      const ring=new THREE.Mesh(this.coil,this.material(0xd9d7e2));
      ring.position.y=-.04-i*.075; ring.rotation.x=Math.PI/2+.12;
      this.pickle.add(ring);
    }
    bulb(this.pickle,0xe59828,0,-.39,0,.22,.042,.22);
    for (const side of [-1,1]) bulb(this.pickle,0x97cd4a,side*.19,.22,.13,.073,.057,.074);
    this.can.visible=this.pickle.visible=false;
    this.root.add(this.can,this.pickle);
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
  update(now:number, p:Vec3, size:number, heading:number, grounded:boolean):void {
    const dt=this.lastTime<0 ? 0 : Math.min(.1, Math.max(0,now-this.lastTime));
    this.lastTime=now;
    this.sipAge+=dt; this.pickleAge+=dt;
    const sn=Math.sin(heading), cs=Math.cos(heading);
    this.can.visible=this.sipAge<.72 && this.toys.brew>0;
    if(this.can.visible) {
      this.can.position.set(p.x+(.8*sn+.34*cs)*size,p.y+.55*size,p.z+(-.8*cs+.34*sn)*size);
      this.can.scale.setScalar(size); this.can.rotation.set(.28,-heading,-.9*Math.sin(this.sipAge/.72*Math.PI));
    }
    this.pickle.visible=this.pickleAge<2.4 && (!grounded || this.pickleAge<.10);
    if(this.pickle.visible) {
      this.pickle.position.set(p.x,p.y-.65*size,p.z); this.pickle.rotation.y=-heading;
      this.pickle.scale.set(size*1.25, size*(.75+.24*Math.min(1,this.pickleAge/.14)),size*1.25);
    }
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
      if(this.toys.brew>0) {
        const side = Math.floor(now*12)%2 ? 1 : -1;
        const at = {x:p.x+(.34*side*cs-.52*sn)*size, y:p.y-.16*size, z:p.z+(.34*side*sn+.52*cs)*size};
        this.spawn(at,side>0 ? 0xff86d0 : 0x83f1ef,.075*size,cs*side*.8,.4,sn*side*.8);
      }
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
    this.root.removeFromParent();this.ball.dispose(); this.cylinder.dispose(); this.coil.dispose();
    for(const m of this.materials.values()) m.dispose();
  }
}
