import { afterEach, expect, it, vi } from 'vitest';
import { DEFAULT_MUSIC_STATE } from './logic';
import { RecordedAudio } from './recordings';
import type { RecordedAssets } from './recordings';

const assets: RecordedAssets = {
  music: { farm: '/farm.mp3', town: '/town.mp3', coast: '/coast.mp3' },
  effects: {
    'goat-bleat': 'AQ==', 'hoof-step-stone': 'Ag==', 'headbutt-wood': 'Aw==',
    'tongue-latch': 'BA==', 'water-flop-splash': 'BQ==', 'gig-reward': 'Bg==',
  },
};

function audioFixture() {
  const gain = () => ({
    gain: { value: 1, setTargetAtTime: vi.fn() },
    connect: vi.fn(), disconnect: vi.fn(),
  });
  const sources: ReturnType<typeof source>[] = [];
  function source() {
    return {
      buffer: null as AudioBuffer | null, loop: false, playbackRate: { value: 1 },
      connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn(), onended: null,
    };
  }
  const context = {
    currentTime: 12, createGain: gain,
    createBufferSource: () => {
      const node = source();
      sources.push(node);
      return node;
    },
    decodeAudioData: vi.fn(async (bytes: ArrayBuffer) => ({
      duration: new Uint8Array(bytes)[0] ?? 1,
    } as AudioBuffer)),
  };
  return { context, sources, output: gain() as unknown as GainNode };
}

afterEach(() => vi.unstubAllGlobals());

it('decodes the recorded effects and substitutes the correct source for a game cue', async () => {
  const { context, sources, output } = audioFixture();
  const recorded = new RecordedAudio(context as unknown as AudioContext, assets, output);
  await vi.waitFor(() => expect(context.decodeAudioData).toHaveBeenCalledTimes(6));
  expect(recorded.render('jump', output, {})).toBeNull();
  expect(recorded.render('footstep-rock', output, { pitch: 1.05 })?.duration).toBeCloseTo(2 / 1.05);
  expect(sources[0]?.playbackRate.value).toBe(1.05);
  expect(recorded.render('headbutt-impact', output, {})).toBeNull();
  expect(recorded.render('headbutt-impact', output, { when: 13 }, 'headbutt-wood')?.duration).toBe(3);
  expect(sources[1]?.start).toHaveBeenCalledWith(13);
  recorded.dispose();
});

it('loads the zone song, loops it, and falls back to adaptive music for party play', async () => {
  const { context, sources, output } = audioFixture();
  const fetchTrack = vi.fn(async () => ({
    ok: true, arrayBuffer: async () => Uint8Array.of(82).buffer,
  }));
  vi.stubGlobal('fetch', fetchTrack);
  const recorded = new RecordedAudio(context as unknown as AudioContext, assets, output);
  expect(fetchTrack).not.toHaveBeenCalled();
  recorded.updateMusic({ ...DEFAULT_MUSIC_STATE, poi: 'old-lighthouse' });
  await vi.waitFor(() => {
    recorded.updateMusic({ ...DEFAULT_MUSIC_STATE, poi: 'old-lighthouse' });
    expect(sources[0]?.loop).toBe(true);
  });
  expect(fetchTrack).toHaveBeenCalledWith('/coast.mp3', expect.objectContaining({ signal: expect.anything() }));
  expect(sources[0]?.buffer?.duration).toBe(82);
  expect(recorded.proceduralOutput.gain.setTargetAtTime).toHaveBeenCalledWith(0, 12, .13);
  recorded.updateMusic({ ...DEFAULT_MUSIC_STATE, mode: 'party' });
  expect(sources[0]?.stop).toHaveBeenCalledWith(12.45);
  expect(recorded.proceduralOutput.gain.setTargetAtTime).toHaveBeenCalledWith(1, 12, .12);
  recorded.dispose();
});
