import { buildNoniShop } from '../world/nonis-shop';
import { noniStorefront } from '../world/visual-downtown';
import * as THREE from 'three';
import { gridSample } from '../world/terrain';
import type { IslandData, Vec3 } from '../world/types';
import { IslandHappenings, type HappeningSite } from './IslandHappenings';

type Shape = 'box' | 'cylinder' | 'cone' | 'ball' | 'ring' | 'bun' | 'icing';
const WOOD = 0x8e5735, DARK = 0x344756, CREAM = 0xffeac0, METAL = 0x7896a1;
const GOLD = 0xe4ad45, RED = 0xd9554b, GREEN = 0x6d9b51;

/** Compact, themed roadside vignettes. No lights, shadow casters, physics bodies,
 * async assets or DOM textures; the software renderer can draw them too. */
export class HappeningVisuals {
  readonly root = new THREE.Group();
  private readonly shapes: Record<Shape, THREE.BufferGeometry> = {
    box: new THREE.BoxGeometry(1, 1, 1),
    cylinder: new THREE.CylinderGeometry(.5, .5, 1, 10),
    cone: new THREE.ConeGeometry(.5, 1, 10),
    ball: new THREE.SphereGeometry(.5, 8, 6),
    bun: new THREE.SphereGeometry(.5, 18, 10),
    icing: new THREE.TubeGeometry(new THREE.CatmullRomCurve3(Array.from({ length: 42 }, (_, i) => {
      const u = i / 41, angle = u * Math.PI * 4.4, radius = .025 + u * .216;
      return new THREE.Vector3(radius * Math.cos(angle), .17 * Math.sqrt(1 - (radius / .29) ** 2),
        radius * Math.sin(angle));
    })), 44, .02, 6, false),
    ring: new THREE.TorusGeometry(.5, .055, 5, 20),
  };
  private readonly materials = new Map<string, THREE.Material>();
  private readonly scenes: Array<{
    site: HappeningSite; group: THREE.Group; spin: (time: number, energy: number) => void;
    spark: THREE.Mesh; bursts: THREE.Mesh[];
  }> = [];

  constructor(private readonly island: IslandData, private readonly happenings: IslandHappenings) {
    this.root.name = 'island-happenings';
    for (const site of happenings.sites) this.build(site);
  }

  private mesh(parent: THREE.Group, shape: Shape, color: number, x: number, y: number, z: number,
    sx: number, sy: number, sz: number, unlit = false): THREE.Mesh {
    const key = color + ':' + unlit;
    let material = this.materials.get(key);
    if (!material) {
      material = unlit ? new THREE.MeshBasicMaterial({ color }) : new THREE.MeshLambertMaterial({ color });
      this.materials.set(key, material);
    }
    const mesh = new THREE.Mesh(this.shapes[shape], material);
    mesh.position.set(x, y, z);
    mesh.scale.set(sx, sy, sz);
    parent.add(mesh);
    return mesh;
  }

  /** Ground each small cluster independently on the already-generated terrain. */
  private anchor(parent: THREE.Group, site: HappeningSite, x = 0, z = 0): THREE.Group {
    const c = Math.cos(site.yaw), s = Math.sin(site.yaw), k = site.scale;
    const y = gridSample(this.island, site.position.x + (c * x + s * z) * k,
      site.position.z + (-s * x + c * z) * k);
    const group = new THREE.Group();
    group.position.set(x, (y - site.position.y) / k, z);
    parent.add(group);
    return group;
  }

  private crate(parent: THREE.Group, color = WOOD): void {
    this.mesh(parent, 'box', color, 0, .25, 0, .62, .5, .52);
    for (const x of [-.23, .23]) this.mesh(parent, 'box', DARK, x, .26, .27, .075, .47, .045);
    this.mesh(parent, 'box', CREAM, 0, .33, .27, .24, .14, .04);
  }

  private pole(parent: THREE.Group, color = WOOD, height = 1.35): void {
    this.mesh(parent, 'cylinder', DARK, 0, .06, 0, .36, .12, .36);
    this.mesh(parent, 'cylinder', color, 0, height / 2, 0, .13, height, .13);
  }

