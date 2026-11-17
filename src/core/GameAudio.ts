import { GAMEPLAY_EVENT_TYPES } from '../audio';
import type {
  AudioCue, AudioEngine, CameraAudioPose, GameplayAudioEvent, Surface, WalkingGoat,
} from '../audio';
import { biomeAt, zoneAt } from '../world';
import type { GoatRagdoll, Vec3 } from '../physics';
import type { Game, PlayerIntent } from './Game';
import type { GameSettings } from './Persistence';

/** The narrow audio interface allows a fake AudioEngine in headless core tests. */
export type AudioSink = Pick<AudioEngine, 'updateFrame' | 'setSettings' | 'audioContext'>;

function surfaceAt(game: Game, position: Vec3): Surface {
  if (position.y <= game.water.seaLevel + .25) return 'water';
  const biome = biomeAt(game.island, position.x, position.z);
  if (biome === 'ocean' || biome === 'freshwater') return 'water';
  if (biome === 'beach') return 'sand';
  if (zoneAt(game.island, position.x, position.z) === 'baa-ardwalk') return 'wood';
  if (biome === 'industrial') return 'metal';
  if (biome === 'cliff' || biome === 'highlands' || biome === 'town') return 'rock';
  return 'grass';
}

function observeGoat(game: Game, goat: GoatRagdoll): WalkingGoat {
  const position = { ...goat.torso.translation() };
  const velocity = goat.torso.linvel();
  return {
    id: goat.id, position, size: goat.size,
    speed: Math.hypot(velocity.x, velocity.z),
    grounded: goat.locomotion.grounded,
    surface: surfaceAt(game, position),
  };
}

/**
 * Render-only audio adapter. Each lane's drain is owned here and called exactly
 * once per frame, after all completed fixed substeps. Never steps simulation.
 */
export class GameAudio {
  private readonly gameplay: GameplayAudioEvent[] = [];
  private readonly cues: AudioCue[] = [];
  private readonly off: Array<() => void> = [];
  private charging = false;
  private paused = true;
  private wasUnlocked = false;
  private transition: Promise<void> | null = null;

  constructor(private readonly game: Game, private readonly audio: AudioSink) {
    for (const type of GAMEPLAY_EVENT_TYPES) {
      this.off.push(game.rules.events.on(type, data => {
        this.gameplay.push({ type, data } as GameplayAudioEvent);
      }));
    }
  }

  setVolumes(settings: GameSettings): void {
    this.audio.setSettings({
      master: settings.volume, music: settings.musicVolume, sfx: settings.effectsVolume,
    });
  }

  queueCue(cue: AudioCue): void { this.cues.push(cue); }

  /** Charge start is an input-only edge; gameplay's release is still authoritative. */
  onInput(intent: PlayerIntent): void {
    const charging = !!intent.chargeHeadbutt;
    if (charging && !this.charging) this.queueCue({ sound: 'headbutt-charge', intensity: .35 });
    this.charging = charging;
  }

  /** Pause the actual AudioContext, not just the game rules or music scheduler. */
  setPaused(paused: boolean): void {
    this.paused = paused;
    if (paused) this.charging = false;
    this.syncContext();
  }

  private syncContext(): void {
    const context = this.audio.audioContext;
    if (!context || this.transition) return;
    if (context.state === 'running') this.wasUnlocked = true;
    const suspending = this.paused && context.state === 'running';
    const resuming = !this.paused && this.wasUnlocked && context.state === 'suspended';
    if (!suspending && !resuming) return;
    const action = suspending ? context.suspend() : context.resume();
    this.transition = action.then(() => {
      this.transition = null;
      // A visibility/menu transition may have occurred during the async operation.
      if (this.paused !== suspending) this.syncContext();
    }, () => { this.transition = null; });
  }

  /** Called once by GameView on every rendered frame, even while menus are open. */
  frame(dt: number, camera: CameraAudioPose, night: boolean): void {
    // Catches an AudioContext first unlocked by a gesture while a menu is open.
    this.syncContext();
    const match = this.game.party.match;
    const goats = [
      observeGoat(this.game, this.game.goat),
      ...[...this.game.party.bots.values()].map(bot => observeGoat(this.game, bot.goat)),
    ];
    const positions = new Map(goats.map(goat => [goat.id, goat.position] as const));
    const sizes = new Map(goats.map(goat => [goat.id, goat.size] as const));
    const player = goats[0]!;
    const zone = zoneAt(this.game.island, player.position.x, player.position.z);
    const poi = zone ?? this.game.island.pois.find(site =>
      Math.hypot(site.center.x - player.position.x, site.center.z - player.position.z) <
      site.radius * 1.25)?.id ?? 'hoofington';
    const levels = this.game.island.tideLevels;
    const low = levels[0] ?? this.game.island.seaLevel;
    const high = levels[levels.length - 1] ?? low;
    const tide = match?.mode === 'rising-tide'
      ? Math.max(0, Math.min(1, (match.tideLevel - low) / Math.max(.001, high - low))) : 0;

    // These are the sole drain sites for audio. Do not read latestEvents (which
    // only retains the last catch-up tick), or drain a queue again this frame.
    this.audio.updateFrame({
      dt, camera,
      state: {
        mode: match ? 'party' : 'free',
        combo: this.game.rules.style.combo.count,
        meter: this.game.rules.style.meter,
        tide, poi, night,
      },
      physics: [
        ...this.game.goat.events.drain(),
        ...[...this.game.party.bots.values()].flatMap(bot => bot.goat.events.drain()),
      ],
      chaos: [
        ...this.game.water.events.drain(),
        ...this.game.breakables.events.drain(),
        ...this.game.chains.events.drain(),
        ...this.game.surfaces.events.drain(),
      ],
      gameplay: this.gameplay.splice(0),
      modes: match?.drainEvents() ?? [],
      gigs: this.game.gigs.director.drainEvents(),
      cues: this.cues.splice(0),
      goats,
      goatPosition: player.position,
      positionForGoat: id => positions.get(id),
      positionForBody: handle => {
        const body = this.game.physics.raw.getRigidBody(handle);
        return body ? { ...body.translation() } : undefined;
      },
      sizeForGoat: id => sizes.get(id),
    });
  }

  dispose(): void {
    for (const unsubscribe of this.off.splice(0)) unsubscribe();
    this.gameplay.length = 0;
    this.cues.length = 0;
  }
}
