import * as THREE from 'three';
import {
  createRunningDustPuffs, createLandingImpactRing, createHeadbuttImpactStars,
  createWaterSplash, createCrateBreakDebris, createTrampolineBoing,
  createLaunchPadBurst, createComboPopText, createGiggaGrowthPurpleAura,
  createCoinPickupSparkle,
  type RunningDustPuffs, type LandingImpactRing, type HeadbuttImpactStars,
  type WaterSplash, type CrateBreakDebris, type TrampolineBoing,
  type LaunchPadBurst, type ComboPopText, type GiggaGrowthPurpleAura,
  type CoinPickupSparkle,
} from '../vfx';
import type { Game } from './Game';

/** Testable cosmetic sinks. The production factories allocate every bounded pool only once. */
export interface GameVfxEffects {
  dust: Pick<RunningDustPuffs, 'group' | 'emit' | 'update' | 'dispose'>;
  landing: Pick<LandingImpactRing, 'group' | 'emit' | 'update' | 'dispose'>;
  headbutt: Pick<HeadbuttImpactStars, 'group' | 'emit' | 'update' | 'dispose'>;
  water: Pick<WaterSplash, 'group' | 'emit' | 'update' | 'dispose'>;
  crate: Pick<CrateBreakDebris, 'group' | 'emit' | 'update' | 'dispose'>;
  trampoline: Pick<TrampolineBoing, 'group' | 'emit' | 'update' | 'dispose'>;
  launch: Pick<LaunchPadBurst, 'group' | 'emit' | 'update' | 'dispose'>;
  combo: Pick<ComboPopText, 'group' | 'emit' | 'update' | 'dispose'>;
  aura: Pick<GiggaGrowthPurpleAura, 'group' | 'attach' | 'setTier' | 'triggerGrow' | 'update' | 'dispose'>;
  coin: Pick<CoinPickupSparkle, 'group' | 'emit' | 'update' | 'dispose'>;
}

export function createGameVfxEffects(): GameVfxEffects {
  return {
    dust: createRunningDustPuffs({ seed: 42, capacity: 128 }),
    landing: createLandingImpactRing({ capacity: 8 }),
    headbutt: createHeadbuttImpactStars({ capacity: 8 }),
    water: createWaterSplash({ capacity: 8 }),
    crate: createCrateBreakDebris({ capacity: 6 }),
    trampoline: createTrampolineBoing({ capacity: 4 }),
    launch: createLaunchPadBurst({ capacity: 4 }),
    combo: createComboPopText({ capacity: 6 }),
    aura: createGiggaGrowthPurpleAura({ capacity: 3 }),
    coin: createCoinPickupSparkle({ capacity: 6 }),
  };
}

const TIER = { Kid: 0, Billy: 1, Big: 2, GIGGA: 3 } as const;
const HOOF_ORDER = ['frontLeft', 'backRight', 'frontRight', 'backLeft'] as const;

/**
 * Render-owned VFX bridge. Uses synchronous subscriptions, never drains the
 * physics/chaos event streams (GameAudio owns those drains). The only fixed-tick
 * hook samples the real galloping gait for hoof touchdowns; no physics is driven
 * by effects and the render loop updates each preallocated pool exactly once.
 */