  private pivot(parent: THREE.Group, x: number, y: number, z: number): THREE.Group {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, z);
    parent.add(pivot);
    return pivot;
  }

  private lantern(parent: THREE.Group, color: number, height = .6): void {
    this.mesh(parent, 'cylinder', DARK, 0, .07, 0, .34, .14, .34);
    this.mesh(parent, 'cylinder', color, 0, height / 2, 0, .25, height - .15, .25, true);
    this.mesh(parent, 'cone', DARK, 0, height, 0, .43, .22, .43);
    const loop = this.mesh(parent, 'ring', METAL, 0, height + .15, 0, .25, .25, .25);
    loop.rotation.y = Math.PI / 2;
    for (const x of [-.14, .14]) this.mesh(parent, 'box', DARK, x, height / 2, 0, .04, height - .12, .04);
  }

  private pinwheel(parent: THREE.Group, color: number, height: number): THREE.Group {
    this.pole(parent, WOOD, height);
    const rotor = this.pivot(parent, 0, height, .12);
    for (let i = 0; i < 4; i++) {
      const blade = this.pivot(rotor, 0, 0, 0);
      blade.rotation.z = i * Math.PI / 2;
      const vane = this.mesh(blade, 'box', i % 2 ? CREAM : color, .22, .12, 0, .42, .24, .045);
      vane.rotation.z = .28;
    }
    this.mesh(rotor, 'ball', GOLD, 0, 0, .04, .15, .15, .14);
    return rotor;
  }

  private build(site: HappeningSite): void {
    const group = new THREE.Group();
    group.name = 'happening-' + site.definition.id;
    group.position.set(site.position.x, site.position.y, site.position.z);
    group.rotation.y = site.yaw;
    group.scale.setScalar(site.scale);
    if (site.definition.id === 'needle-drop') {
      const lot = noniStorefront(this.island);
      if (!lot) return;
      this.recordShop = buildNoniShop(lot.size.x / site.scale);
      this.recordShop.group.position.copy(group.position);
      this.recordShop.group.rotation.y = site.yaw;
      this.recordShop.group.scale.setScalar(site.scale);
      this.recordShop.group.name = 'nonis-metal-records';
      this.root.add(this.recordShop.group);
      return;
    }
    if (site.definition.id === 'honey-rolls') {
      this.bakeryRolls = Array.from({ length: 3 }, () => {
        const bun = new THREE.Group();
        bun.name = 'honey-roll';
        bun.scale.setScalar(site.scale);
        this.mesh(bun, 'bun', 0xd78a43, 0,0,0, .61,.34,.57);
        this.mesh(bun, 'icing', 0xffe0a8, 0,.012,0, 1,1,1);
        bun.visible = false;
        this.root.add(bun);
        return bun;
      });
      return;
    }
    const main = this.anchor(group, site), color = site.definition.color;
    const side = (x: number, z: number) => this.anchor(group, site, x, z);
    let spin: (time: number, energy: number) => void = () => {};
    switch (site.definition.id) {
      case 'breakfast-bell': {
        for (const x of [-.49, .49]) this.mesh(main, 'box', WOOD, x, .9, 0, .14, 1.8, .16);
        this.mesh(main, 'box', WOOD, 0, 1.75, 0, 1.18, .15, .19);
        const bell = this.pivot(main, 0, 1.61, 0);
        this.mesh(bell, 'cone', GOLD, 0, -.35, 0, .53, .65, .53);
        this.mesh(bell, 'cylinder', GOLD, 0, -.62, 0, .65, .13, .65);
        this.mesh(bell, 'ball', DARK, 0, -.72, 0, .17, .17, .17);
        this.crate(side(-1.0, -.2));
        const pail = side(.96, .35);
        this.mesh(pail, 'cylinder', METAL, 0, .23, 0, .46, .46, .46);
        this.mesh(pail, 'cylinder', DARK, 0, .46, 0, .39, .025, .39);
        this.mesh(pail, 'ring', DARK, 0, .5, 0, .48, .48, .48);
        spin = (t, e) => { bell.rotation.z = Math.sin(t * (e ? 9 : 1.3)) * (.065 + .53 * e); };
        break;
      }
      case 'wind-up-parade': {
        const wheels = [this.pinwheel(main, color, 1.7),
          this.pinwheel(side(-.88, .15), 0x65c6e9, 1.1),
          this.pinwheel(side(.9, -.23), GOLD, 1.25)];
        this.crate(side(0, -.65), 0x5bb2ac);
        for (let i = 0; i < 3; i++) {
          this.mesh(main, 'cone', i % 2 ? CREAM : RED, -.3 + .3 * i, .24, .48, .22, .48, .22);
        }
        spin = (t, e) => wheels.forEach((wheel, i) => { wheel.rotation.z = t * (1 + i * .27) + e * Math.sin(t * 4) * 2; });
        break;
      }
      case 'shift-whistle': {
        this.pole(main, METAL, 1.65);
        const siren = this.pivot(main, 0, 1.7, 0);
        this.mesh(siren, 'cylinder', DARK, 0, .07, 0, .54, .14, .54);
        this.mesh(siren, 'cylinder', RED, 0, .28, 0, .4, .38, .4);
        this.mesh(siren, 'box', color, 0, .28, .22, .24, .21, .06, true);
        this.mesh(siren, 'cylinder', DARK, 0, .49, 0, .47, .08, .47);
        this.crate(side(-.9, .05), 0xb38145);
        for (const x of [-.75, .75]) {
          const marker = side(x, .73);
          this.mesh(marker, 'box', DARK, 0, .05, 0, .43, .10, .43);
          this.mesh(marker, 'cone', RED, 0, .35, 0, .32, .61, .32);
          this.mesh(marker, 'cylinder', CREAM, 0, .33, 0, .21, .11, .21);
        }
        spin = (t, e) => { siren.rotation.y = t * .22 + e * Math.sin(t * 3) * 4; };
        break;
      }
      case 'busker-break': {
        const drum = this.pivot(main, 0, .43, 0);
        this.mesh(drum, 'cylinder', color, 0, 0, 0, .86, .66, .86);
        for (const y of [-.33, .33]) this.mesh(drum, 'cylinder', CREAM, 0, y, 0, .91, .065, .91);
        for (let i = 0; i < 8; i++) {
          const a = i * Math.PI / 4;
          this.mesh(drum, 'box', DARK, Math.cos(a) * .42, 0, Math.sin(a) * .42, .045, .62, .045);
        }
        this.pole(side(-.85, .2), METAL, 1.38);
        const mic = side(-.85, .2);
        const microphone = this.mesh(mic, 'cylinder', DARK, 0, 1.44, 0, .18, .32, .18);
        microphone.rotation.z = -.7;
        const caseRoot = side(.75, .4);
        this.mesh(caseRoot, 'box', DARK, 0, .08, 0, .76, .16, .48);
        this.mesh(caseRoot, 'box', 0x9f354a, 0, .17, 0, .67, .04, .39);
        this.mesh(caseRoot, 'box', DARK, 0, .27, -.25, .76, .42, .07).rotation.x = -.23;
        for (const x of [-.17, .15]) this.mesh(caseRoot, 'cylinder', GOLD, x, .21, 0, .13, .045, .13);
        spin = (t, e) => { drum.position.y = .43 + e * Math.abs(Math.sin(t * 11)) * .22; drum.rotation.z = e * Math.sin(t * 9) * .14; };
        break;
      }
      case 'summit-mail': {
        this.pole(main, METAL, 1.75);
        const vane = this.pivot(main, 0, 1.74, 0);
        this.mesh(vane, 'box', DARK, 0, 0, 0, 1.14, .08, .09);
        const arrow = this.mesh(vane, 'cone', color, .66, 0, 0, .31, .45, .31);
        arrow.rotation.z = -Math.PI / 2;
        this.mesh(vane, 'box', RED, -.48, .14, 0, .35, .34, .06);
        this.mesh(vane, 'ball', GOLD, 0, .12, 0, .2, .2, .2);
        this.crate(side(-.8, .25), METAL);
        const pennant = side(.85, -.1);
        this.pole(pennant, WOOD, .95);
        this.mesh(pennant, 'box', color, .23, .8, 0, .42, .24, .06);
        spin = (t, e) => { vane.rotation.y = Math.sin(t * .53) * .8 + e * Math.sin(t * 3) * 5; };
        break;
      }
      case 'lantern-circle': {
        this.lantern(main, color, .85);
        this.lantern(side(-.68, -.43), GOLD, .5);
        this.lantern(side(.68, -.43), color, .52);
        const roll = side(.8, .59);
        this.mesh(roll, 'cylinder', GREEN, 0, .17, 0, .34, .67, .34).rotation.z = Math.PI / 2;
        this.mesh(roll, 'box', CREAM, 0, .19, 0, .10, .34, .34);
        const motes = [this.mesh(main, 'ball', color, .35, .6, 0, .10, .10, .10, true),
          this.mesh(main, 'ball', GOLD, -.35, .8, 0, .08, .08, .08, true)];
        spin = (t, e) => motes.forEach((m, i) => {
          m.position.set(Math.cos(t + i * Math.PI) * (.43 + e * .5), .75 + .26 * Math.sin(t * 2 + i),
            Math.sin(t + i * Math.PI) * (.43 + e * .5));
        });
        break;
      }
      case 'pressure-check': {
        this.pole(main, METAL, 1.05);
        const gauge = this.pivot(main, 0, 1.23, .02);
        this.mesh(gauge, 'cylinder', DARK, 0, 0, 0, .78, .17, .78).rotation.x = Math.PI / 2;
        this.mesh(gauge, 'cylinder', CREAM, 0, 0, .10, .65, .045, .65).rotation.x = Math.PI / 2;
        for (let i = 0; i < 7; i++) {
          const a = i * Math.PI / 6;
          const tick = this.mesh(gauge, 'box', DARK, .26 * Math.cos(a), .26 * Math.sin(a), .135, .085, .035, .025);
          tick.rotation.z = a;
        }
        const needle = this.pivot(gauge, 0, 0, .16);
        this.mesh(needle, 'box', RED, .13, 0, 0, .29, .045, .035);
        this.mesh(needle, 'ball', DARK, 0, 0, 0, .095, .095, .075);
        const valve = side(.86, .2);
        this.pole(valve, METAL, .62);
        this.mesh(valve, 'ring', RED, 0, .68, 0, .48, .48, .48).rotation.x = Math.PI / 2;
        this.mesh(valve, 'box', RED, 0, .68, 0, .40, .06, .08);
        this.crate(side(-.88, -.18), METAL);
        spin = (t, e) => { needle.rotation.z = 1.4 + .12 * Math.sin(t * 1.3) + e * 1.25 * Math.sin(t * 7); };
        break;
      }
      case 'signal-home': {
        this.pole(main, WOOD, 1.03);
        const light = this.pivot(main, 0, 1.04, 0);
        this.lantern(light, color, .6);
        this.mesh(light, 'box', CREAM, 0, .31, .18, .24, .21, .08, true);
        this.crate(side(-.78, .3), 0x537c91);
        const rope = side(.76, -.12);
        for (let i = 0; i < 3; i++) {
          this.mesh(rope, 'ring', GOLD, 0, .07 + i * .08, 0, .62 - i * .09, .62 - i * .09, .62).rotation.x = Math.PI / 2;
        }
        spin = (t, e) => { light.rotation.y = t * .45 + e * Math.sin(t * 3) * 4; };
        break;
      }
    }
    const spark = this.mesh(group, 'ball', color, 0, 2.15, 0, .16, .16, .16, true);
    const bursts = Array.from({ length: 8 }, (_, i) =>
      this.mesh(group, 'ball', i % 2 ? color : CREAM, 0, 0, 0, .15, .15, .15, true));
    for (const burst of bursts) burst.visible = false;
    group.visible = false;
    this.root.add(group);
    this.scenes.push({ site, group, spin, spark, bursts });
  }

  private recordShop?: ReturnType<typeof buildNoniShop>;
  private bakeryRolls: THREE.Group[] = [];

  update(time: number, camera: Vec3, enabled: boolean, bakeryEnabled = enabled): void {
    const records = this.happenings.records;
    if (this.recordShop && records) {
      this.recordShop.group.visible = this.recordShop.group.position.distanceToSquared(camera) < (140 * records.site.scale) ** 2;
      if (this.recordShop.group.visible) this.recordShop.update(records, time);
    }
    const batch = this.happenings.bakery;
    if (batch) this.bakeryRolls.forEach((roll, index) => {
      roll.visible = bakeryEnabled && batch.roll(index, time, roll.position);
      if (roll.visible) roll.rotation.y = batch.site.yaw + index * .8;
    });
    for (const { site, group, spin, spark, bursts } of this.scenes) {
      group.visible = enabled && group.position.distanceToSquared(camera) < (70 * site.scale) ** 2;
      if (!group.visible) continue;
      const age = this.happenings.reaction(site, time);
      const energy = age === undefined ? 0 : 1 - age / 5;
      spin(time, energy);
      spark.visible = !this.happenings.discovered(site);
      spark.position.y = 2.15 + .17 * Math.sin(time * 2.1);
      for (let i = 0; i < bursts.length; i++) {
        const burst = bursts[i]!;
        burst.visible = age !== undefined;
        if (age === undefined) continue;
        const angle = i * Math.PI / 4 + age * 1.7;
        const radius = .35 + age * .38;
        burst.position.set(Math.cos(angle) * radius, 1.15 + age * .26 + .22 * Math.sin(angle * 2), Math.sin(angle) * radius);
        burst.scale.setScalar(.18 * energy + .035);
      }
    }
  }

  dispose(): void {
    this.recordShop?.dispose();
    this.root.removeFromParent();
    for (const geometry of Object.values(this.shapes)) geometry.dispose();
    for (const material of this.materials.values()) material.dispose();
    this.materials.clear();
    this.root.clear();
  }
}
