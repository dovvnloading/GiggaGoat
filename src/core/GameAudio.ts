import { DEFAULT_AUDIO_SETTINGS, GAMEPLAY_EVENT_TYPES, mapChaos, mapPhysics } from '../audio';
import type {
  AudioCue, AudioEngine, CameraAudioPose, ChaosEvent, GameplayAudioEvent, ResultAudioKind,
  SoundId, Surface, WalkingGoat,
} from '../audio';
import { biomeAt, zoneAt } from '../world';
import type { GoatRagdoll, PhysicsEvent, Vec3 } from '../physics';
import type { Game, MaterialAudioContact, PlayerIntent } from './Game';
import type { GameSettings } from './Persistence';

/** The narrow audio interface allows a fake AudioEngine in headless core tests. */
export type AudioSink = Pick<AudioEngine, 'updateFrame' | 'setSettings' | 'audioContext' |
  'beginResultAudio' | 'endResultAudio' | 'setMenuAudio' | 'clearVoices' | 'play'>;

type MenuSound = Extract<SoundId, `ui-${string}`>;

function surfaceAt(game: Game, position: Vec3): Surface {
  if (position.y <= game.water.seaLevel + .25) return 'water';
  if (game.isAbovePierDeck(position)) return 'wood';
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
  private readonly materialContacts = new WeakMap<PhysicsEvent | ChaosEvent,
    Pick<AudioCue, 'position' | 'recordedEffect'>>();
  private readonly off: Array<() => void> = [];
  private readonly positions = new Map<string, Vec3>();
  private readonly sizes = new Map<string, number>();
  // Stable lookup closures avoid allocating three callbacks for every audio tick.
  private readonly positionForGoat = (id: string): Vec3 | undefined => this.positions.get(id);
  private readonly sizeForGoat = (id: string): number | undefined => this.sizes.get(id);
  private readonly positionForBody = (handle: number): Vec3 | undefined => {
    const body = this.game.physics.raw.getRigidBody(handle);
    if (!body) return undefined;
    const p = body.translation();
    return { x: p.x, y: p.y, z: p.z };
  };
  private readonly audioKindForBody = (handle: number): 'goat' | undefined =>
    this.game.physics.bodyData(handle)?.kind === 'goat' ? 'goat' : undefined;

  private readonly useUnmodifiedCue = (event: PhysicsEvent | ChaosEvent): boolean => {
    if (event.type !== 'knockedBody' && event.type !== 'destruction') return true;
    const contact = this.materialContacts.get(event);
    if (!contact) return true;
    const cues = event.type === 'knockedBody' ? mapPhysics(event) : mapChaos(event);
    for (const cue of cues) this.cues.push({ ...cue, ...contact });
    return false;
  };
  private charging = false;
  private hidden = false;
  private pendingMenuCue: { sound: MenuSound; expiresAt: number } | null = null;
  private wasUnlocked = false;
  private transition: Promise<void> | null = null;

  constructor(private readonly game: Game, private readonly audio: AudioSink) {
    this.off.push(game.onMaterialAudio(this.onMaterialContact));
    for (const type of GAMEPLAY_EVENT_TYPES) {
      this.off.push(game.rules.events.on(type, data => {
        this.gameplay.push({ type, data } as GameplayAudioEvent);
      }));
    }
  }

  private readonly onMaterialContact = (contact: MaterialAudioContact): void => {
    const { position } = contact;
    if (contact.type === 'gnome-break') {
      this.cues.push({ sound: 'crate-break', position, intensity: .9, recordedEffect: 'break-stone', result: 'gig' });
      return;
    }
    if (contact.type === 'headbutt') {
      const recordedEffect = `headbutt-${contact.material}` as const;
      if (contact.event) this.materialContacts.set(contact.event, { position, recordedEffect });
      else this.cues.push({ sound: 'headbutt-impact', position, recordedEffect,
        goatId: contact.goatId, intensity: contact.intensity });
      return;
    }
    this.materialContacts.set(contact.event, { position, recordedEffect: `break-${contact.material}` });
  };

  setVolumes(settings: GameSettings): void {
    this.audio.setSettings({
      master: settings.volume, music: settings.musicVolume, sfx: settings.effectsVolume,
      ui: settings.effectsVolume * DEFAULT_AUDIO_SETTINGS.ui / DEFAULT_AUDIO_SETTINGS.sfx,
    });
  }

  queueCue(cue: AudioCue): void { this.cues.push(cue); }

  /** UI feedback is anchored to the screen and independent of the island listener. */
  playMenuCue(sound: MenuSound): void {
    const context = this.audio.audioContext;
    if (this.hidden || !context) return;
    this.pendingMenuCue = null;
    if (context.state === 'running') this.audio.play(sound);
    // A trusted event may have just created the context without finishing resume.
    else if (context.state === 'suspended') {
      this.pendingMenuCue = { sound, expiresAt: performance.now() + 250 };
    }
  }

  /** Charge start is an input-only edge; gameplay's release is still authoritative. */
  onInput(intent: PlayerIntent): void {
    const charging = !!intent.chargeHeadbutt;
    if (charging && !this.charging) this.queueCue({ sound: 'headbutt-charge', intensity: .35 });
    this.charging = charging;
  }

  setMenuOpen(open: boolean): void {
    this.audio.setMenuAudio(open);
    this.audio.endResultAudio();
    if (open) this.charging = false;
  }

  playResultAudio(result: ResultAudioKind): void {
    this.charging = false;
    this.audio.beginResultAudio(result);
    this.audio.setMenuAudio(true);
  }

  setHidden(hidden: boolean): void {
    this.hidden = hidden;
    if (hidden) {
      this.charging = false;
      this.pendingMenuCue = null;
      this.cues.length = 0;
      this.audio.endResultAudio();
      this.audio.clearVoices();
    }
    this.syncContext();
  }

  private syncContext(): void {
    const context = this.audio.audioContext;
    if (!context || this.transition) return;
    if (context.state === 'running') this.wasUnlocked = true;
    const suspending = this.hidden && context.state === 'running';
    const resuming = !this.hidden && this.wasUnlocked && context.state === 'suspended';
    if (!suspending && !resuming) return;
    const action = suspending ? context.suspend() : context.resume();
    this.transition = action.then(() => {
      this.transition = null;
      // A visibility/menu transition may have occurred during the async operation.
      this.syncContext();
    }, () => { this.transition = null; });
  }

  /** Called on every visible animation frame, including while menus are open. */
  frame(dt: number, camera: CameraAudioPose, night: boolean): void {
    this.syncContext();
    const menuCue = this.pendingMenuCue;
    if (menuCue && performance.now() > menuCue.expiresAt) {
      this.pendingMenuCue = null;
    } else if (menuCue && this.audio.audioContext?.state === 'running') {
      this.playMenuCue(menuCue.sound);
    }
    const match = this.game.party.match;
    const goats = [observeGoat(this.game, this.game.goat)];
    const physics = this.game.goat.events.drain();
    for (const bot of this.game.party.bots.values()) {
      goats.push(observeGoat(this.game, bot.goat));
      physics.push(...bot.goat.events.drain());
    }
    this.positions.clear();
    this.sizes.clear();
    for (const goat of goats) {
      this.positions.set(goat.id, goat.position);
      this.sizes.set(goat.id, goat.size);
    }
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
      physics: physics.filter(this.useUnmodifiedCue),
      chaos: [
        ...this.game.water.events.drain(),
        ...this.game.breakables.events.drain().filter(this.useUnmodifiedCue),
        ...this.game.chains.events.drain(),
        ...this.game.surfaces.events.drain(),
      ],
      gameplay: this.gameplay.splice(0),
      modes: match?.drainEvents() ?? [],
      gigs: this.game.gigs.director.drainEvents(),
      cues: this.cues.splice(0),
      goats,
      goatPosition: player.position,
      positionForGoat: this.positionForGoat,
      positionForBody: this.positionForBody,
      audioKindForBody: this.audioKindForBody,
      sizeForGoat: this.sizeForGoat,
    });
  }

  dispose(): void {
    for (const unsubscribe of this.off.splice(0)) unsubscribe();
    this.gameplay.length = 0;
    this.cues.length = 0;
    this.positions.clear();
    this.sizes.clear();
  }
}
