import * as THREE from 'three';
import {
  createWorldScene, type PropDescriptor, type WorldScene,
} from '../world';
import { V, type Vec3 } from '../physics';
import { DEFAULT_SETTINGS, type GameSettings } from './Persistence';
import { AdaptiveResolution } from './AdaptiveResolution';
import { GRAPHICS_PRESETS, type GraphicsQuality } from './GraphicsQuality';
import type { GameAudio } from './GameAudio';
import { type BuildPiece, type PieceType } from '../gameplay';
import { Game } from './Game';
import { GameCharacters } from './GameCharacters';
import { GameVfx } from './GameVfx';
import { GameInput } from './GameInput';
import { CAMERA_TARGET_HEIGHT, SPAWN_CAMERA_PITCH, SPAWN_CAMERA_YAW_OFFSET,
  goatCameraLookAhead, goatCameraOffset, goatCameraVerticalOffset } from './GoatCamera';
import { GameHud, type FramePerformance } from './GameHud';
import { projectGoatScreenBox, visibleGoatBounds } from './HudOcclusion';

interface PropVisual {
  mesh: THREE.InstancedMesh;
  index: number;
  prop: PropDescriptor;
  wasSleeping?: boolean;
  wasHidden?: boolean;
}
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
  readonly characters: GameCharacters;
  readonly vfx: GameVfx;
  private readonly boardMarkers = new THREE.Group();
  private readonly gigMarkers = new THREE.Group();
  private readonly partyMarkers = new THREE.Group();
  private readonly gigProps = new Map<string, THREE.Mesh>();
  private readonly heistBales = new Map<string, THREE.Mesh>();
  private readonly textTextures = new Set<THREE.Texture>();
  private displayedGig = -1;
  private displayedMode: string | null = null;
  private currentSettings: GameSettings = { ...DEFAULT_SETTINGS };
  paused = false;
  onFrame: (() => void) | null = null;
  onInteract: (() => boolean) | null = null;
  private readonly propVisuals: PropVisual[] = [];
  private readonly buildVisuals = new Map<number, THREE.Mesh>();
  private readonly debrisVisuals = new Map<number, THREE.Mesh>();
  private readonly markers = new THREE.Group();
  private readonly debrisGeometry = new THREE.BoxGeometry(1, 1, 1);
  private readonly debrisMaterial = new THREE.MeshToonMaterial({ color: 0xd6b36f });
  private readonly buildGeometries = new Map<PieceType, THREE.BufferGeometry>();
  private readonly buildMaterials = new Map<PieceType, THREE.MeshToonMaterial>();
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
    this.scene.fog = new THREE.FogExp2(0xb8deef, .0016);
    this.world = createWorldScene(game.island, { chunkSegments: 24, cullingDistance: 340 });
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

  private mesh(parent: THREE.Object3D, geometry: THREE.BufferGeometry,
    material: THREE.Material, p = new THREE.Vector3()): THREE.Mesh {
    const item = new THREE.Mesh(geometry, material);
    item.position.copy(p);
    item.castShadow = true;
    item.receiveShadow = true;
    parent.add(item);
    return item;
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
      // Keep the world lane's precomputed batch bounds and frustum rejection.
      object.frustumCulled = true;
    });
  }

  private updateProps(alpha: number): void {
    const changed = this.changedPropMeshes;
    changed.clear();
    for (const visual of this.propVisuals) {
      const { mesh, index, prop } = visual;
      const body = this.game.colliders.bodies.get(prop.id);
      const live = body && this.game.physics.raw.getRigidBody(body.handle);
      const hidden = !live || this.game.destroyedProps.has(prop.id);
      if (hidden && visual.wasHidden) continue;
      // Rapier sleepers do not need an interpolated transform or GPU upload.
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
    const match = this.game.party.match;
    const mode = match ? match.mode : null;
    if (this.displayedMode !== mode) {
      for (const mesh of this.heistBales.values()) {
        mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose();
        mesh.removeFromParent();
      }
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

  /** No global instanced foliage or huge landmark submissions in the shadow pass.
   * Select a handful of nearby eligible meshes on a 10 Hz budget. */
  private refreshShadowCasters(): void {
    const preset = GRAPHICS_PRESETS[this.currentSettings.graphics];
    const candidates: Array<{ mesh: THREE.Mesh; dist: number }> = [];
    this.world.group.updateMatrixWorld(true);
    this.world.group.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      if (!this.shadowDefaults.has(object)) this.shadowDefaults.set(object, object.castShadow);
      const eligible = this.shadowDefaults.get(object);
      object.castShadow = false;
      if (!eligible || object instanceof THREE.InstancedMesh || !object.visible ||
          preset.maxShadowCasters === 0) return;
      object.getWorldPosition(this.cameraDesired);
      const dist = this.cameraDesired.distanceToSquared(this.cameraTarget);
      if (dist < preset.shadowDistance * preset.shadowDistance) {
        candidates.push({ mesh: object, dist });
      }
    });
    candidates.sort((a, b) => a.dist - b.dist);
    for (let i = 0; i < Math.min(candidates.length, preset.maxShadowCasters); i++) {
      candidates[i]!.mesh.castShadow = true;
    }
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
    const active = this.activeBuildIds;
    active.clear();
    for (const piece of entries) active.add(piece.id);
    for (const [id, mesh] of this.buildVisuals) {
      if (!active.has(id)) {
        this.scene.remove(mesh);
        // Shared geometries/materials remain cached for the next build.
        this.buildVisuals.delete(id);
      }
    }
    for (const piece of entries) {
      if (this.buildVisuals.has(piece.id)) continue;
      const body = this.game.buildBodies.get(piece.id);
      if (!body) continue;
      let geometry = this.buildGeometries.get(piece.type);
      if (!geometry) { geometry = this.buildGeometry(piece); this.buildGeometries.set(piece.type, geometry); }
      let material = this.buildMaterials.get(piece.type);
      if (!material) {
        material = new THREE.MeshToonMaterial({ color: MATERIALS[piece.type], side: THREE.DoubleSide });
        this.buildMaterials.set(piece.type, material);
      }
      const mesh = new THREE.Mesh(geometry, material);
      const p = body.translation();
      mesh.position.set(p.x, p.y, p.z);
      const q = body.rotation();
      mesh.quaternion.set(q.x, q.y, q.z, q.w);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.scene.add(mesh);
      this.buildVisuals.set(piece.id, mesh);
    }
  }

  private updateDebris(alpha: number): void {
    const handles = this.activeDebrisIds;
    handles.clear();
    for (const handle of this.game.breakables.debrisHandles) handles.add(handle);
    for (const handle of this.game.fallingPieces.keys()) handles.add(handle);
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
      mesh.position.set(pose.translation.x, pose.translation.y, pose.translation.z);
      mesh.quaternion.set(pose.rotation.x, pose.rotation.y, pose.rotation.z, pose.rotation.w);
    }
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
    const direction = this.cameraDirection;
    const hit = this.game.physics.raycast(this.cameraTarget, V(direction.x, direction.y, direction.z),
      desiredDistance, { predicate: collider => !this.game.goat.ownsBody(collider.parent()) });
    let safe = hit ? Math.max(1.1 * size, Math.min(desiredDistance, hit.distance - .36 * size)) :
      desiredDistance;
    this.cameraAim.copy(this.cameraTarget).addScaledVector(direction, safe);
    this.cameraPosition.lerp(this.cameraAim, lerpAlpha(9, dt));
    this.cameraPath.copy(this.cameraPosition).sub(this.cameraTarget);
    const pathLength = this.cameraPath.length();
    if (pathLength > .01) {
      const immediate = this.game.physics.raycast(this.cameraTarget,
        V(this.cameraPath.x / pathLength, this.cameraPath.y / pathLength,
          this.cameraPath.z / pathLength),
        pathLength, { predicate: collider => !this.game.goat.ownsBody(collider.parent()) });
      if (immediate) {
        safe = Math.max(.6, immediate.distance - .24 * size);
        this.cameraPosition.copy(this.cameraTarget).addScaledVector(this.cameraPath.normalize(), safe);
      }
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
      (this.cameraPosition.distanceTo(this.cameraTarget) - 1.1 * size) /
      Math.max(.01, desiredDistance - 1.1 * size)));
    const ahead = goatCameraLookAhead(size, this.input.yaw, clearance);
    this.cameraAim.copy(this.cameraTarget).add(this.cameraOffset.set(ahead.x, ahead.y, ahead.z));
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
      if (unframed && viewport.width > 0 && viewport.height > 0) {
        const desired = goatCameraVerticalOffset(unframed, viewport);
        this.cameraShiftY += (desired - this.cameraShiftY) * lerpAlpha(10, dt);
        this.cameraShiftY = Math.max(this.cameraShiftY, desired);
      }
      if (viewport.width > 0 && viewport.height > 0) {
        this.camera.setViewOffset(viewport.width, viewport.height,
          0, this.cameraShiftY, viewport.width, viewport.height);
      }
      const goatScreenBox = projectGoatScreenBox(goatBounds, this.camera, viewport);
      this.hud.update(this.game, this.fps, this.simMs, this.input.debugVisible,
        document.pointerLockElement === this.renderer.domElement, goatScreenBox, this.perfStats);
    }
    this.world.updateCulling(this.camera);
    this.limitDrawDistance();
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
    for (const mesh of this.gigProps.values()) {
      mesh.removeFromParent(); mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose();
    }
    for (const mesh of this.heistBales.values()) {
      mesh.removeFromParent(); mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose();
    }
    this.gigProps.clear(); this.heistBales.clear();
    for (const texture of this.textTextures) texture.dispose();
    for (const mesh of this.buildVisuals.values()) mesh.removeFromParent();
    this.buildVisuals.clear();
    for (const geometry of this.buildGeometries.values()) geometry.dispose();
    for (const material of this.buildMaterials.values()) material.dispose();
    this.buildGeometries.clear();
    this.buildMaterials.clear();
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
