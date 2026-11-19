"""Render the authored stereo environments using the game's ElevenLabs Foley and acoustic layers."""
import base64
import io
import re
import subprocess
from pathlib import Path

import numpy as np
import soundfile as sf
from scipy import signal

ROOT = Path(__file__).resolve().parents[2]
RATE = 32000
SECONDS = 31
SAMPLES = RATE * SECONDS
CLOCK = np.arange(SAMPLES) / RATE
SOURCES = dict(re.findall(r"""['"]([\w-]+)['"]:\s*['"]([A-Za-z0-9+/=]+)['"]""",
                          (ROOT / "src/audio/recorded-effects.ts").read_text()))
ZONES = ["hoofington", "baa-ardwalk", "crane-yard", "downtown-bleatsville", "mt-gigga",
         "whispering-pines", "the-dam", "old-lighthouse", "farm-paddock", "pines-understory"]


def air(rng, low, high, n=SAMPLES):
    raw = rng.standard_normal(n)
    filt = signal.butter(2, [low, high], btype="bandpass", fs=RATE, output="sos")
    wave = signal.sosfilt(filt, raw)
    return wave / max(.001, np.std(wave))


def foley(key, rate=1):
    a, sr = sf.read(io.BytesIO(base64.b64decode(SOURCES[key])), always_2d=True)
    mono = a.mean(axis=1)
    return signal.resample(mono, round(len(mono) * RATE / sr / rate))


def stereo(mix, at, wave, pan, level):
    # Wrap events across the loop seam, including their early reflection.
    start = round(at * RATE) % SAMPLES
    for channel, weight in enumerate([np.sqrt((1-pan)/2), np.sqrt((1+pan)/2)]):
        value = wave * level * weight
        for delay, amount in [(0, 1), (1137 + 129*channel, .095)]:
            index = (start + delay) % SAMPLES
            length = min(len(value), SAMPLES - index)
            mix[index:index+length, channel] += value[:length] * amount
            mix[:len(value)-length, channel] += value[length:] * amount


def call(f0, f1, length, vibrato=0):
    t = np.arange(round(length * RATE)) / RATE
    u = t / length
    hz = f0 + (f1-f0)*np.sin(np.pi*u/2)**2 + vibrato*np.sin(2*np.pi*5*t)
    phase = np.cumsum(hz) * (2*np.pi/RATE)
    return np.sin(np.pi*u)**1.6 * (np.sin(phase) + .18*np.sin(2*phase+.3))


def ring(freq, length, decay):
    t = np.arange(round(length*RATE))/RATE
    env = np.minimum(1, t/.006)*np.exp(-t/decay)
    return env*(np.sin(2*np.pi*freq*t)+.34*np.sin(2*np.pi*freq*2.71*t))


