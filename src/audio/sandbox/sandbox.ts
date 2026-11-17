import {
  AudioEngine, localAudioSettings, LOCATIONS, SOUND_IDS,
  selectMusic,
} from '../index';
import type { AudioLocation, AudioMode, AudioSettings, GoatVoice, SoundId } from '../index';

const $ = <T extends HTMLElement>(id: string): T => {
  const found = document.getElementById(id);
  if (!found) throw new Error('Missing sandbox element: ' + id);
  return found as T;
};
const engine = new AudioEngine({ seed: 'audio-lab-v1', storage: localAudioSettings('gigga-goat.audio.sandbox') });
engine.unlockOnFirstInput(window);
const status = $<HTMLDivElement>('status');
const unlock = $<HTMLButtonElement>('unlock');
unlock.addEventListener('click', () => void engine.unlock().then(refresh));
const size = $<HTMLSelectElement>('goat-size');
const voice = $<HTMLSelectElement>('goat-voice');
const mode = $<HTMLSelectElement>('mode');
const poi = $<HTMLSelectElement>('poi');
const night = $<HTMLInputElement>('night');
const orbitButton = $<HTMLButtonElement>('orbit-toggle');
const orbitTap = $<HTMLButtonElement>('orbit-tap');
const orbitDistance = $<HTMLInputElement>('orbit-distance');
const source = $<HTMLSpanElement>('source');
const muted = $<HTMLInputElement>('muted');
let orbiting = false;
let orbitAngle = 0;
let lastBleat = -99;

for (const place of LOCATIONS) {
  const option = document.createElement('option');
  option.value = place;
  option.textContent = place.replaceAll('-', ' ').replace(/\b\w/g, c => c.toUpperCase());
  poi.append(option);
}
const sliders = [
  { id: 'combo', label: 'Combo', min: 0, max: 16, initial: 0 },
  { id: 'meter', label: 'GIGGA meter', min: 0, max: 100, initial: 0 },
  { id: 'tide', label: 'Rising tide', min: 0, max: 100, initial: 0 },
] as const;
function slider(parent: HTMLElement, id: string, labelText: string,
  min: number, max: number, value: number, onChange: (v: number) => void): void {
  const box = document.createElement('div');
  box.className = 'control';
  const label = document.createElement('label');
  label.htmlFor = id;
  label.textContent = labelText;
  const range = document.createElement('input');
  range.type = 'range'; range.id = id;
  range.min = String(min); range.max = String(max); range.value = String(value);
  const output = document.createElement('output');
  output.textContent = String(value);
  range.addEventListener('input', () => {
    const v = Number(range.value);
    output.textContent = String(v);
    onChange(v);
  });
  box.append(label, range, output);
  parent.append(box);
}
const controls: { combo: number; meter: number; tide: number } = {
  combo: 0, meter: 0, tide: 0,
};
for (const c of sliders) {
  slider($('music-controls'), c.id, c.label, c.min, c.max, c.initial,
    value => { controls[c.id] = value; updatePlanLabel(); });
}
function updatePlanLabel(): void {
  const plan = selectMusic({
    mode: mode.value as AudioMode, poi: poi.value as AudioLocation,
    night: night.checked, combo: controls.combo, meter: controls.meter,
    tide: controls.tide / 100,
  });
  const active = ['chords', plan.rhythm && 'rhythm', plan.drums && 'drums',
    plan.bass && 'bass', plan.lead && 'lead'].filter(Boolean).join(' + ');
  $('music-status').textContent = plan.bpm + ' BPM · ' + active;
}
for (const el of [mode, poi, night]) el.addEventListener('change', updatePlanLabel);
updatePlanLabel();

const ranges: (keyof Omit<AudioSettings, 'muted'>)[] = ['master', 'music', 'sfx', 'ui', 'ambience'];
for (const key of ranges) {
  slider($('mixer-controls'), key + '-mix', key.charAt(0).toUpperCase() + key.slice(1),
    0, 100, Math.round(engine.settings[key] * 100),
    value => { engine.setSettings({ [key]: value / 100 }); });
}
muted.checked = engine.settings.muted;
muted.addEventListener('change', () => { engine.setSettings({ muted: muted.checked }); });

const groups: readonly { name: string; sounds: readonly SoundId[] }[] = [
  { name: 'Goat verbs', sounds: SOUND_IDS.slice(0, 19) },
  { name: 'Chaos and builds', sounds: SOUND_IDS.slice(19, 31) },
  { name: 'Gigs, party and UI', sounds: SOUND_IDS.slice(31, 44) },
  { name: 'Island nature', sounds: SOUND_IDS.slice(44) },
];
async function play(id: SoundId, spatial = false): Promise<void> {
  if (!await engine.unlock()) { refresh(); return; }
  const distance = Number(orbitDistance.value);
  const position = spatial
    ? { x: Math.sin(orbitAngle) * distance, y: 1.5, z: -Math.cos(orbitAngle) * distance }
    : undefined;
  engine.play(id, { size: Number(size.value), voice: voice.value as GoatVoice,
    position, combo: controls.combo, intensity: .9 });
  refresh();
}
for (const group of groups) {
  const box = document.createElement('div');
  box.className = 'group';
  const title = document.createElement('h3'); title.textContent = group.name;
  const buttons = document.createElement('div'); buttons.className = 'buttons';
  for (const id of group.sounds) {
    const button = document.createElement('button');
    button.className = 'sound';
    button.textContent = id.replaceAll('-', ' ');
    button.title = 'Play ' + id;
    button.addEventListener('click', () => void play(id));
    buttons.append(button);
  }
  box.append(title, buttons); $('sfx-groups').append(box);
}
orbitButton.addEventListener('click', () => {
  orbiting = !orbiting;
  orbitButton.textContent = orbiting ? '■ Stop orbit' : '▶ Orbit bleats';
  if (orbiting) void engine.unlock();
});
orbitTap.addEventListener('click', () => void play('bleat', true));
orbitDistance.addEventListener('input', () => {
  $('orbit-metres').textContent = orbitDistance.value + ' m';
});
function refresh(unlocked = engine.status.unlocked): void {
  status.textContent = unlocked ? '● Audio running · ' + engine.status.voices + ' voices' : 'Audio locked';
  status.style.color = unlocked ? '#9cd7b5' : '#efd39a';
  unlock.textContent = unlocked ? '✓ Unlocked' : '▶ Unlock Audio';
}
let lastFrame = performance.now();
function animate(now: number): void {
  const dt = Math.min(.09, Math.max(0, (now - lastFrame) / 1000));
  lastFrame = now;
  if (orbiting) {
    orbitAngle += dt * .9;
    if (now / 1000 - lastBleat > .95) {
      lastBleat = now / 1000;
      void play('bleat', true);
    }
  }
  source.style.left = 50 + Math.sin(orbitAngle) * 45 + '%';
  source.style.top = 50 - Math.cos(orbitAngle) * 45 + '%';
  engine.updateFrame({
    dt,
    camera: { position: { x: 0, y: 1.5, z: 0 },
      forward: { x: 0, y: 0, z: -1 }, up: { x: 0, y: 1, z: 0 } },
    state: { mode: mode.value as AudioMode, poi: poi.value as AudioLocation,
      night: night.checked, combo: controls.combo, meter: controls.meter,
      tide: controls.tide / 100 },
  });
  refresh();
  requestAnimationFrame(animate);
}
requestAnimationFrame(animate);
window.addEventListener('pagehide', () => engine.dispose());
