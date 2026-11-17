# Gigga-Goat • procedural audio lane

**All audio is Web Audio synthesis.** No samples, MP3s, fetched assets or added npm packages; other lanes remain unmodified. Browser audio stays silent until a genuine user gesture. Design target: punchy squishes, comic overtones, size-scaled bleats, airy island ambience, and upbeat music that rewards stylish play.

## Minimal integration — one call per render frame

~~~ts
import { AudioEngine, localAudioSettings } from '../audio';
import type { GameplayAudioEvent } from '../audio';
const audio = new AudioEngine({ seed: island.seed, storage: localAudioSettings() });
const unbindUnlock = audio.unlockOnFirstInput(window);

// The host already owns world, physics, gameplay, chaos, modes and gigs.
// Queue gameplay events via its keyed EventBus; do not drain a queue twice.
const gameplayQueue: GameplayAudioEvent[] = [];
const offScore = game.events.on('style:scored', data =>
  gameplayQueue.push({ type: 'style:scored', data }));
// Add other gameplay subscriptions the host needs in the same pattern.

function renderFrame(dt: number) {
  audio.updateFrame({
    dt,
    camera: {
      position: camera.position,
      forward: camera.getWorldDirection(new THREE.Vector3()),
      up: { x: 0, y: 1, z: 0 },
    },
    state: {
      mode: partyActive ? 'party' : 'free',
      combo: game.style.combo.count,
      meter: game.style.meter, // 0..100, NOT 0..1
      tide: partyTideProgress, // 0..1
      poi: activePoiId,       // public world PoiId
      night: nightCycleIsDark,
    },
    physics: goat.events.drain(),
    gameplay: gameplayQueue.splice(0),
    chaos: [...water.events.drain(), ...destruction.events.drain(),
            ...chains.events.drain(), ...surfaces.events.drain()],
    modes: partyEvents, gigs: gigTickEvents,
    goats: [{ id: goatId, position: goatPosition, size: goatSize,
              speed: horizontalVelocity, grounded: isGrounded, surface: 'grass' }],
    goatPosition, // fallback position for non-embedded event locations
    positionForGoat: id => goatPositions.get(id),
    positionForBody: handle => bodyPositions.get(handle),
    sizeForGoat: id => goatSizes.get(id),
  });
}
// On teardown: offScore(); unbindUnlock(); audio.dispose();
~~~

The snippet illustrates an existing host and its already-defined variables, not a standalone game. **AudioEngine.updateFrame(frame)** is the single audio call per render frame: it handles queued lane events, footfall distance accumulation, listener pose, adaptive music, ambience, and ducking. Partial state updates preserve unmentioned fields. List the local goat first in goats: keyed gameplay ability events do not carry IDs, so the first observation supplies their local size and position. World-space positions are metres with Y up. Explicit positions, such as destruction, take precedence over body/goat lookup, then fallback goatPosition. Events received while locked are intentionally discarded, never replayed in a burst on unlock.

## API exported from src/audio/index.ts

- **new AudioEngine({ seed?, contextFactory?, settings?, storage?, maxVoices? })**: lazily creates the AudioContext. contextFactory is for tests or advanced hosts; no context is created at module import. Seed can be a number or string.
- **audio.unlock(): Promise<boolean>**: invoke from a pointer/key/touch gesture. **unlockOnFirstInput(target?)** attaches those listeners until successful and returns an unsubscriber. Do not auto-resume on page load.
- **audio.play(soundId, { position?, size?, intensity?, pitch?, voice?, combo?, bus?, priority? })**: returns true when voice admitted. SOUND_IDS, VOICES and all option types are exported. Size 0.6 (Kid) sounds squeakier; size 3 (GIGGA) is thunderous. Bleat characters: hero, raspy, goofy and robot, with seeded timbral variation.
- **audio.updateFrame({dt,camera?,state?,physics?,gameplay?,chaos?,modes?,gigs?,goats?,goatPosition?,positionForGoat?,positionForBody?,sizeForGoat?})**: music state is mode free/party, combo count, meter 0..100, tide fraction 0..1, poi (public PoiId), night boolean. Footsteps use measured speed, grounded state and one of six surface names.
- **audio.setSettings(partial)**, **audio.settings**, **audio.status** (unlocked, voices, settings, music), **audio.audioContext**, **audio.voiceTickets**, **audio.dispose()**. Five bus volume values are in 0..1; muted disables master. **localAudioSettings(key?)** is an optional localStorage adapter with a safe failure path. Custom AudioSettingsStore hooks may use the game's own save backend.
- **VoiceManager**, **ProceduralSynth**, **AdaptiveMusic**, **IslandAmbience** for advanced use. Pure/testable exports: AudioRandom, settingsFrom, decideVoice, soundLimit, distanceGain, goatPitch, duckGainSince, selectMusic, scorePattern, locationFlavor. The five map* helpers and full type lists are exported.

