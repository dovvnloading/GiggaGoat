import * as THREE from 'three';
import type { RigidBody } from '@dimforge/rapier3d-compat';
import {
  createWorldScene, type PropDescriptor, type WorldScene,
} from '../world';
import { V, type Vec3, type GoatRagdoll } from '../physics';
import type { GameSettings } from './Persistence';
import { type BuildPiece, type PieceType } from '../gameplay';
import { Game } from './Game';
import { GameInput } from './GameInput';
import { GameHud } from './GameHud';

interface GoatVisual { part: THREE.Group; body: RigidBody }
interface PropVisual { mesh: THREE.InstancedMesh; index: number; prop: PropDescriptor }
const MATERIALS: Record<PieceType, number> = {
  floor: 0xf2c14f, wall: 0xe8aa57, ramp: 0xc9924f, 'launch-pad': 0xff891e,
};

const lerpAlpha = (speed: number, dt: number): number => 1 - Math.exp(-speed * dt);
const vec = (p: Vec3): THREE.Vector3 => new THREE.Vector3(p.x, p.y, p.z);

/** All graphics, time sampling, DOM and input live outside the headless Game. */
export class GameView {
  readonly renderer: THREE.WebGLRenderer;
  readonly camera = new THREE.PerspectiveCamera(67, 1, .07, 2200);
  readonly scene = new THREE.Scene();
  readonly world: WorldScene;
  readonly input: GameInput;
  readonly hud: GameHud;
  private readonly goatParts: GoatVisual[] = [];
  private readonly botParts = new Map<string, GoatVisual[]>();
  private readonly botMaterials = new Map<string, THREE.Material>();
  private readonly botGeometry = new THREE.SphereGeometry(1, 10, 7);
  private readonly botEyes = new THREE.SphereGeometry(1, 8, 6);
  private readonly botHorns = new THREE.ConeGeometry(.5, 1, 7);
  private readonly botEyeMaterial = new THREE.MeshToonMaterial({ color: 0x302b43 });
  private readonly botHornMaterial = new THREE.MeshToonMaterial({ color: 0xffe9c4 });
  private readonly botMuzzleMaterial = new THREE.MeshToonMaterial({ color: 0xfff5df });
  private readonly boardMarkers = new THREE.Group();
  private readonly gigMarkers = new THREE.Group();
  private readonly gigProps = new Map<string, THREE.Mesh>();
  private readonly heistBales = new Map<string, THREE.Mesh>();
  private readonly textTextures: THREE.Texture[] = [];
  private displayedGig = -1;
  private displayedMode: string | null = null;
  private currentSettings: GameSettings = { mouseSensitivity: 1, invertY: false, fov: 67,
    graphics: 'high', volume: .8 };
  paused = false;
  onFrame: (() => void) | null = null;
  onInteract: (() => boolean) | null = null;
  private readonly propVisuals: PropVisual[] = [];
  private readonly buildVisuals = new Map<number, THREE.Mesh>();
  private readonly debrisVisuals = new Map<number, THREE.Mesh>();
  private readonly markers = new THREE.Group();
  private readonly goatMaterials: THREE.Material[] = [];
  private readonly ownedGeometries: THREE.BufferGeometry[] = [];
  private readonly debrisGeometry = new THREE.BoxGeometry(1, 1, 1);
  private readonly debrisMaterial = new THREE.MeshToonMaterial({ color: 0xd6b36f });
  private readonly cameraTarget = new THREE.Vector3();
  private readonly cameraPosition = new THREE.Vector3();
  private readonly dummy = new THREE.Object3D();
  private readonly onResize: () => void;
  private lastTimestamp = 0;
  private fps = 60;
  private simMs = 0;
  private disposed = false;

