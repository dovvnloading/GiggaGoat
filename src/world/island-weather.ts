import * as THREE from 'three';

export interface IslandWeather {
  phase: number;
  cloud: number;
  rain: number;
  wet: number;
  mist: number;
  time: number;
}
const ease = THREE.MathUtils.smoothstep;
const wrap = THREE.MathUtils.euclideanModulo;

// One playable day lasts eight minutes. Give the daylight hours more play time.
export function islandWeather(time: number): IslandWeather {
  const clock = wrap(time / 480 + .09, 1);
  const phase = clock < .72 ? .25 + .5 * clock / .72 : wrap(.75 + .5 * (clock - .72) / .28, 1);
  // The front travels on its own clock, so rain can arrive at any hour.
  const front = wrap(time + 8, 187);
  const cloud = .29 + .68 * ease(front, 18, 56) * (1 - ease(front, 97, 148));
  const rain = ease(front, 47, 69) * (1 - ease(front, 88, 112));
  const wet = ease(front, 48, 76) * (1 - ease(front, 106, 171));
  const morning = 1 - ease(Math.abs(phase - .255), .018, .093);
  return { time, phase, cloud, rain, wet, mist: .4 * morning + .70 * rain };
}

export function weatherCaption(weather: IslandWeather): string {
  const minutes = Math.floor(weather.phase * 1440);
  const hour = Math.floor(minutes / 60);
  const time = (hour % 12 || 12) + ':' + String(minutes % 60).padStart(2, '0') + (hour < 12 ? ' AM' : ' PM');
  const condition = weather.rain > .2 ? 'Passing showers' : weather.cloud > .65 ? 'Cloud cover' :
    weather.mist > .2 ? 'Coastal mist' : weather.wet > .3 ? 'Clearing skies' : 'Fair skies';
  return time + ' · ' + condition;
}

// Periodic value noise with several scales. The same tile drives the cloud
// deck, shadows on the island, and small patches of wear on the ground.
const SIZE = 128;
function lattice(x: number, y: number, cells: number): number {
  let n = Math.imul(x % cells + 1, 374761393) + Math.imul(y % cells + 1, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}
function noise(x: number, y: number, cells: number): number {
  const u = x * cells, v = y * cells, i = Math.floor(u), j = Math.floor(v);
  const a = ease(u - i, 0, 1), b = ease(v - j, 0, 1);
  return THREE.MathUtils.lerp(
    THREE.MathUtils.lerp(lattice(i,j,cells), lattice(i+1,j,cells), a),
    THREE.MathUtils.lerp(lattice(i,j+1,cells), lattice(i+1,j+1,cells), a), b);
}
const field = new Uint8Array(SIZE * SIZE);
for (let j = 0; j < SIZE; j++) for (let i = 0; i < SIZE; i++) {
  const u = i / SIZE, v = j / SIZE;
  field[j * SIZE + i] = Math.round(255 * (.50 * noise(u,v,5) + .27 * noise(u,v,11) +
    .15 * noise(u,v,23) + .08 * noise(u,v,51)));
}
export function cloudSample(x: number, y: number): number {
  return field[((Math.floor(y * SIZE) & 127) * SIZE) + (Math.floor(x * SIZE) & 127)]! / 255;
}
export function cloudTexture(): THREE.DataTexture {
  const tex = new THREE.DataTexture(field, SIZE, SIZE, THREE.RedFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}
