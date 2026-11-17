/** Gigga-Goat audio lane: procedural WebAudio, no playback assets or external libraries. */
export { AudioEngine, VoiceManager, localAudioSettings } from './engine';
export type {
  AudioEngineOptions, AudioSettingsStore, CameraAudioPose, WalkingGoat,
  AudioFrame, PlayOptions, AudioStatus,
} from './engine';
export { ProceduralSynth } from './synth';
export type { SfxOptions, SoundRender } from './synth';
export { AdaptiveMusic, IslandAmbience, locationFlavor } from './music';
export {
  AudioRandom, SOUND_IDS, SURFACES, VOICES, LOCATIONS, DEFAULT_AUDIO_SETTINGS,
  DEFAULT_MUSIC_STATE, CULL_DISTANCE, MAX_VOICES,
  settingsFrom, distance, distanceGain, goatPitch, stepLength,
  soundPriority, soundLimit, decideVoice, duckGainSince, isBigMoment,
  selectMusic, scorePattern,
} from './logic';
export type {
  SoundId, Surface, GoatVoice, AudioBus, AudioSettings, Vec3,
  AudioMode, AudioLocation, VoiceTicket, VoiceDecision,
  MusicState, MusicPlan,
} from './logic';
export {
  PHYSICS_EVENT_TYPES, GAMEPLAY_EVENT_TYPES, CHAOS_EVENT_TYPES,
  MODE_EVENT_TYPES, GIG_EVENT_TYPES, mapLaneEvent, mapPhysics,
  mapGameplay, mapChaos, mapMode, mapGig,
} from './events';
export type {
  AudioCue, ChaosEvent, GameplayAudioEvent, LaneAudioEvent,
} from './events';