export class GameVfx {
  private readonly off: Array<() => void> = [];
  private readonly hoofAnchor = new THREE.Group();
  private readonly surfaces: Map<string, Game['surfaceMarkers'][number]>;
  private readonly pools: Array<Pick<RunningDustPuffs, 'group' | 'update' | 'dispose'>>;
  private readonly lastSurfaceUse = new Map<string, number>();
  private lastHoofBeat: number;
  private comboStage: number;
  private disposed = false;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly game: Game,
    goatRoot: THREE.Object3D,
    private readonly coinTarget: THREE.Object3D,
    readonly effects: GameVfxEffects = createGameVfxEffects(),
  ) {
    this.surfaces = new Map(game.surfaceMarkers.map(surface => [surface.id, surface]));
    this.pools = [
      effects.dust, effects.landing, effects.headbutt, effects.water,
      effects.crate, effects.trampoline, effects.launch, effects.combo,
      effects.aura, effects.coin,
    ];
    this.lastHoofBeat = Math.floor(game.goat.phase / (Math.PI / 2));
    this.comboStage = Math.min(4, game.rules.style.combo.count);
    for (const effect of this.pools) if (effect !== effects.aura) scene.add(effect.group);
    this.hoofAnchor.name = 'goat hoof-level growth aura anchor';
    goatRoot.add(this.hoofAnchor); // character root is unscaled and world-aligned
    effects.aura.attach(this.hoofAnchor);
    effects.aura.setTier(TIER[game.rules.style.tier]);

    this.off.push(game.physics.onAfterStep(() => this.footfall()));
    this.off.push(game.goat.events.on(event => {
      if (event.type !== 'landed') return;
      if (event.verticalSpeed < 4.5 && event.airtime < .65) return;
      const ground = game.goat.locomotion.groundHit?.point;
      const torso = game.goat.torso.translation();
      const size = game.goat.size;
      effects.landing.emit({
        x: ground?.x ?? torso.x, y: ground?.y ?? torso.y - .92 * size,
        z: ground?.z ?? torso.z,
      }, Math.min(4, Math.max(.8, event.verticalSpeed / 5, event.airtime * 1.25)));
    }));
    this.off.push(game.onVfxCue(cue => {
      if (cue.type === 'headbutt-hit') {
        effects.headbutt.emit(cue.position, cue.direction, cue.power);
      } else if (cue.type === 'crate-break') {
        effects.crate.emit(cue.position, cue.direction, cue.size);
      }
    }));
    // WaterSystem publishes 'enter' and (for faster entries) 'splash' together.
    // Listen to only the entry so a fast entry never creates two VFX bursts.
    this.off.push(game.water.events.on(event => {
      if (event.type !== 'enter' || event.mass <= 0) return;
      const body = game.physics.raw.getRigidBody(event.bodyHandle);
      if (!body) return;
      const p = body.translation();
      const volume = event.volumeId === 'sea' ? undefined :
        game.water.listVolumes().find(item => item.id === event.volumeId);
      const surfaceY = volume
        ? volume.center.y + volume.halfExtents.y : game.water.seaLevel;
      effects.water.emit({ x: p.x, y: surfaceY, z: p.z },
        Math.max(.6, event.impactSpeed),
        Math.min(8, event.mass / Math.max(1, game.goat.mass)));
    }));
    this.off.push(game.surfaces.events.on(event => {
      if ((event.type !== 'bounce' && event.type !== 'launch') ||
          !game.goat.ownsBody(event.bodyHandle)) return;
      // A linked ragdoll has seven overlapping bodies, but a platform usage
      // is one visual action. Keep the surface's own cooldown semantics intact.
      const previous = this.lastSurfaceUse.get(event.surfaceId);
      if (previous !== undefined && event.time - previous <
          (event.type === 'bounce' ? .45 : .8)) return;
      const marker = this.surfaces.get(event.surfaceId);
      if (event.type === 'bounce') {
        if (marker?.kind !== 'trampoline') return;
        this.lastSurfaceUse.set(event.surfaceId, event.time);
        effects.trampoline.emit({
          x: marker.position.x,
          y: marker.position.y - marker.halfExtents.y,
          z: marker.position.z,
        }, marker.halfExtents.x / 2.1, Math.min(4, event.speed / 8));
      } else {
        // Hay-Build launch pads are created dynamically, unlike island markers.
        const built = event.surfaceId.startsWith('hay-')
          ? game.buildBodies.get(Number(event.surfaceId.slice(4))) : undefined;
        if (!marker && !built) return;
        this.lastSurfaceUse.set(event.surfaceId, event.time);
        if (this.lastSurfaceUse.size > 64) this.lastSurfaceUse.clear();
        const p = marker?.position ?? built!.translation();
        effects.launch.emit({
          x: p.x, y: marker ? p.y - marker.halfExtents.y : p.y + .14, z: p.z,
        }, marker?.direction ?? { x: 0, y: 0, z: -1 },
        Math.min(4, event.speed / 10));
      }
    }));
    this.off.push(game.rules.events.on('style:scored', event => {
      const stage = Math.min(event.comboCount, 4);
      if (stage < 2) { this.comboStage = 0; return; }
      if (stage <= this.comboStage) return; // no repeated x4+ pops at x5, x6...
      this.comboStage = stage;
      const p = game.goat.torso.translation();
      effects.combo.emit({ x: p.x, y: p.y + 1.7 * game.goat.size, z: p.z },
        event.comboCount);
    }));
    this.off.push(game.rules.events.on('combo:ended', () => { this.comboStage = 0; }));
    this.off.push(game.rules.events.on('size:changed', event => {
      const from = TIER[event.from], to = TIER[event.to];
      if (to > from) effects.aura.triggerGrow(to);
      else effects.aura.setTier(to); // dropping from GIGGA clears the hold
    }));
    this.off.push(game.rules.events.on('coins:changed', event => {
      if (event.after <= event.before) return; // spending isn't a pickup
      const p = game.goat.torso.translation(), size = game.goat.size;
      effects.coin.emit({
        x: p.x + 1.1 * size, y: p.y + .45 * size, z: p.z + .35 * size,
      }, this.coinTarget);
    }));
  }

  /** A footfall every quarter gait cycle (~7.6/s while sprinting at 60 Hz). */
  private footfall(): void {
    const goat = this.game.goat;
    const beat = Math.floor(goat.phase / (Math.PI / 2));
    if (goat.pose === 'gallop' && goat.locomotion.grounded &&
        goat.locomotion.input.sprint && beat > this.lastHoofBeat) {
      const velocity = goat.torso.linvel();
      const ground = goat.locomotion.groundHit;
      if (ground && ground.normal.y > .55 && Math.hypot(velocity.x, velocity.z) > 3) {
        // Cap catch-up work even after a teleport or unusual gait discontinuity.
        for (let i = Math.max(this.lastHoofBeat + 1, beat - 1); i <= beat; i++) {
          const part = HOOF_ORDER[((i % 4) + 4) % 4]!;
          const hoof = goat.getPart(part).translation();
          this.effects.dust.emit({ x: hoof.x, y: ground.point.y + .025, z: hoof.z },
            { x: velocity.x, y: 0, z: velocity.z });
        }
      }
    }
    this.lastHoofBeat = beat;
  }

  /** Called once after the character's interpolation, on every render frame. */
  frame(dt: number): void {
    if (this.disposed) return;
    const goat = this.game.goat;
    const p = goat.torso.translation();
    this.hoofAnchor.position.set(p.x, p.y - .92 * goat.size, p.z);
    for (const effect of this.pools) effect.update(dt);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const off of this.off.splice(0)) off();
    for (const effect of this.pools) {
      effect.dispose();
      effect.group.removeFromParent();
    }
    this.hoofAnchor.removeFromParent();
    this.lastSurfaceUse.clear();
  }
}
