"""Render the two original eight-bar pressings. Requires NumPy, SciPy and SoundFile."""
from pathlib import Path
import numpy as np
import soundfile as sf
from scipy.signal import butter, sosfilt

RATE = 32000
OUT = Path(__file__).resolve().parents[1] / 'src/audio/assets/nonis'


def band(signal, low, high):
    return sosfilt(butter(2, [low, high], btype='bandpass', fs=RATE, output='sos'), signal)


def guitar(freq, length, mute, detune, rng):
    t = np.arange(int(length * RATE)) / RATE
    chord = np.zeros_like(t)
    for ratio, pick in [(1, .21), (1.498, .16), (2, .2)]:
        f = freq * ratio * detune
        # Pick position suppresses selected harmonics; higher partials decay fastest.
        for n in range(1, 13):
            env = np.exp(-t * ((9 if mute else 1.65) + .44 * n))
            chord += np.sin(2*np.pi*f*n*t + n*.08) * np.sin(n*pick*np.pi) * env / n
    noise = band(rng.normal(0, .12, len(t)), 1700, 6200) * np.exp(-t*135)
    amp = np.tanh((chord+noise)*4.8)
    cab = band(amp, 95, 3800) + .28*band(amp, 650, 1600)
    return cab * np.minimum(1,t/.002) * np.minimum(1,(length-t)/.024)


def drum(kind, rng):
    length = {'kick':.23,'snare':.23,'hat':.095,'crash':.85,'tom':.31}[kind]
    t = np.arange(int(length*RATE))/RATE
    noise = rng.normal(0,1,len(t))
    if kind == 'kick':
        return np.sin(2*np.pi*(48*t+1.65*(1-np.exp(-t*48))))*np.exp(-t*17) + .14*noise*np.exp(-t*380)
    if kind == 'snare':
        return .57*band(noise,580,7000)*np.exp(-t*22) + .47*np.sin(2*np.pi*182*t)*np.exp(-t*30)
    if kind == 'tom':
        return .85*np.sin(2*np.pi*(94*t+.8*(1-np.exp(-t*23))))*np.exp(-t*15)
    return band(noise,5600,13500)*np.exp(-t*(48 if kind=='hat' else 5.8))


def render(side):
    rng=np.random.default_rng(724 + side)
    mix=np.zeros((RATE*16,2))
    def strike(at, waveform, left, right):
        start=int(at*RATE)
        count=min(len(waveform),len(mix)-start)
        if count>0: mix[start:start+count] += waveform[:count,None]*np.array([left,right])
    for bar in range(8):
        origin=bar*2
        root=([0,0,3,-2,0,5,3,-2] if side==0 else [0,5,7,3,0,8,7,5])[bar]
        notes=([(0,0,.27),(.375,0,.105),(.5,0,.17),(.75,0,.16),(1,3,.31),(1.5,2,.18),(1.75,0,.20)]
               if side==0 else [(0,0,.60),(.75,7,.2),(1,3,.43),(1.5,5,.23),(1.75,7,.23)])
        for beat,interval,length in notes:
            freq=(73.416 if side==0 else 82.407)*2**((root+interval)/12)
            for channel, cents in [(0,.9976),(1,1.0021)]:
                take=guitar(freq,length,length<.25,cents,rng)
                strike(origin+beat+.006*channel,take,.34 if channel==0 else .045,.34 if channel==1 else .045)
            t=np.arange(int(length*RATE))/RATE
            bass=np.tanh(1.75*(np.sin(np.pi*freq*t)+.28*np.sin(2*np.pi*freq*t)))
            strike(origin+beat,bass*np.exp(-t*3)*np.minimum(1,(length-t)/.022),.32,.32)
        for beat in ([0,.375,1,1.25] if bar%2==0 else [0,.75,1,1.625,1.75]):
            strike(origin+beat,drum('kick',rng),.72,.72)
        for beat in [.5,1.5]:strike(origin+beat,drum('snare',rng),.65,.61)
        for i in range(8):
            v=.21 if i%2==0 else .13
            strike(origin+i*.25,drum('hat',rng),v*.8,v)
        strike(origin,drum('crash',rng),.29,.37)
        if bar in (3,7):
            for i in range(3):strike(origin+1.625+i*.125,drum('tom',rng),.40-i*.07,.26+i*.07)
        if side:
            # Harmonised lead only on the unlocked side.
            for i,interval in enumerate([12,15,19,17]):
                f=164.81*2**((root+interval)/12);t=np.arange(int(.43*RATE))/RATE
                phase=2*np.pi*f*t+.72*np.sin(2*np.pi*5.4*t)
                note=band(np.tanh(2*(np.sin(phase)+.35*np.sin(2*phase))),430,4100)
                strike(origin+i*.5,note*np.exp(-t*5)*np.minimum(1,t/.016)*np.minimum(1,(.43-t)/.03),.12,.14)
    mix=np.tanh(mix*1.27)*.84
    mix[-RATE//10:] *= np.linspace(1,0,RATE//10)[:,None]
    return mix


if __name__=='__main__':
    OUT.mkdir(parents=True,exist_ok=True)
    for side,name in enumerate(['basalt-teeth','midnight-molt']):
        sf.write(OUT/(name+'.ogg'),render(side),RATE,format='OGG',subtype='VORBIS')
