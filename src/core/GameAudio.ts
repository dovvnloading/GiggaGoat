import { DEFAULT_AUDIO_SETTINGS, GAMEPLAY_EVENT_TYPES, mapChaos, mapPhysics } from '../audio';
import type {
  AudioCue, AudioEngine, CameraAudioPose, ChaosEvent, GameplayAudioEvent, ResultAudioKind,
  SoundId, Surface, WalkingGoat,
} from '../audio';
import { dot } from '../physics/math';
import { biomeAt, zoneAt, type IslandWeather } from '../world';
import type { GoatRagdoll, PhysicsEvent, Vec3 } from '../physics';
import type { Game, MaterialAudioContact, PlayerIntent } from './Game';
import type { GameSettings } from './Persistence';
import { IslandLifeAudio } from './IslandLifeAudio';

/** The narrow audio interface allows a fake AudioEngine in headless core tests. */
export type AudioSink = Pick<AudioEngine, 'updateFrame' | 'setSettings' | 'audioContext' |
  'beginResultAudio' | 'endResultAudio' | 'setMenuAudio' | 'clearVoices' | 'stopCue' | 'play'>;

type MenuSound = Extract<SoundId, `ui-${string}`>;

function surfaceAt(game: Game, position: Vec3, goat: GoatRagdoll): Surface {
  const hit = goat.locomotion.groundHit;
  const surface = hit && game.scenerySurfaces.get(hit.collider.handle);
  if (surface) return surface === 'stone' ? 'rock' : surface === 'soft' ? 'grass' : surface;
  const body = hit?.body;
  const support = body && game.physics.bodyData(body.handle);
  if (support?.kind === 'build-piece') return 'wood';
  switch (support?.data) {
    case 'log': case 'ramp': case 'crate': case 'deck': case 'dock':
    case 'bridge': case 'pier': case 'scaffold': return 'wood';
    case 'container': case 'beam': case 'crane': case 'ac-unit': return 'metal';
    case 'ledge': case 'rock': case 'dam-wall': return 'rock';
    case 'hay-bale': return 'grass';
  }
  if (position.y <= game.water.seaLevel + .25) return 'water';
  if (game.isAbovePierDeck(position)) return 'wood';
  const biome = biomeAt(game.island, position.x, position.z);
  if (biome === 'ocean' || biome === 'freshwater') return 'water';
  if (biome === 'beach') return 'sand';
  if (biome === 'industrial') return 'rock';
  if (biome === 'cliff' || biome === 'highlands' || biome === 'town') return 'rock';
  return 'grass';
}

function landmarkGain(listener: Vec3, emitters: readonly Vec3[], range: number): number {
  let nearest = range;
  for (const p of emitters) nearest = Math.min(nearest, Math.hypot(
    p.x - listener.x, p.y - listener.y, p.z - listener.z));
  const t = Math.min(1, (range - nearest) / (range * .75));
  return t * t * (3 - 2 * t);
}