## Routing, voices and island scale

SFX/UI/ambience each go to the master; music first passes through a dedicated duck gain. Master feeds a fast dynamics-compressor limiter and the audio output. Default ceiling: 32 simultaneous SFX voices with per-effect polyphony (1–5), importance-aware stealing, ~18ms fade on steal, and 275m culling/fade out (Billy Isle is ~600m wide). WebAudio PannerNode provides equal-power 3D direction without expensive per-voice HRTF, using our manually tuned 600m-island rolloff and no raycast occlusion. The source's world coordinates stay fixed while the listener follows camera orientation. Important cues preempt weak ambience/footfalls, not the other way around.

The synth constructs one shared two-second seeded noise table; no decode/fetch and no buffer per impact. Sources stop and disconnect on ended. Music schedules ~190ms ahead with bounded work and drops missed notes after background-tab hitches; the duck and ambience use smoothed AudioParam transitions rather than instantaneous hard cuts. Major crashes, GIGGA transitions, tide alarms, gig success and victory duck music ~66% then smoothly recover over ~900ms.

## Sounds and sonic character

Every member of SOUND_IDS has a distinct procedural patch. The catalog spans goat bleats, charge/impact, elastic tongue, all six footstep surfaces, spring jump, airy flip, thud landing, ragdoll flop, wall scrabble, mass/speed splash, crates/props/dominoes, fizzy soda, trampoline, launch blast, Hay-Build snaps/collapse, rising combo, GIGGA grow/shrink, coin, gig finish/fail, bronze/silver/gold, party countdown, tide horn, elimination/victory, UI controls, and nature accents.

Free-roam starts with gentle chord plucks; combo and meter unlock rhythmic plucks, drums, bass and lead in stages. Party mode pushes tempo from ~124 to 166 BPM as tide rises and turns more tense. Night softens the tone, shifting to a minor-ish scale. Seeded four-bar melodic variants rotate without frame-rate randomness. Location timbres: Hoofington farm plucks, Baa-ardwalk and lighthouse bell-like seaside tones, downtown / Crane Yard jaunty synth, Whispering Pines watery wooden melody, Mt. Gigga long bells, The Dam grittier tones. Coast, farmland, town, forest stream, mountain wind, and dam spillway have individual filtered, gently crossfaded procedural beds; seeded birds, gulls and windy accents appear sparingly.

## Typed lane event coverage and deduplication

**mapPhysics**, **mapGameplay**, **mapChaos**, **mapMode**, **mapGig**, and **mapLaneEvent** import only public types from the five lanes. Each current event discriminant and gameplay key is in compile-time-checked *_EVENT_TYPES tuples. Some transitions intentionally emit no sound (airtimeStart/airtimeEnd, challenge progress, conveyor exit) to avoid event spam. style:input is silent because style:scored is authoritative. Gameplay events are {type, data} objects because its EventBus is keyed. This adapter never calls another lane's drain/subscription API; **the host owns all event drains** and can avoid double consumption. If the same physical flap/impact appears in both physics and gameplay, prefer feeding one canonical event; voice caps and cooldowns are a second line of defense.

## Dev console and tests

Run **npm run ci** for strict TS, all Vitest tests and root Vite build. Start Vite and open **/src/audio/sandbox/index.html** for the independent dev sound board. It lists every sound, lets you change goat voice/size and buses, controls combo, meter, party tide, location and night, and orbits a spatial bleat around a fixed listener to audition left/right/front/back panning. The sandbox is a separate HTML entry and does not ship in the root production build.
