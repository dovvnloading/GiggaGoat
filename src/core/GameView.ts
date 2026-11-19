import * as THREE from 'three';
import {
  createWorldScene, heightAt, type PropDescriptor, type WorldScene,
} from '../world';
import { Q, RAPIER, type Vec3 } from '../physics';
import { SKY_HORIZON_COLOR } from '../world/visual-sky';
import { DEFAULT_SETTINGS, type GameSettings } from './Persistence';
import { AdaptiveResolution } from './AdaptiveResolution';
import { GRAPHICS_PRESETS, type GraphicsQuality } from './GraphicsQuality';
import type { GameAudio } from './GameAudio';
import { PropFactory, InstancedPropRenderer } from '../props';
import { HEIST_BALE_SIZE } from '../props/PropFactory';
import { Game } from './Game';
import { GameCharacters } from './GameCharacters';
import { GameVfx } from './GameVfx';
import { GameInput } from './GameInput';
import { BuildPlacementGhost } from './BuildPlacementGhost';
import { CAMERA_TARGET_HEIGHT, PLAY_CAMERA_PITCH, SPAWN_CAMERA_PITCH, SPAWN_CAMERA_YAW_OFFSET,
  goatCameraLookAhead, goatCameraOffset, goatCameraVerticalOffset, goatOrbitOffset,
  goatViewDirection } from './GoatCamera';
import { GameHud, type FramePerformance } from './GameHud';
import { hayHaulGuidance, type HayHaulGuidance } from './GigPresentation';
import { MowDownPresentation } from './MowDownPresentation';
import {
  WORLD_LIBRARY_KINDS, createWorldLibraryProp, createBoardLibraryProp,
  createSurfaceLibraryProp, createSpawnLibraryProp, createHeistHayLibraryProp,
  createBuildLibraryProp, createDebrisLibraryProp,
} from './GamePropMapping';

interface PropVisual {
  mesh: THREE.InstancedMesh;
  index: number;
  prop: PropDescriptor;
  wasSleeping?: boolean;
  wasHidden?: boolean;
}
interface LibraryWorldVisual {
  root: THREE.Group;
  prop: PropDescriptor;
  wasSleeping?: boolean;
  wasHidden?: boolean;
}

const lerpAlpha = (speed: number, dt: number): number => 1 - Math.exp(-speed * dt);
const vec = (p: Vec3): THREE.Vector3 => new THREE.Vector3(p.x, p.y, p.z);
const CAMERA_COLLISION_SKIN = .04;

/** All graphics, time sampling, DOM and input live outside the headless Game. */
export class GameView {
  readonly renderer: THREE.WebGLRenderer;
  readonly camera = new THREE.PerspectiveCamera(67, 1, .07, 2200);
  readonly scene = new THREE.Scene();
  readonly world: WorldScene;
  readonly input: GameInput;
  readonly hud: GameHud;
  readonly characters: GameCharacters;
  readonly vfx: GameVfx;
  private readonly boardRoots: THREE.Group[] = [];
  private readonly boardMarkers = new THREE.Group();
  private readonly gigMarkers = new THREE.Group();
  private readonly partyMarkers = new THREE.Group();
  private readonly gigProps = new Map<string, THREE.Group>();
  private readonly heistBales = new Map<string, THREE.Group>();
  private readonly textTextures = new Set<THREE.Texture>();
  private displayedGig = -1;
  private hayHaul: HayHaulGuidance | null = null;
  private hayHaulPickup: THREE.Sprite | null = null;
  private hayHaulDelivery: THREE.Group | null = null;
  private mowDown: MowDownPresentation | null = null;
  private displayedMode: string | null = null;
  private currentSettings: GameSettings = { ...DEFAULT_SETTINGS };
  paused = false;
  onFrame: (() => void) | null = null;
  onInteract: (() => boolean) | null = null;
  private readonly propFactory = new PropFactory();
  private readonly instancedProps = new InstancedPropRenderer(this.scene);
  private readonly propVisuals: PropVisual[] = [];
  private readonly libraryWorldProps: LibraryWorldVisual[] = [];
  private readonly buildVisuals = new Map<number, THREE.Group>();
  private readonly buildGhost = new BuildPlacementGhost();
  private readonly debrisVisuals = new Map<number, THREE.Group>();
  private readonly activeBuildIds = new Set<number>();
  private readonly activeDebrisIds = new Set<number>();
  private readonly changedPropMeshes = new Set<THREE.InstancedMesh>();
  private readonly shadowDefaults = new WeakMap<THREE.Mesh, boolean>();
  private readonly resolution = new AdaptiveResolution('high', 1);
  private appliedGraphics: GraphicsQuality | null = null;
  private shadowTimer = 1;
  private hudTimer = 1;
  private lastTide = Number.NaN;
  private showingTideRoutes = false;
  private readonly perfStats: FramePerformance = {
    fps: 60, frameMs: 16.67, renderMs: 0, physicsMs: 0,
    drawCalls: 0, triangles: 0, textures: 0, pixelRatio: 1,
  };
  private readonly cameraTarget = new THREE.Vector3();
  private readonly cameraOffset = new THREE.Vector3();
  private readonly cameraDirection = new THREE.Vector3();
  private readonly cameraAim = new THREE.Vector3();
  private cameraDistance = Infinity;
  private titleCamera = true;
  private readonly cameraCollisionShape = new RAPIER.Ball(.25);
  private readonly cameraCollisionRotation = Q();
  private readonly cameraCollisionFilter = {
    predicate: (collider: RAPIER.Collider) => !this.game.goat.ownsBody(collider.parent()),
  };
  private readonly audioForward = new THREE.Vector3();
  private readonly audioPose = {
    position: this.camera.position, forward: this.audioForward, up: { x: 0, y: 1, z: 0 },
  };
  private readonly cameraViewport = new THREE.Vector2();
  private cameraShiftY = 0;
  private readonly dummy = new THREE.Object3D();
  private readonly onResize: () => void;
  private lastTimestamp = 0;
  private fps = 60;
  private simMs = 0;
  private frameMs = 16.67;
  private renderMs = 0;
  private disposed = false;