def render(zone, seed):
    rng = np.random.default_rng(seed)
    mix = np.zeros((SAMPLES, 2))
    sea = zone in ("baa-ardwalk", "old-lighthouse")
    woods = zone in ("hoofington", "whispering-pines", "farm-paddock", "pines-understory")
    for ch in range(2):
        t = CLOCK
        breeze = .5+.23*np.cos(2*np.pi*t/SECONDS*3 + ch*.18)+.13*np.sin(2*np.pi*t/SECONDS*7)
        if sea:
            swell = (.5+.5*np.cos(2*np.pi*t/SECONDS*(4 if zone=="old-lighthouse" else 6)+.24*ch))**1.6
            mix[:, ch] += (.032+.082*swell)*air(rng,65,470) + .043*swell**2*air(rng,850,3050)
        elif zone == "the-dam":
            mix[:, ch] += .073*air(rng, 80, 560) + .027*breeze*air(rng,1250,3800)
            for harmonic in [1, 2, 4]:
                mix[:, ch] += .035/harmonic*np.sin(2*np.pi*(49+2/SECONDS)*harmonic*t+ch*.14)
        elif woods or zone == "mt-gigga":
            mix[:, ch] += (.015 if woods else .032)*breeze*air(rng,110,680)
            mix[:, ch] += (.019 if woods else .045)*breeze**3*air(rng,700,2950)
        else:
            mix[:, ch] += .021*air(rng, 60, 430) + .006*breeze*air(rng,500,1600)
    def spot(at, wave, pan, level):
        stereo(mix, at, wave, pan, level)
    if zone in ("hoofington", "whispering-pines", "mt-gigga"):
        for at in ([1.4,8.3,16.1,26.2] if zone=="hoofington" else [2.6,12.4,22.7]):
            pan = rng.uniform(-.82,.82)
            f = rng.uniform(1850,2950) if zone!="mt-gigga" else 920
            for j in range(2 if zone!="mt-gigga" else 1):
                spot(at+j*.29, call(f, f*(1.32-.36*j), .18+j*.05,35),pan,.07)
        if zone=="hoofington":
            spot(18.9, foley("goat-bleat",.86),-.66,.13)
            spot(7,foley("build-place",.79),.62,.086)
        if zone=="whispering-pines":
            spot(15.6,foley("break-wood",.76),-.78,.09)
    if zone=="farm-paddock":
        for at, pan, pitch in [(3.4,-.67,.86),(17.5,.48,1.18),(25.0,-.36,.94)]:
            spot(at,foley("goat-bleat",pitch),pan,.19)
        for at in [6.5,6.94,9.1,21.8,22.25]:
            spot(at,foley("footstep-grass",.88),.42,.18)
        spot(13.8,foley("headbutt-wood",.77),-.65,.11)
    if zone=="pines-understory":
        for at in [1.7,14.1,23.4]:
            for j in range(5):
                spot(at+j*.079,ring(715+j*6,.045,.008),-.62,.11-j*.008)
        for at,pan in [(7.2,.46),(18.7,-.36),(27.5,.64)]:
            spot(at,call(2420,1680,.26,36),pan,.084)
    if sea:
        for at in [3.7,15.4,24.8]:
            spot(at,call(880 if zone=="baa-ardwalk" else 720,510,.55,75),rng.uniform(-.75,.75),.083)
        if zone=="old-lighthouse":
            for at in [9.2,22.85]:
                spot(at,ring(386,2.7,.71),-.6,.10)
        else:
            for at in [6,6.45,6.96,18.8,19.36]:
                spot(at,foley("footstep-wood",.85),.68,.19)
    if zone=="crane-yard":
        for at in [2.2,2.55,11.3,19.5,20.2,28]:
            spot(at,foley("headbutt-metal",rng.uniform(.67,.91)),.63,.22)
        for at in [5.4,17.1]:
            spot(at,call(115,164,2.15,3),-.57,.085)
    if zone=="downtown-bleatsville":
        for at in [2.2,13.6,23.4]:
            t=np.arange(3.65*RATE)/RATE
            engine=call(118,63,3.65,1)+.32*call(236,126,3.65,2)
            for ch,pan in enumerate([-.68,.62]):
                spot(at+ch*.81,engine,pan,.057)
        for at in [8.2,8.72,9.18,26.4]:
            spot(at,foley("hoof-step-stone",.75),-.5,.14)
    if zone=="the-dam":
        for at in rng.uniform(0,SECONDS,145):
            f=rng.uniform(700,2200)
            spot(at,ring(f,.04,.011),rng.uniform(-.8,.8),rng.uniform(.009,.034))
    # Match level by perceived energy. A short circular crossfade removes the random bed seam.
    blend=RATE//3
    phase=np.linspace(0,1,blend)[:,None]
    mix[:blend]=phase*mix[:blend]+(1-phase)*mix[-blend:]
    mix=mix[:-blend]
    mix *= min(.76/np.max(abs(mix)),.098/np.sqrt(np.mean(mix**2)))
    out=ROOT/"src/audio/assets/ambience"/(zone+".mp3")
    out.parent.mkdir(parents=True,exist_ok=True)
    subprocess.run(["ffmpeg","-loglevel","error","-y","-f","f32le","-ar",str(RATE),"-ac","2",
                    "-i","pipe:0","-c:a","libmp3lame","-b:a","112k",str(out)],
                   input=mix.astype("<f4").tobytes(),check=True)


if __name__=="__main__":
    for i,zone in enumerate(ZONES):
        render(zone,481+i)