  constructor(private readonly host: HTMLElement, readonly game: Game) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.7));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;outline:none;touch-action:none';
    host.appendChild(this.renderer.domElement);
    this.camera.position.set(0, 5, 8);
    this.scene.background = new THREE.Color(0x87c5f0);
    this.scene.fog = new THREE.FogExp2(0xb8deef, .0016);
    this.world = createWorldScene(game.island, { chunkSegments: 24, cullingDistance: 530 });
    this.scene.add(this.world.group);
    this.world.sun.castShadow = true;
    this.world.sun.shadow.mapSize.set(1024, 1024);
    this.world.sun.shadow.camera.left = -42;
    this.world.sun.shadow.camera.right = 42;
    this.world.sun.shadow.camera.top = 42;
    this.world.sun.shadow.camera.bottom = -42;
    this.world.sun.shadow.camera.near = .2;
    this.world.sun.shadow.camera.far = 300;
    this.world.sun.shadow.bias = -.00035;
    this.scene.add(this.world.sun.target);
    this.input = new GameInput(this.renderer.domElement, game.island.spawns[0]!.heading);
    this.hud = new GameHud(host);
    this.createGoat();
    this.bindWorldProps();
    this.createSurfaceMarkers();
    this.createBoardMarkers();
    this.scene.add(this.gigMarkers);
    const p = vec(game.goat.torso.translation());
    this.cameraTarget.copy(p);
    this.cameraPosition.copy(p).add(new THREE.Vector3(0, 3.3, 7));
    this.camera.position.copy(this.cameraPosition);
    this.onResize = () => {
      const width = Math.max(1, host.clientWidth), height = Math.max(1, host.clientHeight);
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(width, height, false);
    };
    window.addEventListener('resize', this.onResize);
    this.onResize();
    this.renderer.setAnimationLoop(time => { this.frame(time); });
  }

  private mesh(parent: THREE.Object3D, geometry: THREE.BufferGeometry,
    material: THREE.Material, p = new THREE.Vector3()): THREE.Mesh {
    const item = new THREE.Mesh(geometry, material);
    item.position.copy(p);
    item.castShadow = true;
    item.receiveShadow = true;
    parent.add(item);
    return item;
  }

  private blob(parent: THREE.Object3D, material: THREE.Material, pos: Vec3,
    radius: Vec3, detail = 12): THREE.Mesh {
    const geometry = new THREE.SphereGeometry(1, detail, 9);
    this.ownedGeometries.push(geometry);
    const item = this.mesh(parent, geometry, material, vec(pos));
    item.scale.set(radius.x, radius.y, radius.z);
    return item;
  }

  private createGoat(): void {
    this.removeGoat();
    const size = this.game.goat.size;
    const cream = new THREE.MeshToonMaterial({ color: 0xf7ebd3 });
    const ivory = new THREE.MeshToonMaterial({ color: 0xfff6e4 });
    const tan = new THREE.MeshToonMaterial({ color: 0xb88459 });
    const dark = new THREE.MeshToonMaterial({ color: 0x42372f });
    const pink = new THREE.MeshToonMaterial({ color: 0xdd9d8b });
    const scarf = new THREE.MeshToonMaterial({ color: 0xff891e });
    const gold = new THREE.MeshToonMaterial({ color: 0xffd833 });
    this.goatMaterials.push(cream, ivory, tan, dark, pink, scarf, gold);
    for (const name of ['torso', 'neck', 'head',
      'frontLeft', 'frontRight', 'backLeft', 'backRight'] as const) {
      const group = new THREE.Group();
      group.name = 'goat-' + name;
      this.scene.add(group);
      this.goatParts.push({ part: group, body: this.game.goat.getPart(name) });
      if (name === 'torso') {
        this.blob(group, cream, V(), V(.34 * size, .30 * size, .57 * size), 16);
        this.blob(group, ivory, V(0, .21 * size, -.19 * size),
          V(.26 * size, .11 * size, .34 * size));
        this.blob(group, cream, V(0, .16 * size, .53 * size),
          V(.13 * size, .16 * size, .17 * size));
      } else if (name === 'neck') {
        this.blob(group, cream, V(), V(.19 * size, .25 * size, .22 * size));
        const ring = new THREE.TorusGeometry(.2 * size, .058 * size, 7, 18);
        this.ownedGeometries.push(ring);
        this.mesh(group, ring, scarf, new THREE.Vector3(0, .075 * size, 0))
          .rotation.x = Math.PI / 2;
        this.blob(group, scarf, V(.18 * size, -.13 * size, .08 * size),
          V(.085 * size, .20 * size, .08 * size));
        this.blob(group, gold, V(.21 * size, -.29 * size, .08 * size),
          V(.07 * size, .06 * size, .08 * size));
      } else if (name === 'head') {
        this.blob(group, cream, V(), V(.255 * size, .23 * size, .265 * size), 16);
        this.blob(group, ivory, V(0, -.065 * size, -.22 * size),
          V(.20 * size, .145 * size, .17 * size), 16);
        this.blob(group, pink, V(0, -.10 * size, -.358 * size),
          V(.12 * size, .075 * size, .05 * size));
        for (const side of [-1, 1]) {
          this.blob(group, cream, V(side * .26 * size, .085 * size, .015 * size),
            V(.17 * size, .075 * size, .11 * size));
          this.blob(group, dark, V(side * .145 * size, .048 * size, -.195 * size),
            V(.060 * size, .067 * size, .032 * size));
          this.blob(group, ivory, V(side * .13 * size, .067 * size, -.224 * size),
            V(.018 * size, .018 * size, .008 * size), 8);
          const hornCurve = new THREE.CatmullRomCurve3([
            new THREE.Vector3(side * .15 * size, .18 * size, .03 * size),
            new THREE.Vector3(side * .18 * size, .33 * size, .06 * size),
            new THREE.Vector3(side * .30 * size, .43 * size, .12 * size),
            new THREE.Vector3(side * .35 * size, .38 * size, .19 * size),
            new THREE.Vector3(side * .27 * size, .31 * size, .24 * size),
          ]);
          const horn = new THREE.TubeGeometry(hornCurve, 14, .063 * size, 6, false);
          this.ownedGeometries.push(horn);
          this.mesh(group, horn, tan);
        }
      } else {
        this.blob(group, ivory, V(), V(.112 * size, .38 * size, .13 * size), 12);
        this.blob(group, tan, V(0, -.31 * size, -.018 * size),
          V(.128 * size, .11 * size, .145 * size), 10);
      }
    }
  }

  private removeGoat(): void {
    for (const visual of this.goatParts) {
      this.scene.remove(visual.part);
    }
    this.goatParts.length = 0;
    for (const material of this.goatMaterials.splice(0)) material.dispose();
    for (const geometry of this.ownedGeometries.splice(0)) geometry.dispose();
  }

  /** The world exports only a scene group, not individual dynamic prop mesh handles.
   * Identify its existing instanced batches by kind and keep their transforms in sync. */
  private bindWorldProps(): void {
    const batches = new Map<string, PropDescriptor[]>();
    for (const prop of this.game.island.props) {
      const list = batches.get(prop.kind) ?? [];
      list.push(prop);
      batches.set(prop.kind, list);
    }
    this.world.group.traverse(object => {
      if (!(object instanceof THREE.InstancedMesh) || !object.name.startsWith('props-')) return;
      const kind = object.name.substring('props-'.length);
      const entries = batches.get(kind);
      if (!entries) return;
      // A shattered source is hidden by a zero-scale instance; any new material
      // or tree geometry generated by the world lane is preserved untouched.
      for (let index = 0; index < Math.min(entries.length, object.count); index++) {
        const prop = entries[index]!;
        if (this.game.colliders.bodies.has(prop.id)) {
          this.propVisuals.push({ mesh: object, index, prop });
        }
      }
      object.frustumCulled = false;
    });
  }

  private updateProps(alpha: number): void {
    const changed = new Set<THREE.InstancedMesh>();
    for (const { mesh, index, prop } of this.propVisuals) {
      const body = this.game.colliders.bodies.get(prop.id);
      const live = body && this.game.physics.raw.getRigidBody(body.handle);
      if (live && !this.game.destroyedProps.has(prop.id)) {
        const pose = this.game.physics.getInterpolatedTransform(live, alpha);
        this.dummy.position.copy(vec(pose.translation));
        this.dummy.quaternion.set(pose.rotation.x, pose.rotation.y, pose.rotation.z, pose.rotation.w);
        this.dummy.scale.set(prop.size.x, prop.size.y, prop.size.z);
      } else {
        this.dummy.position.set(0, -1000, 0);
        this.dummy.quaternion.identity();
        this.dummy.scale.setScalar(0);
      }
      this.dummy.updateMatrix();
      mesh.setMatrixAt(index, this.dummy.matrix);
      changed.add(mesh);
    }
    for (const mesh of changed) mesh.instanceMatrix.needsUpdate = true;
  }

  private createSurfaceMarkers(): void {
    this.scene.add(this.markers);
    for (const marker of this.game.surfaceMarkers) {
      const group = new THREE.Group();
      group.position.copy(vec(marker.position));
      const color = marker.kind === 'trampoline' ? 0x7a4cff : 0xff891e;
      const material = new THREE.MeshToonMaterial({ color, emissive: color, emissiveIntensity: .16 });
      const frame = new THREE.Mesh(new THREE.BoxGeometry(marker.halfExtents.x * 2,
        .18, marker.halfExtents.z * 2), material);
      frame.position.y = marker.halfExtents.y + .09;
      frame.castShadow = true;
      group.add(frame);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(1.6, .105, 7, 24),
        new THREE.MeshToonMaterial({ color: 0xffd833 }));
      rim.rotation.x = -Math.PI / 2;
      rim.position.y = marker.halfExtents.y + .19;
      group.add(rim);
      if (marker.kind === 'launch') {
        const arrow = new THREE.Mesh(new THREE.ConeGeometry(.7, 1.6, 3),
          new THREE.MeshBasicMaterial({ color: 0xfff3cc, side: THREE.DoubleSide }));
        arrow.rotation.x = -Math.PI / 2;
        arrow.position.set(0, marker.halfExtents.y + .22, 0);
        group.add(arrow);
      } else {
        for (const x of [-1.6, 1.6]) for (const z of [-1.6, 1.6]) {
          this.mesh(group, new THREE.CylinderGeometry(.17, .17, .29, 6),
            new THREE.MeshToonMaterial({ color: 0xffd833 }),
            new THREE.Vector3(x, marker.halfExtents.y - .09, z));
        }
      }
      this.markers.add(group);
    }
  }

  /** Instanced world props remain owned by the world lane. Our signposts are independent. */
  private createBoardMarkers(): void {
    this.scene.add(this.boardMarkers);
    for (const board of this.game.gigs.boards) {
      const group = new THREE.Group();
      group.position.set(board.position.x, board.position.y + .15, board.position.z);
      const post = new THREE.Mesh(new THREE.CylinderGeometry(.23, .3, 3.0, 6),
        new THREE.MeshToonMaterial({ color: 0xffd833 }));
      post.position.y = 1.5;
      post.castShadow = true;
      group.add(post);
      const sign = new THREE.Mesh(new THREE.BoxGeometry(3.6, 1.9, .32),
        new THREE.MeshToonMaterial({ color: 0x6542b9, emissive: 0x35216e, emissiveIntensity: .3 }));
      sign.position.y = 3.3;
      sign.castShadow = true;
      group.add(sign);
      group.add(this.textSprite('E · GIGS', 4.8, 1.2, 3.4));
      const ring = new THREE.Mesh(new THREE.RingGeometry(3.8, 4.25, 28),
        new THREE.MeshBasicMaterial({ color: 0xffd833, side: THREE.DoubleSide, transparent: true, opacity: .7 }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = .09;
      group.add(ring);
      this.boardMarkers.add(group);
    }
  }

  private textSprite(label: string, width: number, height: number, y: number): THREE.Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = 128;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#32254f'; ctx.fillRect(6, 10, 500, 108);
      ctx.strokeStyle = '#ffd833'; ctx.lineWidth = 9; ctx.strokeRect(6, 10, 500, 108);
      ctx.fillStyle = '#fff2bd'; ctx.font = '900 51px system-ui';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(label.slice(0, 20), 256, 67, 475);
    }
    const texture = new THREE.CanvasTexture(canvas);
    this.textTextures.push(texture);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: texture, transparent: true, depthWrite: false,
    }));
    sprite.position.y = y; sprite.scale.set(width, height, 1);
    return sprite;
  }

  private clearGroup(group: THREE.Group): void {
    for (const child of [...group.children]) {
      child.traverse(object => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          if (Array.isArray(object.material)) object.material.forEach(m => m.dispose());
          else object.material.dispose();
        } else if (object instanceof THREE.Sprite) {
          object.material.dispose();
        }
      });
      child.removeFromParent();
    }
  }

  private updateGigVisuals(alpha: number): void {
    const run = this.game.gigs.active;
    const attempt = run?.status === 'running' ? run.attemptId : -1;
    if (attempt !== this.displayedGig) {
      this.displayedGig = attempt;
      this.clearGroup(this.gigMarkers);
      for (const mesh of this.gigProps.values()) {
        mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose();
        mesh.removeFromParent();
      }
      this.gigProps.clear();
      if (run?.status === 'running') {
        const markers = [...run.setup.markers];
        if (run.setup.config.kind === 'hay-haul') {
          for (const bale of run.setup.config.bales) {
            markers.push({ id: bale.id, label: 'HAY TARGET', position: bale.start,
              radius: 2.1, type: 'checkpoint' });
          }
        }
        for (const marker of markers) {
          const group = new THREE.Group();
          group.position.copy(vec(marker.position));
          const ring = new THREE.Mesh(new THREE.RingGeometry(
            Math.max(1.15, marker.radius * .65), Math.max(1.5, marker.radius * .65 + .38), 32),
            new THREE.MeshBasicMaterial({ color: marker.type === 'destination' ? 0x88ffcb : 0xffd833,
              side: THREE.DoubleSide, transparent: true, opacity: .78, depthWrite: false }));
          ring.rotation.x = -Math.PI / 2; ring.position.y = .15; group.add(ring);
          const arrow = new THREE.Mesh(new THREE.ConeGeometry(.7, 1.2, 5),
            new THREE.MeshToonMaterial({ color: 0xffd833, emissive: 0x7a4cff, emissiveIntensity: .5 }));
          arrow.position.y = 3; group.add(arrow);
          group.add(this.textSprite(marker.label, 4.6, 1.15, 4.2));
          this.gigMarkers.add(group);
        }
        for (const spawn of run.setup.spawns) {
          const color = new THREE.Color(spawn.color);
          const mesh = new THREE.Mesh(new THREE.BoxGeometry(spawn.size.x, spawn.size.y, spawn.size.z),
            new THREE.MeshToonMaterial({ color }));
          mesh.castShadow = true; mesh.receiveShadow = true;
          this.scene.add(mesh); this.gigProps.set(spawn.id, mesh);
        }
      }
    }
    for (const [id, mesh] of this.gigProps) {
      const prop = this.game.gigs.props.get(id);
      if (!prop) { mesh.visible = false; continue; }
      mesh.visible = !prop.broken;
      const pose = this.game.physics.getInterpolatedTransform(prop.body, alpha);
      mesh.position.copy(vec(pose.translation));
      mesh.quaternion.set(pose.rotation.x, pose.rotation.y, pose.rotation.z, pose.rotation.w);
    }
    for (const group of this.gigMarkers.children) {
      const ring = group.children[0];
      if (ring instanceof THREE.Mesh && ring.material instanceof THREE.MeshBasicMaterial) {
        ring.material.opacity = .6 + .22 * Math.sin(this.game.physics.time * 3);
      }
    }
  }

  private updatePartyVisuals(alpha: number): void {
    const roster = this.game.party.bots;
    for (const [id, parts] of this.botParts) {
      if (roster.has(id)) continue;
      for (const { part } of parts) part.removeFromParent();
      this.botParts.delete(id);
      this.botMaterials.get(id)?.dispose();
      this.botMaterials.delete(id);
    }
    let index = 0;
    for (const [id, bot] of roster) {
      let parts = this.botParts.get(id);
      if (!parts || parts[0]?.body.handle !== bot.goat.torso.handle) {
        for (const { part } of parts ?? []) part.removeFromParent();
        const palette = [0xfa94a2,0x79d7de,0xf8b85c,0xb1a4fb,0x8ed28b,0xe1aeeb,0xd3b785];
        const material = new THREE.MeshToonMaterial({ color: palette[index % palette.length] });
        this.botMaterials.get(id)?.dispose();
        this.botMaterials.set(id, material);
        parts = [];
        const names = ['torso','neck','head','frontLeft','frontRight','backLeft','backRight'] as const;
        const radii = [[.34,.30,.57],[.19,.25,.22],[.25,.23,.26],
          [.12,.38,.13],[.12,.38,.13],[.12,.38,.13],[.12,.38,.13]];
        for (let j=0;j<names.length;j++) {
          const group = new THREE.Group();
          const shape = new THREE.Mesh(this.botGeometry, material);
          const size = bot.goat.size, rad = radii[j]!;
          shape.scale.set(rad[0]!*size, rad[1]!*size, rad[2]!*size);
          shape.castShadow = true;
          group.add(shape);
          // Head, eyes and horns all follow the real head rigid body. Opponents
          // are recognizably goats even when several colorful bodies overlap.
          if (names[j] === 'head') {
            const muzzle = new THREE.Mesh(this.botGeometry, this.botMuzzleMaterial);
            muzzle.position.set(0, -.08 * size, -.23 * size);
            muzzle.scale.set(.19 * size, .13 * size, .17 * size);
            group.add(muzzle);
            for (const side of [-1, 1]) {
              const eye = new THREE.Mesh(this.botEyes, this.botEyeMaterial);
              eye.position.set(side * .14 * size, .065 * size, -.19 * size);
              eye.scale.set(.055 * size, .063 * size, .035 * size);
              group.add(eye);
              const horn = new THREE.Mesh(this.botHorns, this.botHornMaterial);
              horn.position.set(side * .17 * size, .29 * size, .075 * size);
              horn.rotation.z = -side * .26;
              horn.scale.set(.19 * size, .34 * size, .19 * size);
              horn.castShadow = true;
              group.add(horn);
            }
          }
          this.scene.add(group);
          parts.push({ part: group, body: bot.goat.getPart(names[j]!) });
        }
        this.botParts.set(id, parts);
      }
      for (const { part, body } of parts) {
        const pose = this.game.physics.getInterpolatedTransform(body, alpha);
        part.position.copy(vec(pose.translation));
        part.quaternion.set(pose.rotation.x, pose.rotation.y, pose.rotation.z, pose.rotation.w);
      }
      index++;
    }
    const match = this.game.party.match;
    const mode = match ? match.mode : null;
    if (this.displayedMode !== mode) {
      for (const mesh of this.heistBales.values()) {
        mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose();
        mesh.removeFromParent();
      }
      this.heistBales.clear(); this.displayedMode = mode;
    }
    if (match?.mode === 'hay-heist') {
      for (const bale of match.bales) {
        let mesh = this.heistBales.get(bale.id);
        if (!mesh) {
          mesh = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1, 1.1),
            new THREE.MeshToonMaterial({ color: 0xf2c14f }));
          mesh.castShadow = true;
          this.scene.add(mesh); this.heistBales.set(bale.id, mesh);
        }
        const carrier = bale.carrierId === 'player' ? this.game.goat :
          roster.get(bale.carrierId ?? '')?.goat;
        const point = carrier ? carrier.torso.translation() : bale.position;
        mesh.position.set(point.x, point.y + (carrier ? 1 : .25), point.z);
        mesh.rotation.y += .009;
      }
    }
  }

  applySettings(settings: GameSettings): void {
    this.currentSettings = { ...settings };
    this.input.sensitivity = settings.mouseSensitivity;
    this.input.invertY = settings.invertY;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1,
      settings.graphics === 'high' ? 1.7 : settings.graphics === 'medium' ? 1.25 : 1));
    this.renderer.shadowMap.enabled = settings.graphics !== 'low';
    this.world.sun.castShadow = settings.graphics !== 'low';
    this.onResize();
  }

  private buildGeometry(piece: BuildPiece): THREE.BufferGeometry {
    if (piece.type === 'ramp') {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute([
        -1,-.9,-1, 1,-.9,-1, -1,-.9,1, 1,-.9,1, -1,.9,1, 1,.9,1,
      ], 3));
      geometry.setIndex([0,2,1,1,2,3,2,4,3,3,4,5,0,1,4,1,5,4,0,4,2,1,3,5]);
      geometry.computeVertexNormals();
      return geometry;
    }
    return new THREE.BoxGeometry(piece.type === 'wall' ? .46 : 2,
      piece.type === 'wall' ? 2 : .46, 2);
  }

  private updateBuildings(): void {
    const entries = this.game.rules.build.pieces;
    const active = new Set(entries.map(piece => piece.id));
    for (const [id, mesh] of this.buildVisuals) {
      if (!active.has(id)) {
        this.scene.remove(mesh);
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
        this.buildVisuals.delete(id);
      }
    }
    for (const piece of entries) {
      if (this.buildVisuals.has(piece.id)) continue;
      const body = this.game.buildBodies.get(piece.id);
      if (!body) continue;
      const mesh = new THREE.Mesh(this.buildGeometry(piece),
        new THREE.MeshToonMaterial({ color: MATERIALS[piece.type], side: THREE.DoubleSide }));
      mesh.position.copy(vec(body.translation()));
      const q = body.rotation();
      mesh.quaternion.set(q.x, q.y, q.z, q.w);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.scene.add(mesh);
      this.buildVisuals.set(piece.id, mesh);
    }
  }

  private updateDebris(alpha: number): void {
    const handles = new Set([
      ...this.game.breakables.debrisHandles,
      ...this.game.fallingPieces.keys(),
    ]);
    for (const [handle, mesh] of this.debrisVisuals) if (!handles.has(handle) ||
      !this.game.physics.raw.getRigidBody(handle)) {
      this.scene.remove(mesh);
      this.debrisVisuals.delete(handle);
    }
    for (const handle of handles) {
      const body = this.game.physics.raw.getRigidBody(handle);
      if (!body) continue;
      let mesh = this.debrisVisuals.get(handle);
      if (!mesh) {
        mesh = new THREE.Mesh(this.debrisGeometry, this.debrisMaterial);
        const radius = Math.max(.12, Math.min(.65, Math.cbrt(body.mass()) * .24));
        mesh.scale.set(radius, radius, radius);
        mesh.castShadow = true;
        this.scene.add(mesh);
        this.debrisVisuals.set(handle, mesh);
      }
      const pose = this.game.physics.getInterpolatedTransform(body, alpha);
      mesh.position.copy(vec(pose.translation));
      mesh.quaternion.set(pose.rotation.x, pose.rotation.y, pose.rotation.z, pose.rotation.w);
    }
  }

  private updateGoat(alpha: number): void {
    if (this.goatParts[0]?.body.handle !== this.game.goat.torso.handle) this.createGoat();
    for (const { part, body } of this.goatParts) {
      const pose = this.game.physics.getInterpolatedTransform(body, alpha);
      part.position.copy(vec(pose.translation));
      part.quaternion.set(pose.rotation.x, pose.rotation.y, pose.rotation.z, pose.rotation.w);
    }
  }

  private updateCamera(alpha: number, dt: number): void {
    const pose = this.game.physics.getInterpolatedTransform(this.game.goat.torso, alpha);
    const size = this.game.rules.style.scale;
    const target = vec(pose.translation).add(new THREE.Vector3(0, .4 * size, 0));
    this.cameraTarget.lerp(target, lerpAlpha(12, dt));
    const yaw = this.input.yaw, pitch = this.input.pitch;
    const distance = Math.max(4.3, 6.4 * Math.pow(size, .79));
    const offset = new THREE.Vector3(
      -Math.sin(yaw) * Math.cos(pitch) * distance,
      Math.sin(pitch) * distance + 1.25 * size,
      Math.cos(yaw) * Math.cos(pitch) * distance);
    const direction = offset.clone().normalize();
    const desiredDistance = offset.length();
    const hit = this.game.physics.raycast(this.cameraTarget, V(direction.x, direction.y, direction.z),
      desiredDistance, { predicate: collider => !this.game.goat.ownsBody(collider.parent()) });
    let safe = hit ? Math.max(1.1 * size, Math.min(desiredDistance, hit.distance - .36 * size)) :
      desiredDistance;
    const desired = this.cameraTarget.clone().addScaledVector(direction, safe);
    this.cameraPosition.lerp(desired, lerpAlpha(9, dt));
    // A second query keeps the smoothed camera from passing through a wall when
    // the obstacle suddenly gets between the target and the previous position.
    const path = this.cameraPosition.clone().sub(this.cameraTarget);
    const pathLength = path.length();
    if (pathLength > 0.01) {
      const immediate = this.game.physics.raycast(this.cameraTarget,
        V(path.x / pathLength, path.y / pathLength, path.z / pathLength),
        pathLength, { predicate: collider => !this.game.goat.ownsBody(collider.parent()) });
      if (immediate) {
        safe = Math.max(.6, immediate.distance - .24 * size);
        this.cameraPosition.copy(this.cameraTarget).addScaledVector(path.normalize(), safe);
      }
    }
    const speed = vec(this.game.goat.torso.linvel()).length();
    const kick = this.game.goat.locomotion.input.sprint ? 7 : Math.min(14, Math.max(0, speed - 8) * 1.4);
    const fov = this.currentSettings.fov + kick;
    this.camera.fov += (fov - this.camera.fov) * lerpAlpha(5, dt);
    this.camera.updateProjectionMatrix();
    this.camera.position.copy(this.cameraPosition);
    this.camera.lookAt(this.cameraTarget);
    this.world.sun.position.copy(this.cameraTarget).add(new THREE.Vector3(70, 125, -65));
    this.world.sun.target.position.copy(this.cameraTarget);
    this.world.sun.target.updateMatrixWorld();
  }

  private frame(timestamp: number): void {
    if (this.disposed) return;
    const dt = this.lastTimestamp ? Math.min(.07, Math.max(0, (timestamp - this.lastTimestamp) / 1000)) : 1 / 60;
    this.lastTimestamp = timestamp;
    if (dt > 0) this.fps += ((1 / dt) - this.fps) * lerpAlpha(2.6, dt);
    let alpha = this.game.physics.alpha;
    if (!this.paused) {
      let intent = this.input.sample(dt, this.game.buildMode);
      if (intent.interact && this.onInteract?.()) {
        intent = { ...intent, interact: false, bleat: false };
      }
      if (!this.paused) {
        const start = performance.now();
        const result = this.game.advance(dt, intent);
        alpha = result.alpha;
        this.simMs += ((performance.now() - start) - this.simMs) * lerpAlpha(5, dt);
      }
    }
    this.updateGoat(alpha);
    this.updatePartyVisuals(alpha);
    this.updateGigVisuals(alpha);
    this.updateProps(alpha);
    this.updateBuildings();
    this.updateDebris(alpha);
    this.world.setTideLevel(this.game.water.seaLevel);
    this.world.update(this.game.physics.time);
    this.world.setDayNight(.5 + Math.sin(this.game.physics.time / 150) * .035);
    this.updateCamera(alpha, dt);
    this.world.updateCulling(this.camera);
    this.hud.update(this.game, this.fps, this.simMs, this.input.debugVisible,
      document.pointerLockElement === this.renderer.domElement);
    this.renderer.render(this.scene, this.camera);
    this.onFrame?.();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.renderer.setAnimationLoop(null);
    window.removeEventListener('resize', this.onResize);
    this.input.dispose();
    this.hud.dispose();
    this.removeGoat();
    for (const parts of this.botParts.values()) for (const { part } of parts) part.removeFromParent();
    this.botParts.clear();
    for (const material of this.botMaterials.values()) material.dispose();
    this.botMaterials.clear();
    this.botGeometry.dispose(); this.botEyes.dispose(); this.botHorns.dispose();
    this.botEyeMaterial.dispose(); this.botHornMaterial.dispose();
    this.botMuzzleMaterial.dispose();
    this.clearGroup(this.boardMarkers);
    this.clearGroup(this.gigMarkers);
    for (const mesh of this.gigProps.values()) {
      mesh.removeFromParent(); mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose();
    }
    for (const mesh of this.heistBales.values()) {
      mesh.removeFromParent(); mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose();
    }
    this.gigProps.clear(); this.heistBales.clear();
    for (const texture of this.textTextures) texture.dispose();
    for (const mesh of this.buildVisuals.values()) {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
      mesh.removeFromParent();
    }
    this.buildVisuals.clear();
    for (const mesh of this.debrisVisuals.values()) mesh.removeFromParent();
    this.debrisVisuals.clear();
    this.debrisGeometry.dispose();
    this.debrisMaterial.dispose();
    this.markers.traverse(obj => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        (obj.material as THREE.Material).dispose();
      }
    });
    this.world.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
