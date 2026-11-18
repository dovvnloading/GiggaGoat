import * as THREE from 'three';
import {
  createWorldScene, type PropDescriptor, type WorldScene,
} from '../world';
import { Q, RAPIER, type Vec3 } from '../physics';
import { SKY_HORIZON_COLOR } from '../world/visual-sky';
import { DEFAULT_SETTINGS, type GameSettings } from './Persistence';
import { AdaptiveResolution } from './AdaptiveResolution';
import { GRAPHICS_PRESETS, type GraphicsQuality } from './GraphicsQuality';
import type { GameAudio } from './GameAudio';
import { PropFactory, InstancedPropRenderer } from '../props';
import { Game } from './Game';
import { GameCharacters } from './GameCharacters';
import { GameVfx } from './GameVfx';
import { GameInput } from './GameInput';
import { CAMERA_TARGET_HEIGHT, SPAWN_CAMERA_PITCH, SPAWN_CAMERA_YAW_OFFSET,
  goatCameraLookAhead, goatCameraOffset, goatCameraVerticalOffset } from './GoatCamera';
import { GameHud, type FramePerformance } from './GameHud';
import { projectGoatScreenBox, visibleGoatBounds } from './HudOcclusion';
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
  private readonly boardMarkers = new THREE.Group();
  private readonly gigMarkers = new THREE.Group();
  private readonly partyMarkers = new THREE.Group();
  private readonly gigProps = new Map<string, THREE.Group>();
  private readonly heistBales = new Map<string, THREE.Group>();
  private readonly textTextures = new Set<THREE.Texture>();
  private displayedGig = -1;
  private displayedMode: string | null = null;
  private currentSettings: GameSettings = { ...DEFAULT_SETTINGS };
  paused = false;
  onFrame: (() => void) | null = null;
  onInteract: (() => boolean) | null = null;
  private readonly propFactory = new PropFactory();
  private readonly instancedProps = new InstancedPropRenderer(this.scene);
  private readonly propVisuals: PropVisual[] = [];
  private readonly libraryWorldProps: LibraryWorldVisual[] = [];
  private readonly suppressedWorldLabKinds = new Set<string>();
  private readonly buildVisuals = new Map<number, THREE.Group>();
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
  private readonly perfStats: FramePerformance = {
    fps: 60, frameMs: 16.67, renderMs: 0, physicsMs: 0,
    drawCalls: 0, triangles: 0, textures: 0, pixelRatio: 1,
  };
  private readonly cameraTarget = new THREE.Vector3();
  private readonly cameraPosition = new THREE.Vector3();
  private readonly cameraOffset = new THREE.Vector3();
  private readonly cameraDirection = new THREE.Vector3();
  private readonly cameraPath = new THREE.Vector3();
  private readonly cameraDesired = new THREE.Vector3();
  private readonly cameraAim = new THREE.Vector3();
  private readonly cameraCollisionShape = new RAPIER.Ball(.25);
  private readonly cameraCollisionRotation = Q();
  private readonly cameraCollisionFilter = {
    predicate: (collider: RAPIER.Collider) => !this.game.goat.ownsBody(collider.parent()),
  };
  private readonly audioForward = new THREE.Vector3();
  private readonly audioPose = {
    position: this.camera.position, forward: this.audioForward, up: { x: 0, y: 1, z: 0 },
  };
  private readonly playerWorldBox = new THREE.Box3();
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
    this.world = createWorldScene(game.island, { chunkSegments: 24, cullingDistance: 340 });
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
      -game.island.spawns[0]!.heading + SPAWN_CAMERA_YAW_OFFSET);
    this.input.pitch = SPAWN_CAMERA_PITCH;
    this.hud = new GameHud(host);
    this.characters = new GameCharacters(this.scene, game);
    this.vfx = new GameVfx(this.scene, game,
      this.characters.player.root, this.characters.player.mounts.neck);
    this.bindWorldProps();
    this.createSurfaceMarkers();
    this.createBoardMarkers();
    this.scene.add(this.gigMarkers);
    this.scene.add(this.partyMarkers);
    const p = vec(game.goat.torso.translation());
    const size = game.rules.style.scale;
    this.cameraTarget.copy(p).add(new THREE.Vector3(0, CAMERA_TARGET_HEIGHT * size, 0));
    // Match the opening pose to the follow-camera formula immediately, even
    // while the title menu pauses physics; no back-view camera fly-in.
    this.cameraPosition.copy(this.cameraTarget).add(vec(
      goatCameraOffset(size, this.input.yaw, this.input.pitch)));
    this.camera.position.copy(this.cameraPosition);
    this.camera.lookAt(this.cameraTarget.clone().add(vec(
      goatCameraLookAhead(size, this.input.yaw))));
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

  /** Keep only unsupported world batches on the procedural renderer.
   * Disabling layer 0 is permanent even when world.updateCulling toggles visible. */
  private bindWorldProps(): void {
    const batches = new Map<string, PropDescriptor[]>();
    for (const prop of this.game.island.props) {
      const list = batches.get(prop.kind) ?? [];
      list.push(prop);
      batches.set(prop.kind, list);
      const root = createWorldLibraryProp(this.propFactory, prop);
      if (!root) continue;
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
      if (WORLD_LIBRARY_KINDS.has(kind as PropDescriptor['kind'])) {
        object.layers.disable(0);
        return;
      }
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

  /** Loaded World Lab near/far draws arrive after bindWorldProps. Layer-mask
   * them once as well, so the dynamic per-prop roots never double-render. */
  private hideWorldLabLoadedProps(): void {
    for (const kind of WORLD_LIBRARY_KINDS) {
      if (this.suppressedWorldLabKinds.has(kind)) continue;
      const near = this.world.group.getObjectByName('render-near-' + kind);
      if (!(near instanceof THREE.InstancedMesh)) continue;
      near.layers.disable(0);
      const far = this.world.group.getObjectByName('render-far-' + kind);
      if (far instanceof THREE.InstancedMesh) far.layers.disable(0);
      this.suppressedWorldLabKinds.add(kind);
    }
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
      const root = createSurfaceLibraryProp(this.propFactory, marker);
      root.position.copy(vec(marker.position));
      this.instancedProps.add(root);
    }
  }

  /** Factory signposts share geometry; the original text/ring remain independent UI. */
  private createBoardMarkers(): void {
    this.scene.add(this.boardMarkers);
    for (const board of this.game.gigs.boards) {
      const root = createBoardLibraryProp(this.propFactory);
      root.position.set(board.position.x, board.position.y + .15, board.position.z);
      this.instancedProps.add(root);

      const overlay = new THREE.Group();
      overlay.position.copy(root.position);
      overlay.add(this.textSprite('E · GIGS', 4.8, 1.2, 3.4));
      const ring = new THREE.Mesh(new THREE.RingGeometry(3.8, 4.25, 28),
        new THREE.MeshBasicMaterial({ color: 0xffd833, side: THREE.DoubleSide,
          transparent: true, opacity: .7 }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = .09;
      overlay.add(ring);
      this.boardMarkers.add(overlay);
    }
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
        if (object instanceof THREE.Mesh) {
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
      for (const root of this.gigProps.values()) this.releaseLibraryProp(root);
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
          const root = createSpawnLibraryProp(this.propFactory, spawn);
          this.instancedProps.add(root);
          this.gigProps.set(spawn.id, root);
        }
      }
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
      const ring = group.children[0];
      if (ring instanceof THREE.Mesh && ring.material instanceof THREE.MeshBasicMaterial) {
        ring.material.opacity = .6 + .22 * Math.sin(this.game.physics.time * 3);
      }
    }
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
        const ring = new THREE.Mesh(new THREE.RingGeometry(radius - .35, radius, 64),
          new THREE.MeshBasicMaterial({ color: 0xffd833, side: THREE.DoubleSide,
            transparent: true, opacity: .8, depthWrite: false }));
        ring.rotation.x = -Math.PI / 2;
        zone.add(ring);
        zone.add(this.textSprite('HOLD THE PEAK!', 6, 1.3, 4));
        this.partyMarkers.add(zone);
      } else if (match?.mode === 'hay-heist') {
        for (const barn of match.view().arena.barns) {
          const zone = new THREE.Group();
          zone.position.copy(vec(barn.position));
          const color = barn.teamId === 'red' ? 0xff7890 : 0x68cdff;
          const ring = new THREE.Mesh(new THREE.RingGeometry(3.7, 4.2, 36),
            new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide,
              transparent: true, opacity: .8, depthWrite: false }));
          ring.rotation.x = -Math.PI / 2;
          zone.add(ring);
          zone.add(this.textSprite(barn.teamId.toUpperCase() + ' GOAL', 4.7, 1.1, 3.6));
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
        zone.material.opacity = .62 + .28 * Math.sin(this.game.physics.time * 3);
      }
    }
    if (match?.mode === 'hay-heist') {
      for (const bale of match.bales) {
        let root = this.heistBales.get(bale.id);
        if (!root) {
          root = createHeistHayLibraryProp(this.propFactory);
          this.instancedProps.add(root);
          this.heistBales.set(bale.id, root);
        }
        const carrier = bale.carrierId === 'player' ? this.game.goat :
          roster.get(bale.carrierId ?? '')?.goat;
        const point = carrier ? carrier.torso.translation() : bale.position;
        root.position.set(point.x, point.y + (carrier ? 1 : .25), point.z);
        root.rotation.y += .009;
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

  private updateCamera(alpha: number, dt: number): void {
    const pose = this.game.physics.getInterpolatedTransform(this.game.goat.torso, alpha);
    const size = this.game.rules.style.scale;
    this.cameraAim.set(pose.translation.x, pose.translation.y + CAMERA_TARGET_HEIGHT * size,
      pose.translation.z);
    this.cameraTarget.lerp(this.cameraAim, lerpAlpha(12, dt));
    const offset = goatCameraOffset(size, this.input.yaw, this.input.pitch);
    this.cameraOffset.set(offset.x, offset.y, offset.z);
    const desiredDistance = this.cameraOffset.length();
    this.cameraDirection.copy(this.cameraOffset).normalize();
    // Sweep the camera volume to catch corners that a centre ray misses.
    const travel = this.cameraTravel(this.cameraDirection, desiredDistance);
    this.cameraAim.copy(this.cameraTarget).addScaledVector(this.cameraDirection, travel);
    this.cameraPosition.lerp(this.cameraAim, lerpAlpha(9, dt));
    this.cameraPath.copy(this.cameraPosition).sub(this.cameraTarget);
    const pathLength = this.cameraPath.length();
    let actualDistance = pathLength;
    if (pathLength > .001) {
      this.cameraPath.divideScalar(pathLength);
      // Smoothing the orbit can cut a corner even when the desired pose is clear.
      actualDistance = this.cameraTravel(this.cameraPath, pathLength);
      this.cameraPosition.copy(this.cameraTarget).addScaledVector(this.cameraPath, actualDistance);
    }
    const velocity = this.game.goat.torso.linvel();
    const speed = Math.hypot(velocity.x, velocity.y, velocity.z);
    const kick = this.game.goat.locomotion.input.sprint ?
      7 : Math.min(14, Math.max(0, speed - 8) * 1.4);
    const fov = this.currentSettings.fov + kick;
    const nextFov = this.camera.fov + (fov - this.camera.fov) * lerpAlpha(5, dt);
    if (Math.abs(this.camera.fov - nextFov) > .001) {
      this.camera.fov = nextFov;
      this.camera.updateProjectionMatrix();
    }
    this.camera.position.copy(this.cameraPosition);
    const clearance = Math.max(0, Math.min(1,
      (actualDistance - 1.1 * size) /
      Math.max(.01, desiredDistance - 1.1 * size)));
    const ahead = goatCameraLookAhead(size, this.input.yaw, clearance);
    this.cameraAim.copy(this.cameraTarget).add(this.cameraOffset.set(ahead.x, ahead.y, ahead.z));
    if (actualDistance < .05) {
      this.cameraAim.addScaledVector(this.cameraDirection, -.05);
    }
    const goat = this.characters.player.root;
    // In a tight squeeze the camera may enter the goat's body. Keep the route visible
    // until there is room for the full model again.
    goat.visible = actualDistance > (goat.visible ? .85 : 1) * size;
    this.camera.lookAt(this.cameraAim);
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
    this.updateGigVisuals(alpha);
    this.updateProps(alpha);
    this.updateBuildings();
    this.updateDebris(alpha);
    if (this.lastTide !== this.game.water.seaLevel) {
      this.lastTide = this.game.water.seaLevel;
      this.world.setTideLevel(this.lastTide);
    }
    this.world.update(this.game.physics.time);
    const dayPhase = .5 + Math.sin(this.game.physics.time / 150) * .035;
    this.world.setDayNight(dayPhase);
    if (this.scene.fog) this.scene.fog.color.copy(this.world.fogColor);
    this.renderer.setClearColor(this.world.fogColor);
    this.updateCamera(alpha, dt);
    // Sampling ragdoll projections and reading DOM bounds at 60 Hz forced layout.
    // Resolving HUD and the safe-camera view offset at 20 Hz avoids that churn.
    this.hudTimer += dt;
    if (this.hudTimer >= .05) {
      this.hudTimer = 0;
      const viewport = this.renderer.domElement.getBoundingClientRect();
      const goatBounds = visibleGoatBounds(this.characters.player.root, this.playerWorldBox);
      this.camera.clearViewOffset();
      const unframed = projectGoatScreenBox(goatBounds, this.camera, viewport, false);
      const desired = unframed ? goatCameraVerticalOffset(unframed, viewport) : null;
      if (desired === null || !Number.isFinite(desired)) {
        this.cameraShiftY = 0;
      } else {
        const bounded = THREE.MathUtils.clamp(desired, -viewport.height, viewport.height);
        const previous = Number.isFinite(this.cameraShiftY) ? this.cameraShiftY : 0;
        this.cameraShiftY = Math.max(previous + (bounded - previous) * lerpAlpha(10, dt), bounded);
      }
      if (viewport.width > 0 && viewport.height > 0 && this.cameraShiftY !== 0) {
        this.camera.setViewOffset(viewport.width, viewport.height,
          0, this.cameraShiftY, viewport.width, viewport.height);
      }
      const goatScreenBox = projectGoatScreenBox(goatBounds, this.camera, viewport);
      this.hud.update(this.game, this.fps, this.simMs, this.input.debugVisible,
        document.pointerLockElement === this.renderer.domElement, goatScreenBox, this.perfStats);
    }
    this.world.updateCulling(this.camera);
    this.hideWorldLabLoadedProps();
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
    this.vfx.dispose();
    this.characters.dispose();
    this.clearGroup(this.boardMarkers);
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
