import greeting from './assets/post/marnie.mp3?inline';
import postmark from './assets/post/postmark.mp3?inline';
import mailboat from './assets/post/island-jazz-mailboat.ogg?url';
import contacts from './assets/foley/contacts.json';
import contactUrl from './assets/foley/contact-bank.wav?url';
import party from './assets/music/last-bale-standing.mp3?url';
import farm from './assets/music/island-village-shuffle.mp3?url';
import boardwalk from './assets/music/island-promenade.mp3?url';
import yard from './assets/music/clockwork-swing.mp3?url';
import forest from './assets/music/curious-motif.mp3?url';
import summit from './assets/music/mountain-ascent.mp3?url';
import dam from './assets/music/e-minor-groove.mp3?url';
import town from './assets/music/switchyard-shuffle.mp3?url';
import coast from './assets/music/glasswater.mp3?url';
import baa_ardwalk from './assets/ambience/baa-ardwalk.mp3?url';
import crane_yard from './assets/ambience/crane-yard.mp3?url';
import downtown_bleatsville from './assets/ambience/downtown-bleatsville.mp3?url';
import hoofington from './assets/ambience/hoofington.mp3?url';
import farm_paddock from './assets/ambience/farm-paddock.mp3?url';
import mt_gigga from './assets/ambience/mt-gigga.mp3?url';
import old_lighthouse from './assets/ambience/old-lighthouse.mp3?url';
import pines_understory from './assets/ambience/pines-understory.mp3?url';
import the_dam from './assets/ambience/the-dam.mp3?url';
import whispering_pines from './assets/ambience/whispering-pines.mp3?url';
import laneRain from './assets/ambience/rain-lane.mp3?url';
import shelteredRain from './assets/ambience/rain-shelter.mp3?url';
import afterRain from './assets/ambience/after-rain.mp3?url';
import pierRigging from './assets/ambience/pier-rigging.mp3?url';
import pineCrickets from './assets/ambience/pine-crickets.mp3?url';
import millAxle from './assets/ambience/mill-axle.mp3?url';
import turbineHouse from './assets/ambience/turbine-house.mp3?url';
import { RECORDED_EFFECTS } from './recorded-effects';
import type { RecordedAssets } from './recordings';

export const BILLY_ISLE_RECORDINGS: RecordedAssets = {
  music: {
    farm, town, coast, party, post: mailboat,
    'baa-ardwalk': boardwalk,
    'crane-yard': yard,
    'whispering-pines': forest,
    'mt-gigga': summit,
    'the-dam': dam,
  },
  effects: { ...RECORDED_EFFECTS, postmark: postmark.split(',')[1]!, 'ui-postmaster': greeting.split(',')[1]! },
  foley: { url: contactUrl, contacts },
  ambience: {
    'rain-lane': laneRain,
    'rain-shelter': shelteredRain,
    'after-rain': afterRain,
    'pier-rigging': pierRigging,
    'pine-crickets': pineCrickets,
    'mill-axle': millAxle,
    'turbine-house': turbineHouse,
    'baa-ardwalk': baa_ardwalk,
    'crane-yard': crane_yard,
    'downtown-bleatsville': downtown_bleatsville,
    'hoofington': hoofington,
    'farm-paddock': farm_paddock,
    'mt-gigga': mt_gigga,
    'old-lighthouse': old_lighthouse,
    'pines-understory': pines_understory,
    'the-dam': the_dam,
    'whispering-pines': whispering_pines,
  },
};
