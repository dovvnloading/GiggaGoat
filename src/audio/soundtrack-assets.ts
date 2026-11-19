import contacts from './assets/foley/contacts.json';
import contactUrl from './assets/foley/contact-bank.wav?url';
import party from './assets/music/last-bale-standing.mp3?url';
import farm from './assets/music/gate-latch-reel.mp3?url';
import town from './assets/music/switchyard-shuffle.mp3?url';
import coast from './assets/music/glasswater.mp3?url';
import baa_ardwalk from './assets/ambience/baa-ardwalk.mp3?url';
import crane_yard from './assets/ambience/crane-yard.mp3?url';
import downtown_bleatsville from './assets/ambience/downtown-bleatsville.mp3?url';
import hoofington from './assets/ambience/hoofington.mp3?url';
import meadow_night from './assets/ambience/meadow-night.mp3?url';
import mt_gigga from './assets/ambience/mt-gigga.mp3?url';
import old_lighthouse from './assets/ambience/old-lighthouse.mp3?url';
import pines_night from './assets/ambience/pines-night.mp3?url';
import the_dam from './assets/ambience/the-dam.mp3?url';
import whispering_pines from './assets/ambience/whispering-pines.mp3?url';
import { RECORDED_EFFECTS } from './recorded-effects';
import type { RecordedAssets } from './recordings';

export const BILLY_ISLE_RECORDINGS: RecordedAssets = {
  music: { farm, town, coast, party },
  effects: RECORDED_EFFECTS,
  foley: { url: contactUrl, contacts },
  ambience: {
    'baa-ardwalk': baa_ardwalk,
    'crane-yard': crane_yard,
    'downtown-bleatsville': downtown_bleatsville,
    'hoofington': hoofington,
    'meadow-night': meadow_night,
    'mt-gigga': mt_gigga,
    'old-lighthouse': old_lighthouse,
    'pines-night': pines_night,
    'the-dam': the_dam,
    'whispering-pines': whispering_pines,
  },
};
