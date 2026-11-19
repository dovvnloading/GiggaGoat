import { afterEach, expect, it, vi } from 'vitest';
import { DEFAULT_MUSIC_STATE } from './logic';
import { RecordedAudio } from './recordings';
import type { RecordedAssets } from './recordings';

const assets: RecordedAssets = {
  music: { farm: '/farm.mp3', town: '/town.mp3', coast: '/coast.mp3' },
  effects: {
    'goat-bleat': 'AQ==', 'hoof-step-stone': 'Ag==', 'headbutt-wood': 'Aw==',
    'tongue-latch': 'BA==', 'water-flop-splash': 'BQ==', 'gig-reward': 'Bg==', jump: 'Bw==', 'ui-click': 'CA==',
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
      duration: new Uint8Array(bytes)[0] ?? 1, sampleRate: 44100, getChannelData: () => Float32Array.of(.1),
    } as unknown as AudioBuffer)),
  };
  return { context, sources, output: gain() as unknown as GainNode };
}

afterEach(() => vi.unstubAllGlobals());

it('decodes the recorded effects and substitutes the correct source for a game cue', async () => {
  const { context, sources, output } = audioFixture();
  const recorded = new RecordedAudio(context as unknown as AudioContext, assets, output);
  await vi.waitFor(() => expect(context.decodeAudioData).toHaveBeenCalledTimes(8));
  expect(recorded.render('ambient-bird', output, {})).toBeNull();
  expect(recorded.render('footstep-rock', output, { pitch: 1.05 })?.duration).toBeCloseTo(2 / 1.05);
  expect(sources[0]?.playbackRate.value).toBe(1.05);
  expect(recorded.render('headbutt-impact', output, {})).toBeNull();
  expect(recorded.render('headbutt-impact', output, { when: 13 }, 'headbutt-wood')?.duration).toBe(3);
  expect(sources[1]?.start).toHaveBeenCalledWith(13, 0);
  expect(recorded.render('jump', output, {})?.duration).toBe(7);
  expect(recorded.render('ui-click', output, {})?.duration).toBe(8);
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

it('selects a dedicated zone recording and preserves the regional fallback elsewhere', async () => {
  const { context, output } = audioFixture();
  const fetchTrack = vi.fn(async () => ({
    ok: true, arrayBuffer: async () => Uint8Array.of(77).buffer,
  }));
  vi.stubGlobal('fetch', fetchTrack);
  const recordings = { ...assets, music: { ...assets.music, 'crane-yard': '/clockwork.mp3' } };
  const recorded = new RecordedAudio(context as unknown as AudioContext, recordings, output);
  recorded.updateMusic({ ...DEFAULT_MUSIC_STATE, poi: 'crane-yard' });
  expect(fetchTrack).toHaveBeenCalledWith('/clockwork.mp3', expect.anything());
  recorded.updateMusic({ ...DEFAULT_MUSIC_STATE, poi: 'downtown-bleatsville' });
  expect(fetchTrack).toHaveBeenCalledWith('/town.mp3', expect.anything());
  recorded.dispose();
});

it('retries a failed soundtrack when the player returns to that music region', async () => {
  const { context, sources, output } = audioFixture();
  const fetchTrack = vi.fn(async () => ({
    ok: true, arrayBuffer: async () => Uint8Array.of(82).buffer,
  }));
  fetchTrack.mockRejectedValueOnce(new Error('Temporary network failure'));
  vi.stubGlobal('fetch', fetchTrack);
  const recorded = new RecordedAudio(context as unknown as AudioContext, assets, output);
  const location = { ...DEFAULT_MUSIC_STATE, poi: 'old-lighthouse' } as const;

  recorded.updateMusic(location);
  await vi.waitFor(() =>
    expect(recorded.proceduralOutput.gain.setTargetAtTime).toHaveBeenCalledWith(1, 12, .12));
  recorded.updateMusic(location);
  expect(fetchTrack).toHaveBeenCalledTimes(1);

  recorded.updateMusic({ ...location, mode: 'party' });
  recorded.updateMusic(location);
  await vi.waitFor(() => {
    recorded.updateMusic(location);
    expect(sources[0]?.loop).toBe(true);
  });
  expect(fetchTrack).toHaveBeenCalledTimes(2);
  recorded.dispose();
});

it('plays three material-specific hoof edits from one decoded bank without a repeated attack', async () => {
  const {context, sources, output} = audioFixture();
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true,
    arrayBuffer: async () => Uint8Array.of(5).buffer })));
  const recorded = new RecordedAudio(context as unknown as AudioContext, {
    ...assets, foley: { url: '/foley.wav', contacts: {
      'landing-wood': [[.1,.12],[.3,.14],[.5,.11]],
    } },
  }, output);
  await vi.waitFor(() => expect(context.decodeAudioData).toHaveBeenCalledTimes(9));
  for (const duration of [.12,.14,.11,.12]) {
    expect(recorded.render('landing', output, { surface: 'wood' })?.duration).toBe(duration);
  }
  expect(sources.map(source => source.start.mock.calls[0])).toEqual([
    [12,.1,.12],[12,.3,.14],[12,.5,.11],[12,.1,.12],
  ]);
  recorded.dispose();
});