  constructor(private readonly host: HTMLElement, readonly game: Game,
    private readonly audio?: GameAudio) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setPixelRatio(1); // The saved graphics preset is applied by GameMenu.
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // Colour renders at 60 Hz; only refresh the shadow pass periodically.
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;outline:none;touch-action:none';
    host.appendChild(this.renderer.domElement);
    this.camera.position.set(0, 5, 8);
    this.scene.background = new THREE.Color(0x87c5f0);
    this.scene.fog = new THREE.FogExp2(SKY_HORIZON_COLOR, .0016);
    this.world = createWorldScene(game.island, {
      chunkSegments: 24,
      cullingDistance: 340,
      externallyRenderedPropKinds: WORLD_LIBRARY_KINDS,
    });
    this.scene.add(this.world.group);
    if (this.scene.fog) this.scene.fog.color.copy(this.world.fogColor);
    this.renderer.setClearColor(this.world.fogColor);
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
    // Physics yawQuaternion rotates local -Z toward the opposite sign of the
    // locomotion heading; compose the opening shot from the rendered facing.
    this.input = new GameInput(this.renderer.domElement,
      game.goat.locomotion.heading + SPAWN_CAMERA_YAW_OFFSET);
    this.input.pitch = SPAWN_CAMERA_PITCH;
    this.hud = new GameHud(host);
    this.characters = new GameCharacters(this.scene, game);
    this.vfx = new GameVfx(this.scene, game,
      this.characters.player.root, this.characters.player.mounts.neck);
    this.bindWorldProps();
    this.createSurfaceMarkers();
    this.createBoardMarkers();
    this.scene.add(this.gigMarkers);
    this.scene.add(this.partyMarkers, this.buildGhost.root);
    const p = vec(game.goat.torso.translation());
    const size = game.rules.style.scale;
    this.cameraTarget.copy(p).add(new THREE.Vector3(0, CAMERA_TARGET_HEIGHT * size, 0));
    // Keep the presentation view ready for the first title frame.
    this.camera.position.copy(this.cameraTarget).add(vec(
      goatCameraOffset(size, this.input.yaw, this.input.pitch)));
    this.camera.lookAt(this.cameraTarget.clone().add(vec(
      goatCameraLookAhead(size, this.input.yaw))));
    this.onResize = () => {
      const width = Math.max(1, host.clientWidth), height = Math.max(1, host.clientHeight);
      if (width !== this.cameraViewport.x || height !== this.cameraViewport.y) {
        this.cameraViewport.set(width, height);
        this.applyCameraFraming(this.desiredCameraFraming());
      }
      this.renderer.setSize(width, height, false);
    };
    window.addEventListener('resize', this.onResize);
    this.onResize();
    this.renderer.setAnimationLoop(time => { this.frame(time); });
  }

  alignCameraForPlay(): void {
    const { x, y, z } = this.game.goat.torso.translation();
    this.titleCamera = false;
    this.input.yaw = this.game.goat.locomotion.heading;
    this.input.pitch = PLAY_CAMERA_PITCH;
    this.cameraTarget.set(x, y + CAMERA_TARGET_HEIGHT * this.game.rules.style.scale, z);
    this.cameraDistance = Infinity;
    this.applyCameraFraming(this.desiredCameraFraming());
  }

  /** Bind physics bodies to the view that owns their art. */
  private bindWorldProps(): void {
    const batches = new Map<string, PropDescriptor[]>();
    for (const prop of this.game.island.props) {
      const root = createWorldLibraryProp(this.propFactory, prop);
      if (!root) {
        const list = batches.get(prop.kind) ?? [];
        list.push(prop);
        batches.set(prop.kind, list);
        continue;
      }
      root.position.copy(vec(prop.transform.position));
      root.rotation.y = prop.transform.rotationY;
      this.instancedProps.add(root);
      if (this.game.colliders.bodies.has(prop.id)) {
        this.libraryWorldProps.push({ root, prop });
      }
    }
    this.world.group.traverse(object => {
      if (!(object instanceof THREE.InstancedMesh) || !object.name.startsWith('props-')) return;
      const kind = object.name.substring('props-'.length);
      const entries = batches.get(kind);
      if (!entries) return;
      for (let index = 0; index < Math.min(entries.length, object.count); index++) {
        const prop = entries[index]!;
        if (this.game.colliders.bodies.has(prop.id)) {
          this.propVisuals.push({ mesh: object, index, prop });
        }
      }
      object.frustumCulled = true;
    });
  }

  private updateProps(alpha: number): void {
    for (const visual of this.libraryWorldProps) {
      const { root, prop } = visual;
      const body = this.game.colliders.bodies.get(prop.id);
      const live = body && this.game.physics.raw.getRigidBody(body.handle);
      const hidden = !live || this.game.destroyedProps.has(prop.id);
      if (hidden && visual.wasHidden) continue;
      if (!hidden && live?.isSleeping() && visual.wasSleeping && !visual.wasHidden) continue;
      visual.wasHidden = hidden;
      visual.wasSleeping = !!live?.isSleeping();
      root.visible = !hidden;
      if (live && !hidden) {
        const pose = this.game.physics.getInterpolatedTransform(live, alpha);
        root.position.set(pose.translation.x, pose.translation.y, pose.translation.z);
        root.quaternion.set(pose.rotation.x, pose.rotation.y, pose.rotation.z, pose.rotation.w);
      }
    }
    const changed = this.changedPropMeshes;
    changed.clear();
    for (const visual of this.propVisuals) {
      const { mesh, index, prop } = visual;
      const body = this.game.colliders.bodies.get(prop.id);
      const live = body && this.game.physics.raw.getRigidBody(body.handle);
      const hidden = !live || this.game.destroyedProps.has(prop.id);
      if (hidden && visual.wasHidden) continue;
      if (!hidden && live?.isSleeping() && visual.wasSleeping && !visual.wasHidden) continue;
      visual.wasHidden = hidden;
      visual.wasSleeping = !!live?.isSleeping();
      if (live && !hidden) {
        const pose = this.game.physics.getInterpolatedTransform(live, alpha);
        this.dummy.position.set(pose.translation.x, pose.translation.y, pose.translation.z);
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
    for (const marker of this.game.surfaceMarkers) {
      if (marker.hasWorldArt) continue;
      const root = createSurfaceLibraryProp(this.propFactory, marker);
      root.position.copy(vec(marker.position));
      this.instancedProps.add(root);
    }
  }

  /** Factory signposts share geometry while their wayfinding overlays are separate. */
  private createBoardMarkers(): void {
    this.boardMarkers.name = 'gig-board-markers';
    this.scene.add(this.boardMarkers);
    for (const board of this.game.gigs.boards) {
      const root = createBoardLibraryProp(this.propFactory);
      const mountain = board.poiId === 'mt-gigga';
      const lighthouse = board.poiId === 'old-lighthouse';
      const compact = board.poiId === 'hoofington' || board.poiId === 'downtown-bleatsville' ||
        lighthouse || mountain;
      if (compact) {
        root.scale.multiplyScalar(.58);
        // The summit notice faces the last climb from Hoofington.
        root.rotation.y = mountain ? 2.67 : lighthouse ? Math.PI / 2 : -Math.PI / 2;
      }
      const base = mountain || lighthouse ? 0 : .15;
      root.position.set(board.position.x, board.position.y + base, board.position.z);
      this.instancedProps.add(root);
      this.boardRoots.push(root);
      if (compact && !mountain) continue;

      const overlay = new THREE.Group();
      overlay.position.copy(root.position);
      if (mountain) {
        overlay.add(this.textSprite('E · GIGS', 2.4, .64, 2.9));
      } else {
        overlay.add(this.textSprite('E · GIGS', 4.8, 1.2, 3.4));
        const ring = new THREE.Mesh(new THREE.RingGeometry(3.8, 4.25, 28),
          new THREE.MeshBasicMaterial({ color: 0xffd833, side: THREE.DoubleSide,
            transparent: true, opacity: .7 }));
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = .09;
        overlay.add(ring);
      }
      this.boardMarkers.add(overlay);
    }
  }

  private updateBoardMarkers(): void {
    const visible = this.game.party.match === null;
    if (this.boardMarkers.visible === visible) return;
    this.boardMarkers.visible = visible;
    for (const root of this.boardRoots) root.visible = visible;
  }

  private releaseLibraryProp(root: THREE.Group): void {
    this.instancedProps.remove(root);
    this.propFactory.release(root);
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
    this.textTextures.add(texture);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: texture, transparent: true, depthWrite: false,
    }));
    sprite.position.y = y; sprite.scale.set(width, height, 1);
    return sprite;
  }

  private clearGroup(group: THREE.Group): void {
    for (const child of [...group.children]) {
      child.traverse(object => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
          if (object instanceof THREE.InstancedMesh) object.dispose();
          object.geometry.dispose();
          if (Array.isArray(object.material)) object.material.forEach(m => m.dispose());
          else object.material.dispose();
        } else if (object instanceof THREE.Sprite) {
          const map = object.material.map;
          if (map) { map.dispose(); this.textTextures.delete(map); }
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
      this.hayHaulPickup = this.hayHaulDelivery = null;
      this.mowDown = null;
      for (const root of this.gigProps.values()) this.releaseLibraryProp(root);
      this.gigProps.clear();
      if (run?.status === 'running') {
        const config = run.setup.config;
        if (config.kind === 'hay-haul') {
          const pickup = this.textSprite('PICK UP BALE', 2.6, .65, 0);
          this.hayHaulPickup = pickup;
          this.gigMarkers.add(pickup);
          const delivery = new THREE.Group();
          const radius = config.radius * .65;
          const ring = new THREE.Mesh(new THREE.RingGeometry(radius, radius + .24, 40),
            new THREE.MeshBasicMaterial({ color: 0x88ffcb, side: THREE.DoubleSide,
              transparent: true, opacity: .7, depthWrite: false }));
          ring.rotation.x = -Math.PI / 2;
          ring.position.y = -.85;
          delivery.add(ring, this.textSprite('BARN DROP', 3.2, .8, 2.25));
          this.hayHaulDelivery = delivery;
          this.gigMarkers.add(delivery);
        } else if (config.kind === 'mow-down') {
          this.mowDown = new MowDownPresentation(this.game.island, config.patches,
            this.textSprite('G / X GRAZE', .24, .06, 0));
          this.gigMarkers.add(this.mowDown);
        }
        const customMarkers = config.kind === 'hay-haul' || config.kind === 'mow-down';
        for (const marker of customMarkers ? [] : run.setup.markers) {
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
          const root = createSpawnLibraryProp(this.propFactory, spawn);
          this.instancedProps.add(root);
          this.gigProps.set(spawn.id, root);
        }
      }
    }
    if (run?.objective.kind === 'summit') {
      const markers = this.gigMarkers.children;
      const next = Math.min(run.objective.reached, markers.length - 1);
      for (const [index, marker] of markers.entries()) marker.visible = index === next;
    }
    this.hayHaul = hayHaulGuidance(this.game, run, this.input.device);
    if (this.hayHaulPickup) {
      this.hayHaulPickup.visible = this.hayHaul?.kind === 'pickup';
      if (this.hayHaul?.kind === 'pickup') {
        const { x, y, z } = this.hayHaul.position;
        this.hayHaulPickup.position.set(x, y + 1.25, z);
      }
    }
    if (this.hayHaulDelivery) {
      this.hayHaulDelivery.visible = this.hayHaul?.kind === 'delivery';
      if (this.hayHaul?.kind === 'delivery') {
        const { x, y, z } = this.hayHaul.position;
        this.hayHaulDelivery.position.set(x, y, z);
      }
    }
    if (this.mowDown && run?.status === 'running') {
      this.mowDown.update(run.finishedIds, this.game.goat.torso.translation());
    }
    for (const [id, root] of this.gigProps) {
      const prop = this.game.gigs.props.get(id);
      if (!prop) { root.visible = false; continue; }
      root.visible = !prop.broken;
      const pose = this.game.physics.getInterpolatedTransform(prop.body, alpha);
      root.position.set(pose.translation.x, pose.translation.y, pose.translation.z);
      root.quaternion.set(pose.rotation.x, pose.rotation.y, pose.rotation.z, pose.rotation.w);
    }
    for (const group of this.gigMarkers.children) {
      if (group === this.mowDown) continue;
      const ring = group.children[0];
      if (ring instanceof THREE.Mesh && ring.material instanceof THREE.MeshBasicMaterial) {
        ring.material.opacity = .6 + .22 * Math.sin(this.game.physics.time * 3);
      }
    }
  }

  private partyGroundRing(center: Vec3, radius: number, color: number): THREE.Mesh {
    const geometry = new THREE.RingGeometry(radius - .32, radius, 80).rotateX(-Math.PI / 2);
    const positions = geometry.attributes['position']!;
    const { terrain, paths } = this.game.colliders;
    const surfaceHandles = new Set([terrain.handle, ...paths.map(path => path.handle)]);
    for (let index = 0; index < positions.count; index++) {
      const x = center.x + positions.getX(index), z = center.z + positions.getZ(index);
      const ground = this.game.physics.raycast({ x, y: center.y + 18, z }, { x: 0, y: -1, z: 0 }, 42,
        { predicate: collider => surfaceHandles.has(collider.handle) });
      const y = ground?.point.y ?? heightAt(this.game.island, x, z);
      positions.setY(index, y - center.y + .065);
    }
    geometry.computeBoundingSphere();
    return new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide,
      transparent: true, opacity: .87, depthWrite: false }));
  }

  private heistGoalSign(teamId: string, color: number): THREE.Group {
    const sign = new THREE.Group();
    sign.name = 'hay-heist-goal-' + teamId;
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 64;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = teamId === 'red' ? '#86213c' : '#144e78';
      ctx.fillRect(0, 0, 256, 64);
      ctx.strokeStyle = '#' + color.toString(16);
      ctx.lineWidth = 5;
      ctx.strokeRect(3, 3, 250, 58);
      ctx.fillStyle = '#fff5db';
      ctx.font = '900 30px system-ui';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(teamId.toUpperCase() + ' GOAL', 128, 33);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const lettering = new THREE.MeshBasicMaterial({ map: texture });
    const frame = new THREE.MeshToonMaterial({ color: 0x514750 });
    const panel = new THREE.Mesh(new THREE.BoxGeometry(2.18, .52, .13),
      [frame, frame, frame, frame, lettering, lettering]);
    panel.geometry.addEventListener('dispose', () => texture.dispose());
    panel.position.y = .48;
    sign.add(panel);
    for (const x of [-.79, .79]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(.13, .45, .30), frame);
      leg.position.set(x, .21, 0);
      sign.add(leg);
    }
    return sign;
  }

  private updatePartyVisuals(alpha: number): void {
    const roster = this.game.party.bots;
    const match = this.game.party.match;
    const mode = match ? match.mode : null;
    if (this.displayedMode !== mode) {
      for (const root of this.heistBales.values()) this.releaseLibraryProp(root);
      this.heistBales.clear(); this.displayedMode = mode;
      this.clearGroup(this.partyMarkers);
      if (match?.mode === 'king-of-the-peak') {
        const summit = match.view().arena.summit;
        const radius = match.view().config.peakRadius;
        const zone = new THREE.Group();
        zone.position.copy(vec(summit));
        zone.add(this.partyGroundRing(summit, radius, 0xffd833));
        zone.add(this.partyGroundRing(summit, 1.05 * this.game.island.size / 600, 0xffedaa));
        this.partyMarkers.add(zone);
      } else if (match?.mode === 'hay-heist') {
        const barns = match.view().arena.barns;
        for (const barn of barns) {
          const zone = new THREE.Group();
          zone.position.copy(vec(barn.position));
          const color = barn.teamId === 'red' ? 0xff7890 : 0x68cdff;
          zone.add(this.partyGroundRing(barn.position, barn.radius, color));
          const rival = barns.find(other => other !== barn)!;
          const inbound = new THREE.Vector2(rival.position.x - barn.position.x,
            rival.position.z - barn.position.z).normalize();
          // Both signs sit outside the haul lane, across from the player's start.
          const side = barn.teamId === 'red' ? -.54 : .54;
          const sideX = barn.radius * (-.80 * inbound.x + side * inbound.y);
          const sideZ = barn.radius * (-.80 * inbound.y - side * inbound.x);
          const y = heightAt(this.game.island, barn.position.x + sideX, barn.position.z + sideZ);
          const sign = this.heistGoalSign(barn.teamId, color);
          sign.position.set(sideX, y - barn.position.y, sideZ);
          sign.rotation.y = Math.atan2(inbound.x, inbound.y);
          sign.scale.setScalar(this.game.island.size / 600);
          zone.add(sign);
          this.partyMarkers.add(zone);
        }
      }
    }
    if (match?.mode === 'king-of-the-peak') {
      const zone = this.partyMarkers.children[0]?.children[0];
      if (zone instanceof THREE.Mesh && zone.material instanceof THREE.MeshBasicMaterial) {
        const peak = match.toJSON().peak;
        zone.material.color.setHex(peak?.contested ? 0xff7590 :
          peak?.ownerId === 'player' ? 0x79ffd1 : 0xffd833);
      }
    }
    if (match?.mode === 'hay-heist') {
      for (const bale of match.bales) {
        let root = this.heistBales.get(bale.id);
        if (!root) {
          root = createHeistHayLibraryProp(this.propFactory, bale.homeTeam);
          this.instancedProps.add(root);
          this.heistBales.set(bale.id, root);
        }
        const carrier = bale.carrierId === 'player' ? this.game.goat :
          roster.get(bale.carrierId ?? '')?.goat;
        const point = carrier
          ? this.game.physics.getInterpolatedTransform(carrier.torso, alpha).translation : bale.position;
        const y = carrier ? point.y + 1 : heightAt(this.game.island, point.x, point.z) + HEIST_BALE_SIZE.y / 2;
        root.position.set(point.x, y, point.z);
        root.rotation.y = carrier ? -carrier.locomotion.heading : 0;
      }
    }
  }

  /** Settings now control the same render budgets, including draw distance. */
  applySettings(settings: GameSettings): void {
    this.currentSettings = { ...settings };
    this.input.sensitivity = settings.mouseSensitivity;
    this.input.invertY = settings.invertY;
    if (this.appliedGraphics === settings.graphics) return;
    this.appliedGraphics = settings.graphics;
    const preset = GRAPHICS_PRESETS[settings.graphics];
    const ratio = this.resolution.configure(settings.graphics, window.devicePixelRatio || 1);
    this.renderer.setPixelRatio(ratio);
    this.renderer.shadowMap.enabled = preset.shadowMapSize > 0;
    this.world.sun.castShadow = preset.shadowMapSize > 0;
    if (this.world.sun.shadow.mapSize.x !== Math.max(1, preset.shadowMapSize)) {
      this.world.sun.shadow.map?.dispose();
      this.world.sun.shadow.map = null;
      this.world.sun.shadow.mapSize.set(Math.max(1, preset.shadowMapSize),
        Math.max(1, preset.shadowMapSize));
    }
    const camera = this.world.sun.shadow.camera;
    camera.left = camera.bottom = -Math.max(1, preset.shadowDistance);
    camera.right = camera.top = Math.max(1, preset.shadowDistance);
    camera.near = 1;
    camera.far = 260;
    camera.updateProjectionMatrix();
    // ~1.5 shadow texels of normal offset and a single-texel PCF filter:
    // no self-shadow acne on large flat walls, contact shadows stay attached.
    const texel = 2 * Math.max(1, preset.shadowDistance) / Math.max(1, preset.shadowMapSize);
    this.world.sun.shadow.normalBias = texel * 1.5;
    this.world.sun.shadow.bias = -0.0005;
    this.world.sun.shadow.radius = 1;
    if (this.scene.fog instanceof THREE.FogExp2) {
      this.scene.fog.density = settings.graphics === 'low' ? .0032 :
        settings.graphics === 'medium' ? .0023 : .0016;
    }
    this.shadowTimer = 1;
    this.renderer.shadowMap.needsUpdate = true;
    this.onResize();
  }

  /** Apply the quality draw distance to the world's existing terrain chunks. */
  private limitDrawDistance(): void {
    const range = GRAPHICS_PRESETS[this.currentSettings.graphics].drawDistance;
    const x = this.camera.position.x, z = this.camera.position.z;
    for (const chunk of this.world.chunks) {
      if (!chunk.visible) continue;
      const radius = chunk.geometry.boundingSphere?.radius ?? 25;
      const dx = chunk.position.x - x, dz = chunk.position.z - z;
      if (dx * dx + dz * dz > (range + radius) * (range + radius)) chunk.visible = false;
    }
  }

  /** Select only meshes whose world-space bounds overlap the shadow area.
   * Keep the existing caster cap and 10 Hz refresh budget. */
  private refreshShadowCasters(): void {
    const preset = GRAPHICS_PRESETS[this.currentSettings.graphics];
    const candidates: Array<{ mesh: THREE.Mesh; dist: number }> = [];
    const worldBounds = new THREE.Sphere();
    this.world.group.updateMatrixWorld(true);
    this.world.group.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      if (!this.shadowDefaults.has(object)) this.shadowDefaults.set(object, object.castShadow);
      const eligible = this.shadowDefaults.get(object);
      object.castShadow = false;
      if (!eligible || !object.visible || preset.maxShadowCasters === 0) return;
      if (object instanceof THREE.InstancedMesh) {
        if (object.count === 0) return;
        // Culling can change the active instance matrices between shadow updates.
        object.computeBoundingSphere();
      } else if (!object.geometry.boundingSphere) {
        object.geometry.computeBoundingSphere();
      }
      const bounds = object instanceof THREE.InstancedMesh
        ? object.boundingSphere : object.geometry.boundingSphere;
      if (!bounds) return;
      worldBounds.copy(bounds).applyMatrix4(object.matrixWorld);
      const dist = worldBounds.center.distanceTo(this.cameraTarget) - worldBounds.radius;
      if (dist <= preset.shadowDistance) candidates.push({ mesh: object, dist });
    });
    candidates.sort((a, b) => a.dist - b.dist);
    for (let i = 0; i < Math.min(candidates.length, preset.maxShadowCasters); i++) {
      candidates[i]!.mesh.castShadow = true;
    }
  }

  private updateBuildings(): void {
    const entries = this.game.rules.build.pieces;
    const active = this.activeBuildIds;
    active.clear();
    for (const piece of entries) active.add(piece.id);
    for (const [id, root] of this.buildVisuals) {
      if (!active.has(id)) {
        this.releaseLibraryProp(root);
        this.buildVisuals.delete(id);
      }
    }
    for (const piece of entries) {
      if (this.buildVisuals.has(piece.id)) continue;
      const body = this.game.buildBodies.get(piece.id);
      if (!body) continue;
      const root = createBuildLibraryProp(this.propFactory, piece.type);
      const p = body.translation();
      root.position.set(p.x, p.y, p.z);
      const q = body.rotation();
      root.quaternion.set(q.x, q.y, q.z, q.w);
      this.instancedProps.add(root);
      this.buildVisuals.set(piece.id, root);
    }
    const preview = this.paused ? null : this.game.buildPreview(this.input.yaw);
    this.buildGhost.update(preview);
    this.hud.setBuildPreview(preview?.validation ?? null, this.input.device);
  }

  private updateDebris(alpha: number): void {
    const handles = this.activeDebrisIds;
    handles.clear();
    for (const handle of this.game.breakables.debrisHandles) handles.add(handle);
    for (const handle of this.game.fallingPieces.keys()) handles.add(handle);
    for (const [handle, root] of this.debrisVisuals) if (!handles.has(handle) ||
      !this.game.physics.raw.getRigidBody(handle)) {
      this.releaseLibraryProp(root);
      this.debrisVisuals.delete(handle);
    }
    for (const handle of handles) {
      const body = this.game.physics.raw.getRigidBody(handle);
      if (!body) continue;
      let root = this.debrisVisuals.get(handle);
      if (!root) {
        const radius = Math.max(.12, Math.min(.65, Math.cbrt(body.mass()) * .24));
        root = createDebrisLibraryProp(this.propFactory, radius);
        this.instancedProps.add(root);
        this.debrisVisuals.set(handle, root);
      }
      const pose = this.game.physics.getInterpolatedTransform(body, alpha);
      root.position.set(pose.translation.x, pose.translation.y, pose.translation.z);
      root.quaternion.set(pose.rotation.x, pose.rotation.y, pose.rotation.z, pose.rotation.w);
    }
  }

  private cameraTravel(direction: THREE.Vector3, distance: number): number {
    const hit = this.game.physics.shapeCast(this.cameraTarget, this.cameraCollisionRotation,
      direction, this.cameraCollisionShape, distance, this.cameraCollisionFilter);
    return hit ? Math.max(0, hit.distance - CAMERA_COLLISION_SKIN) : distance;
  }

  private applyCameraFraming(lift: number): void {
    const { x: width, y: height } = this.cameraViewport;
    this.cameraShiftY = lift;
    this.camera.setViewOffset(width, height, 0, lift, width, height);
  }

  private desiredCameraFraming(): number {
    return goatCameraVerticalOffset(this.game.rules.style.scale, this.input.pitch,
      this.currentSettings.fov, this.cameraViewport.y, this.titleCamera);
  }

  private updateCameraFraming(dt: number): void {
    const delta = this.desiredCameraFraming() - this.cameraShiftY;
    if (Math.abs(delta) > .01) {
      this.applyCameraFraming(this.cameraShiftY + delta * lerpAlpha(8, dt));
    }
  }

  private updateHud(): void {
    this.hud.update(this.game, this.fps, this.simMs, this.input.debugVisible,
      document.pointerLockElement === this.renderer.domElement, this.perfStats, this.hayHaul,
      this.input.device, this.input.pointerLockUnavailable);
  }

  private updateCamera(alpha: number, dt: number): void {
    const pose = this.game.physics.getInterpolatedTransform(this.game.goat.torso, alpha);
    const size = this.game.rules.style.scale;
    const { yaw, pitch } = this.input;
    this.cameraAim.set(pose.translation.x, pose.translation.y + CAMERA_TARGET_HEIGHT * size,
      pose.translation.z);
    if (this.cameraTarget.distanceToSquared(this.cameraAim) > 16 * 16) {
      this.cameraTarget.copy(this.cameraAim);
      this.cameraDistance = Infinity;
    } else {
      this.cameraTarget.lerp(this.cameraAim, lerpAlpha(12, dt));
    }
    const offset = this.titleCamera ? goatCameraOffset(size, yaw, pitch) :
      goatOrbitOffset(size, yaw, pitch);
    this.cameraOffset.set(offset.x, offset.y, offset.z);
    const desiredDistance = this.cameraOffset.length();
    this.cameraDirection.copy(this.cameraOffset).normalize();
    // Follow position and obstruction recovery can ease independently of aim.
    // Keep the camera on the current boom so it shares the movement heading.
    const travel = this.cameraTravel(this.cameraDirection, desiredDistance);
    this.cameraDistance = travel <= this.cameraDistance ? travel :
      this.cameraDistance + (travel - this.cameraDistance) * lerpAlpha(9, dt);
    this.camera.position.copy(this.cameraTarget).addScaledVector(this.cameraDirection,
      this.cameraDistance);
    if (this.titleCamera) {
      const clearance = Math.max(0, Math.min(1,
        (this.cameraDistance - 1.1 * size) / Math.max(.01, desiredDistance - 1.1 * size)));
      const ahead = goatCameraLookAhead(size, yaw, clearance);
      this.cameraAim.copy(this.cameraTarget).add(this.cameraOffset.set(ahead.x, ahead.y, ahead.z));
      if (this.cameraDistance < .05) {
        this.cameraAim.addScaledVector(this.cameraDirection, -.05);
      }
    } else {
      const direction = goatViewDirection(yaw, pitch);
      this.cameraAim.copy(this.camera.position)
        .add(this.cameraOffset.set(direction.x, direction.y, direction.z));
    }
    this.camera.lookAt(this.cameraAim);

    const velocity = this.game.goat.torso.linvel();
    const speed = Math.hypot(velocity.x, velocity.z);
    const kick = this.game.goat.locomotion.input.sprint ?
      7 : Math.min(14, Math.max(0, speed - 8) * 1.4);
    const fov = this.currentSettings.fov + kick;
    const nextFov = this.camera.fov + (fov - this.camera.fov) * lerpAlpha(5, dt);
    if (Math.abs(this.camera.fov - nextFov) > .001) {
      this.camera.fov = nextFov;
      this.camera.updateProjectionMatrix();
    }
    const goat = this.characters.player.root;
    // In a tight squeeze the camera may enter the goat's body. Keep the route visible
    // until there is room for the full model again.
    goat.visible = this.cameraDistance > (goat.visible ? .85 : 1) * size;
    this.world.sun.position.set(this.cameraTarget.x + 70, this.cameraTarget.y + 125,
      this.cameraTarget.z - 65);
    this.world.sun.target.position.copy(this.cameraTarget);
    this.world.sun.target.updateMatrixWorld();
  }

  private frame(timestamp: number): void {
    if (this.disposed) return;
    const dt = this.lastTimestamp ?
      Math.min(.07, Math.max(0, (timestamp - this.lastTimestamp) / 1000)) : 1 / 60;
    this.lastTimestamp = timestamp;
    if (dt > 0) {
      const smoothing = lerpAlpha(2.6, dt);
      this.fps += ((1 / dt) - this.fps) * smoothing;
      this.frameMs += (dt * 1000 - this.frameMs) * smoothing;
    }
    let alpha = this.game.physics.alpha;
    if (!this.paused) {
      let intent = this.input.sample(dt, this.game.buildMode);
      if (intent.interact && this.onInteract?.()) {
        intent = { ...intent, interact: false, bleat: false };
      }
      if (!this.paused) {
        this.audio?.onInput(intent);
        const start = performance.now();
        const result = this.game.advance(dt, intent);
        alpha = result.alpha;
        this.simMs += (performance.now() - start - this.simMs) * lerpAlpha(5, dt);
      }
    }
    const range = GRAPHICS_PRESETS[this.currentSettings.graphics].drawDistance;
    this.characters.update(dt, alpha, this.camera, range);
    this.vfx.frame(dt, this.camera, range);
    this.updatePartyVisuals(alpha);
    this.updateBoardMarkers();
    this.updateGigVisuals(alpha);
    this.updateProps(alpha);
    this.updateBuildings();
    this.updateDebris(alpha);
    const match = this.game.party.match;
    const showTideRoutes = match?.mode === 'rising-tide' && match.phase !== 'results';
    if (this.lastTide !== this.game.water.seaLevel || this.showingTideRoutes !== showTideRoutes) {
      this.lastTide = this.game.water.seaLevel;
      this.showingTideRoutes = showTideRoutes;
      this.world.setTideLevel(this.lastTide, showTideRoutes);
    }
    this.world.update(this.game.physics.time);
    const dayPhase = .5 + Math.sin(this.game.physics.time / 150) * .035;
    this.world.setDayNight(dayPhase);
    if (this.scene.fog) this.scene.fog.color.copy(this.world.fogColor);
    this.renderer.setClearColor(this.world.fogColor);
    this.updateCamera(alpha, dt);
    this.updateCameraFraming(dt);
    // Keep live HUD text and counters current without rebuilding them every frame.
    this.hudTimer += dt;
    if (this.hudTimer >= .05) {
      this.hudTimer = 0;
      this.updateHud();
    }
    this.world.updateCulling(this.camera);
    this.limitDrawDistance();
    this.instancedProps.update(this.camera, range);
    this.shadowTimer += dt;
    if (this.shadowTimer >= .1 && this.renderer.shadowMap.enabled) {
      this.shadowTimer = 0;
      this.refreshShadowCasters();
      this.renderer.shadowMap.needsUpdate = true;
    }
    this.camera.getWorldDirection(this.audioForward);
    this.audio?.frame(dt, this.audioPose, dayPhase < .25 || dayPhase > .75);
    const renderStart = performance.now();
    this.renderer.render(this.scene, this.camera);
    this.renderMs += (performance.now() - renderStart - this.renderMs) * lerpAlpha(5, dt);
    const info = this.renderer.info;
    this.perfStats.fps = this.fps;
    this.perfStats.frameMs = this.frameMs;
    this.perfStats.physicsMs = this.simMs;
    this.perfStats.renderMs = this.renderMs;
    this.perfStats.drawCalls = info.render.calls;
    this.perfStats.triangles = info.render.triangles;
    this.perfStats.textures = info.memory.textures;
    this.perfStats.pixelRatio = this.renderer.getPixelRatio();
    const nextRatio = this.resolution.sample(this.frameMs, this.renderMs, dt,
      !this.paused && !document.hidden);
    if (nextRatio !== null) {
      this.renderer.setPixelRatio(nextRatio);
      this.onResize();
    }
    this.onFrame?.();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.renderer.setAnimationLoop(null);
    window.removeEventListener('resize', this.onResize);
    this.input.dispose();
    this.hud.dispose();
    this.buildGhost.dispose();
    this.vfx.dispose();
    this.characters.dispose();
    this.clearGroup(this.boardMarkers);
    this.boardRoots.length = 0;
    this.clearGroup(this.gigMarkers);
    this.clearGroup(this.partyMarkers);
    this.gigProps.clear(); this.heistBales.clear();
    this.buildVisuals.clear(); this.debrisVisuals.clear();
    this.libraryWorldProps.length = 0;
    for (const texture of this.textTextures) texture.dispose();
    this.instancedProps.dispose();
    this.propFactory.dispose();
    this.world.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
