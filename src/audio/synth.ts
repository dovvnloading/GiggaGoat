import { AudioRandom, clamp, goatPitch } from './logic';
import type { GoatVoice, SoundId } from './logic';

export interface SfxOptions {
  surface?: import('./logic').Surface;
  when?: number; intensity?: number; size?: number; pitch?: number;
  voice?: GoatVoice; combo?: number;
}
export interface SoundRender {
  /** Real running oscillators / buffer sources, for lifecycle and stealing. */
  sources: AudioScheduledSourceNode[];
  duration: number;
}
/**
 * Shared two-second noise table, never a decoded asset. A few oscillators and
 * filtered bursts per effect, with WebAudio sample-accurate envelopes.
 */
export class ProceduralSynth {
  readonly noiseBuffer: AudioBuffer;
  constructor(readonly context: AudioContext, readonly random: AudioRandom) {
    const length = Math.ceil(context.sampleRate * 2);
    this.noiseBuffer = context.createBuffer(1, length, context.sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    let brown = 0;
    for (let i = 0; i < data.length; i++) {
      brown = (brown + (random.next() * 2 - 1) * .14) * .985;
      data[i] = clamp(brown * 2 + (random.next() * 2 - 1) * .26, -1, 1);
    }
  }

  /** One enveloped oscillator. Returned source is fully scheduled and self-cleaning. */
  tone(out: AudioNode, at: number, hz: number, duration: number, amp: number,
    wave: OscillatorType = 'sine', endHz = hz, attack = .006): OscillatorNode {
    const ctx = this.context;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    const length = Math.max(.018, duration);
    const start = Math.max(ctx.currentTime, at);
    const a = Math.min(Math.max(.001, attack), length * .35);
    osc.type = wave;
    osc.frequency.setValueAtTime(Math.max(20, hz), start);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, endHz), start + length);
    env.gain.setValueAtTime(0, start);
    env.gain.linearRampToValueAtTime(Math.max(0, amp), start + a);
    env.gain.exponentialRampToValueAtTime(.0001, start + length);
    osc.connect(env); env.connect(out);
    osc.onended = () => { osc.disconnect(); env.disconnect(); };
    osc.start(start);
    osc.stop(start + length + .005);
    return osc;
  }

  /** Filtered (not white-noise-at-full-volume) contact/swoosh texture. */
  noise(out: AudioNode, at: number, duration: number, amp: number,
    cutoff: number, type: BiquadFilterType = 'bandpass', q = .65): AudioBufferSourceNode {
    const ctx = this.context;
    const start = Math.max(ctx.currentTime, at);
    const length = Math.min(1.6, Math.max(.018, duration));
    const source = ctx.createBufferSource();
    source.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(Math.max(90, Math.min(cutoff, ctx.sampleRate * .43)), start);
    filter.Q.value = q;
    const env = ctx.createGain();
    env.gain.setValueAtTime(.0001, start);
    env.gain.linearRampToValueAtTime(Math.max(.0002, amp), start + Math.min(.015, length / 4));
    env.gain.exponentialRampToValueAtTime(.0001, start + length);
    source.connect(filter); filter.connect(env); env.connect(out);
    source.onended = () => {
      source.disconnect(); filter.disconnect(); env.disconnect();
    };
    const available = Math.max(0, 2 - length - .01);
    source.start(start, this.random.range(0, available), length);
    return source;
  }

  play(id: SoundId, out: AudioNode, options: SfxOptions = {}): SoundRender {
    const at = Math.max(this.context.currentTime, options.when ?? this.context.currentTime);
    const rng = this.random;
    const pitch = clamp((options.pitch ?? 1) * goatPitch(options.size ?? 1), .42, 2.2);
    const intensity = clamp(options.intensity ?? .7);
    const power = .66 + intensity * .58;
    const sources: AudioScheduledSourceNode[] = [];
    let length = .12;
    const t = (offset: number, hz: number, duration: number, gain: number,
      wave: OscillatorType = 'sine', end = hz, attack = .004): void => {
      sources.push(this.tone(out, at + offset, hz * pitch, duration, gain * power,
        wave, end * pitch, attack));
      length = Math.max(length, offset + duration);
    };
    const n = (offset: number, duration: number, gain: number, cutoff: number,
      filter: BiquadFilterType = 'bandpass', q?: number): void => {
      sources.push(this.noise(out, at + offset, duration, gain * power, cutoff,
        filter, q));
      length = Math.max(length, offset + duration);
    };
    const arpeggio = (degrees: readonly number[], root: number, beat: number,
      wave: OscillatorType = 'triangle', gain = .22): void => {
      degrees.forEach((note, i) => {
        const f = root * Math.pow(2, note / 12);
        t(i * beat, f, beat * 1.65, gain * (1 - i * .05), wave, f * .985);
        t(i * beat, f * 2, beat * .9, gain * .19, 'sine');
      });
    };
    switch (id) {
      case 'bleat': {
        const character = options.voice ?? rng.pick(['hero', 'raspy', 'goofy', 'robot'] as const);
        const root = (character === 'goofy' ? 270 : character === 'raspy' ? 165 :
          character === 'robot' ? 190 : 215) * rng.range(.91, 1.1);
        const intervals = character === 'robot' ? [0, 0, 2, -2] :
          character === 'raspy' ? [0, -2, 2, -3] : [0, 2, 1, -4];
        const wave: OscillatorType = character === 'robot' ? 'square' :
          character === 'raspy' ? 'sawtooth' : 'triangle';
        intervals.forEach((semitones, i) => {
          const f = root * Math.pow(2, semitones / 12);
          t(i * .1, f, .14 + rng.range(0, .045), .15, wave, f * (i === 3 ? .75 : 1.09), .018);
        });
        t(.035, root / 2, .42, .09, 'sawtooth', root * .42);
        n(0, .11, .035, 1350, 'highpass');
        length = .52;
        break;
      }
      case 'headbutt-charge':
        t(0, 100, .5, .14, 'sawtooth', 290, .09);
        t(.07, 65, .42, .13, 'triangle', 195);
        n(.18, .33, .12, 1550);
        break;
      case 'headbutt-impact':
        t(0, 170, .34 + intensity * .18, .34, 'sine', 42);
        t(.012, 280, .12, .16, 'triangle', 77);
        n(0, .23, .4, 550, 'lowpass');
        n(.012, .09, .19, 2600, 'highpass');
        break;
      case 'tongue-shoot':
        t(0, 320, .17, .13, 'triangle', 810);
        n(0, .14, .16, 1800);
        break;
      case 'tongue-stick':
        t(0, 440, .21, .22, 'sine', 130);
        t(.045, 510, .11, .12, 'triangle', 220);
        n(0, .055, .16, 940, 'lowpass');
        break;
      case 'tongue-reel':
        t(0, 155, .12, .085, 'sawtooth', 240);
        t(.055, 265, .095, .065, 'triangle', 190);
        break;
      case 'tongue-snap':
        t(0, 490, .13, .25, 'triangle', 95);
        n(0, .16, .27, 2900, 'highpass');
        break;
      case 'footstep-grass':
        n(0, .095, .17, 520, 'lowpass');
        n(.014, .07, .075, 2200, 'highpass');
        break;
      case 'footstep-sand':
        n(0, .17, .14, 780, 'lowpass');
        n(.035, .1, .055, 1450);
        break;
      case 'footstep-wood':
        t(0, 195, .11, .18, 'triangle', 110);
        n(0, .065, .11, 1350);
        break;
      case 'footstep-rock':
        n(0, .074, .17, 2800, 'highpass');
        t(0, 280, .075, .1, 'triangle', 200);
        break;
      case 'footstep-metal':
        t(0, 610, .28, .11, 'sine', 580);
        t(.005, 920, .22, .09, 'sine', 870);
        n(0, .045, .12, 4800, 'highpass');
        break;
      case 'footstep-water':
        t(0, 325, .15, .12, 'sine', 180);
        n(0, .14, .16, 1300, 'lowpass');
        break;
      case 'jump':
        t(0, 190, .24, .24, 'triangle', 440);
        t(.028, 370, .12, .08, 'sine', 620);
        break;
      case 'flip-whoosh':
        n(0, .42, .26, 1200, 'bandpass', .36);
        t(.08, 290, .3, .11, 'sine', 560);
        break;
      case 'landing':
        t(0, 132, .26, .23, 'sine', 54);
        n(0, .19, .21, 780, 'lowpass');
        break;
      case 'ragdoll-flop':
        t(0, 150, .28, .31, 'triangle', 52);
        n(.008, .13, .29, 720, 'lowpass');
        t(.13, 185, .2, .12, 'sine', 62);
        break;
      case 'climb':
        n(0, .11, .15, 1350);
        n(.065, .115, .095, 460, 'lowpass');
        break;
      case 'splash':
        n(0, .65 + intensity * .3, .36, 750 + intensity * 1400, 'lowpass');
        n(.032, .38, .25, 2400, 'highpass');
        t(.035, 180, .25, .12, 'sine', 63);
        [0, 1, 2].forEach(i => {
          const f = rng.range(220, 690);
          t(.12 + i * .075, f, .15, .1, 'sine', f * .6);
        });
        break;
      case 'crate-break':
      case 'prop-break':
        t(0, id === 'crate-break' ? 190 : 130, .29, .23, 'triangle', 55);
        n(0, .33, .35, id === 'crate-break' ? 1750 : 900, 'bandpass', .5);
        [0, 1, 2].forEach(i => n(.045 + i * .06, .115, .12, rng.range(700, 3100)));
        break;
      case 'domino':
        t(0, rng.range(240, 340), .1, .2, 'triangle', 160);
        n(0, .08, .15, 1800);
        break;
      case 'soda-pop':
        t(0, 330, .09, .3, 'sine', 95);
        n(.03, .62, .2, 4600, 'highpass');
        [0, 1, 2, 3].forEach(i => {
          const f = rng.range(700, 1400);
          t(.11 + i * .09, f, .06, .07, 'sine', f * 1.3);
        });
        break;
      case 'trampoline':
        t(0, 130, .6, .3, 'sine', 580);
        t(.055, 180, .43, .17, 'triangle', 370);
        break;
      case 'launch-pad':
        t(0, 95, .85, .35, 'sawtooth', 650, .035);
        t(.08, 55, .7, .21, 'sine', 290);
        n(0, .67, .29, 2400);
        break;
      case 'build-place':
        t(0, 145, .22, .2, 'triangle', 85);
        n(0, .1, .17, 1400);
        break;
      case 'toy-gas':
        for (let i=0;i<7;i++) t(i*.045,106-i*6,.074,.22,'sawtooth',54-i*2);
        n(.05,.24,.11,320,'lowpass'); break;
      case 'toy-glob':
        t(0,410,.11,.25,'triangle',95); t(.065,142,.095,.16,'sine',230); break;
      case 'toy-brew':
        n(0,.26,.17,4900,'highpass');
        arpeggio([0,7,12,16],310,.068,'sine',.15); break;
      case 'toy-sock':
        t(0,140,.42,.18,'triangle',320); t(.10,147,.33,.12,'sine',323); break;
      case 'toy-pogo':
        t(0,165,.23,.23,'triangle',470); t(.09,460,.19,.15,'sine',240); break;
      case 'toy-duck':
        t(0,640,.105,.17,'sawtooth',340); t(.125,550,.13,.14,'triangle',280); break;
      case 'graze':
        n(0, .09, .13, 1850); n(.07, .06, .08, 2300);
        break;
      case 'checkpoint':
        t(0, 660, .11, .15, 'sine'); t(.07, 880, .20, .1, 'sine');
        break;
      case 'build-snap':
        t(0, 540, .15, .17, 'triangle', 310);
        t(.065, 680, .13, .12, 'sine');
        break;
      case 'build-collapse':
        t(0, 145, .62, .36, 'sine', 43);
        n(0, .73, .34, 580, 'lowpass');
        n(.16, .4, .19, 1700);
        break;
      case 'combo': {
        const count = Math.min(12, Math.max(1, options.combo ?? 2));
        const root = 270 * Math.pow(2, Math.min(12, count - 1) / 24);
        arpeggio([0, 3 + (count > 5 ? 1 : 0), 7, 12], root, .088, 'triangle', .16);
        break;
      }
      case 'gigga-grow':
        t(0, 70, 1.22, .3, 'sawtooth', 450, .065);
        t(.04, 49, 1.28, .31, 'sine', 90);
        n(.08, 1.15, .23, 1120);
        arpeggio([0, 4, 7, 12, 16], 165, .19, 'triangle', .15);
        break;
      case 'gigga-shrink':
        t(0, 520, 1.05, .28, 'sawtooth', 82, .05);
        t(.11, 260, .95, .2, 'sine', 45);
        n(0, .85, .16, 970);
        break;
      case 'coin':
        t(0, 880, .17, .18, 'sine', 960);
        t(.08, 1320, .27, .19, 'sine', 1260);
        break;
      case 'gig-success':
        arpeggio([0, 4, 7, 12, 16, 19], 262, .125, 'triangle', .22);
        t(.74, 523, .55, .24, 'sine');
        break;
      case 'gig-fail':
        arpeggio([0, -2, -5, -9], 320, .18, 'triangle', .2);
        t(.61, 145, .4, .16, 'sine', 92);
        break;
      case 'rating-bronze':
        arpeggio([0, 4, 7], 294, .14, 'triangle', .16);
        break;
      case 'rating-silver':
        arpeggio([0, 4, 7, 12], 330, .12, 'triangle', .2);
        break;
      case 'rating-gold':
        arpeggio([0, 4, 7, 12, 16, 19], 392, .12, 'triangle', .19);
        break;
      case 'party-countdown':
        t(0, 630, .22, .21, 'triangle', 590);
        t(.045, 315, .2, .09, 'sine');
        break;
      case 'tide-warning':
        t(0, 184, 1.15, .27, 'sawtooth', 153, .09);
        t(.23, 185, 1, .25, 'triangle', 137);
        t(.6, 125, .8, .2, 'sine', 108);
        break;
      case 'elimination':
        t(0, 330, .45, .28, 'sawtooth', 85);
        arpeggio([0, -3, -7], 330, .19, 'triangle', .2);
        break;
      case 'victory':
        arpeggio([0, 4, 7, 12, 7, 12, 16, 19], 294, .145, 'triangle', .23);
        t(1.13, 588, .85, .24, 'sine');
        break;
      case 'ui-click':
        t(0, 670, .08, .13, 'sine', 510);
        break;
      case 'ui-back':
        t(0, 515, .12, .14, 'triangle', 285);
        break;
      case 'ui-confirm':
        t(0, 590, .1, .14, 'triangle', 690);
        t(.08, 885, .19, .16, 'sine');
        break;
      case 'ambient-bird': {
        const f = rng.range(1500, 2300);
        [0, 1, 2].forEach(i => t(i * .135, f + i * 160, .12, .075, 'sine', f * (1.24 + i * .08)));
        break;
      }
      case 'ambient-gull':
        t(0, 760, .36, .085, 'triangle', 420);
        t(.3, 550, .45, .075, 'triangle', 840);
        break;
      case 'ambient-stream':
        n(0, .75, .12, 1150, 'lowpass');
        break;
      case 'ambient-wind':
        n(0, 1.2, .15, 540, 'lowpass');
        break;
      case 'ambient-town':
        n(0, .6, .09, 880, 'bandpass');
        t(.23, 520, .15, .07, 'sine', 390);
        break;
      case 'ambient-dam':
        n(0, 1.3, .19, 230, 'lowpass');
        break;
      default: {
        const impossible: never = id;
        throw new Error('Unknown procedural sound ' + String(impossible));
      }
    }
    return { sources, duration: length + .01 };
  }
}