function observeGoat(game: Game, goat: GoatRagdoll): WalkingGoat {
  const position = { ...goat.torso.translation() };
  const velocity = goat.torso.linvel();
  return {
    id: goat.id, position, size: goat.size,
    speed: goat.locomotion.isClinging ? Math.abs(dot(velocity, goat.locomotion.climbStride)) : Math.hypot(velocity.x, velocity.z),
    grounded: goat.locomotion.grounded && !goat.isRagdoll && !goat.locomotion.isClinging,
    gait: goat.locomotion.isClinging ? 'climb' : goat.pose === 'gallop' ? 'gallop' : goat.pose === 'walk' ? 'walk' : 'still',
    surface: surfaceAt(game, position, goat),
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
  private objectiveAttempt = -1;
  private objectiveCount = 0;
  private readonly barns: Vec3[];
  private readonly mills: Vec3[];
  private readonly turbines: Vec3[];
  private readonly pines: Vec3[];
  private charging = false;
  private reeling = false;
  private hidden = false;
  private pendingMenuCue: { sound: MenuSound; expiresAt: number } | null = null;
  private wasUnlocked = false;
  private transition: Promise<void> | null = null;
  private readonly lifeAudio: IslandLifeAudio;
  private menuOpen = false;

  constructor(private readonly game: Game, private readonly audio: AudioSink) {
    this.lifeAudio = new IslandLifeAudio(game.island.props.filter(p => p.kind === 'fountain')
      .map(p => p.transform.position));
    if (game.market) {
      const rustle = (position: Vec3): void => this.queueCue({sound:'market-rustle',position,intensity:.45});
      game.market.listeners.add(rustle);
      this.off.push(()=>game.market.listeners.delete(rustle));
    }
    this.mills = game.island.props.filter(p => p.kind === 'windmill').map(p => p.transform.position);
    this.turbines = game.island.colliders.flatMap(c =>
      c.shape !== 'heightfield' && c.id === 'the-dam-control-house' ? [c.transform.position] : []);
    this.barns = game.island.props.filter(p => p.poiId === 'hoofington' && p.kind === 'barn').map(p => p.transform.position);
    this.pines = game.island.props.filter(p => p.poiId === 'whispering-pines' && p.kind === 'tree-pine').map(p => p.transform.position);
    if (game.toys) {
      const toySound = (e: import('./Toybox').ToyCue) =>
        this.queueCue({sound: `toy-${e.toy}`, position:e.position, intensity: Math.min(1,e.strength*.72)});
      game.toys.listeners.add(toySound);
      this.off.push(() => game.toys.listeners.delete(toySound));
    }
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
      const recordedEffect = contact.material === 'soft' ? 'ragdoll-flop' : `headbutt-${contact.material}` as const;
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
      ambience: settings.effectsVolume * DEFAULT_AUDIO_SETTINGS.ambience / DEFAULT_AUDIO_SETTINGS.sfx,
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
    const charging = !!intent.chargeHeadbutt && !this.game.buildMode;
    const reeling = !!intent.reelTongue && !!this.game.goat.interactions.tongueBody;
    if (!charging && this.charging) this.audio.stopCue('headbutt-charge');
    if (!reeling && this.reeling) this.audio.stopCue('tongue-reel');
    if (reeling && !this.reeling) this.queueCue({ sound: 'tongue-reel', intensity: .5 });
    this.reeling = reeling;
    if (charging && !this.charging) this.queueCue({ sound: 'headbutt-charge', intensity: .35 });
    this.charging = charging;
  }

  setMenuOpen(open: boolean): void {
    this.menuOpen = open;
    this.audio.setMenuAudio(open);
    this.audio.endResultAudio();
    if (open) { this.charging = false; this.reeling = false; }
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
      this.reeling = false;
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
  frame(dt: number, camera: CameraAudioPose, night: boolean,
    weather?: Pick<IslandWeather, 'rain' | 'wet'>, sheltered = false): void {
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
    if (this.game.life) this.cues.push(...this.lifeAudio.sample(this.game.physics.time,
      this.game.life.residents, camera.position, !this.hidden && !this.menuOpen && this.game.ambientLifeEnabled));
    const atPier = this.game.isAbovePierDeck(player.position);
    const zone = atPier ? 'baa-ardwalk' : zoneAt(this.game.island, player.position.x, player.position.z);
    const poi = zone ?? this.game.island.pois.find(site =>
      Math.hypot(site.center.x - player.position.x, site.center.z - player.position.z) <
      site.radius * 1.25)?.id ?? 'hoofington';
    const levels = this.game.island.tideLevels;
    const low = levels[0] ?? this.game.island.seaLevel;
    const high = levels[levels.length - 1] ?? low;
    const tide = match?.mode === 'rising-tide'
      ? Math.max(0, Math.min(1, (match.tideLevel - low) / Math.max(.001, high - low))) : 0;

    const gigs = this.game.gigs.director.drainEvents();
    for (const event of gigs) {
      if (event.type !== 'objective.progress') continue;
      if (event.attemptId !== this.objectiveAttempt) {
        this.objectiveAttempt = event.attemptId;
        this.objectiveCount = 0;
      }
      const goal = event.objective;
      const count = 'reached' in goal ? goal.reached : goal.kind === 'coverage' ? goal.eaten :
        goal.kind === 'deliver' ? goal.done : 0;
      if (count > this.objectiveCount) {
        this.queueCue({ sound: goal.kind === 'coverage' ? 'graze' : 'checkpoint', intensity: .62 });
      }
      this.objectiveCount = count;
    }

    // These are the sole drain sites for audio. Do not read latestEvents (which
    // only retains the last catch-up tick), or drain a queue again this frame.
    this.audio.updateFrame({
      dt, camera,
      environment: weather && {
        rain: weather.rain, wet: weather.wet, sheltered,
        atPier,
        mill: poi === 'hoofington' ? landmarkGain(player.position, this.mills, 30) : 0,
        turbine: landmarkGain(player.position, this.turbines, 36),
      },
      habitat: poi === 'hoofington' && this.barns.some(p =>
        (p.x - player.position.x) ** 2 + (p.z - player.position.z) ** 2 < 17 ** 2) ? 'farm-paddock' :
        poi === 'whispering-pines' && this.pines.some(p =>
          (p.x - player.position.x) ** 2 + (p.z - player.position.z) ** 2 < 6 ** 2) ? 'pines-understory' : undefined,
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
      gigs,
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
    this.lifeAudio.dispose();
  }
}
