import farm from './assets/music/hoofington-hop.mp3?url';
import town from './assets/music/crane-yard-rumble.mp3?url';
import coast from './assets/music/lanterns-over-billy-isle.mp3?url';
import { RECORDED_EFFECTS } from './recorded-effects';
import type { RecordedAssets } from './recordings';

export const BILLY_ISLE_RECORDINGS: RecordedAssets = {
  music: { farm, town, coast },
  effects: RECORDED_EFFECTS,
};
