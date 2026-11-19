import * as THREE from 'three';
import type { IslandWeather } from '../world/island-weather';
import type { Game } from './Game';
import type { Vec3 } from '../physics';

const COUNT = 440;
const SPAN = 36;
const UP = { x: 0, y: 1, z: 0 };
const wrap = THREE.MathUtils.euclideanModulo;

/** Camera-local volume, with drops anchored to world coordinates as the goat moves. */
export class IslandAtmosphere {
  readonly group = new THREE.Group();
  private readonly positions = new Float32Array(COUNT * 6);
  private readonly rain = new THREE.LineSegments(new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({ color: 0xc3dfec, transparent: true, depthWrite: false, opacity: 0 }));
  private readonly seeds = new Float32Array(COUNT * 3);
  private readonly lamps: THREE.Vector3[];
  private readonly lights = [new THREE.PointLight(0xffb45e, 0, 13, 2), new THREE.PointLight(0xffb45e, 0, 13, 2)];
  private nextCheck = -1;
  private cameraUnderCover = false;
  private goatUnderCover = false;
  get playerUnderCover(): boolean { return this.goatUnderCover; }

  constructor(private readonly game: Game) {
    let seed = 19273;
    for (let i = 0; i < this.seeds.length; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      this.seeds[i] = seed / 4294967296;
    }
    this.rain.name = 'island-rain';
    this.rain.frustumCulled = false;
    this.rain.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    this.lamps = game.island.props.filter(p => p.kind === 'lamp').map(p => {
      const { x,y,z } = p.transform.position;
      return new THREE.Vector3(x, y + .34*p.size.y, z);
    });
    this.group.add(this.rain, ...this.lights);
  }

  private hasRoofAbove(position: Vec3): boolean {
    // Rapier treats unparented island geometry as fixed. PhysicsWorld excludes sensors.
    return !!this.game.physics.raycast(position, UP, 32, {
      predicate: collider => collider.parent()?.isFixed() ?? true,
    });
  }

  update(weather: IslandWeather, camera: THREE.Vector3, player: Vec3, low: boolean): void {
    const { time, rain, phase } = weather;
    const dusk = THREE.MathUtils.smoothstep(-Math.cos(phase * Math.PI * 2), -.40, .22);
    const lightPower = 115 * (1 - dusk);
    if (time >= this.nextCheck || time < this.nextCheck - .5) {
      this.nextCheck = time + .32;
      this.cameraUnderCover = rain > .01 && this.hasRoofAbove(camera);
      this.goatUnderCover = (rain > .01 || weather.wet > .15) && this.hasRoofAbove(player);
      if (lightPower > .01) {
        let first: THREE.Vector3 | undefined, second: THREE.Vector3 | undefined;
        let a = Infinity, b = Infinity;
        for (const lamp of this.lamps) {
          const d = lamp.distanceToSquared(camera);
          if (d < a) { second = first; b = a; first = lamp; a = d; }
          else if (d < b) { second = lamp; b = d; }
        }
        if (first) this.lights[0]!.position.copy(first);
        if (second) this.lights[1]!.position.copy(second);
      }
    }
    for (const light of this.lights) light.intensity = lightPower;
    this.rain.visible = rain > .012 && !this.cameraUnderCover;
    if (!this.rain.visible) return;
    const count = Math.ceil(COUNT * rain * (low ? .46 : 1));
    this.rain.material.opacity = .19 + rain * .22;
    for (let i = 0; i < count; i++) {
      const s = i * 3, p = i * 6;
      const speed = 12 + 4 * this.seeds[s]!;
      const x = camera.x + wrap(this.seeds[s]! * SPAN + time * 2.4 - camera.x, SPAN) - SPAN / 2;
      const y = camera.y + wrap(this.seeds[s+1]! * 21 - time * speed - camera.y, 21) - 7;
      const z = camera.z + wrap(this.seeds[s+2]! * SPAN - time * .95 - camera.z, SPAN) - SPAN / 2;
      this.positions[p] = x; this.positions[p+1] = y; this.positions[p+2] = z;
      this.positions[p+3] = x + .052; this.positions[p+4] = y - speed * .022; this.positions[p+5] = z - .021;
    }
    this.rain.geometry.setDrawRange(0, count * 2);
    this.rain.geometry.attributes.position!.needsUpdate = true;
  }

  dispose(): void {
    this.rain.geometry.dispose();
    this.rain.material.dispose();
    this.group.removeFromParent();
  }
}
