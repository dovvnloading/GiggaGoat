"""Bounce four original instrumental arrangements. Usage: python arrange-island-score.py /path/to/GeneralUser-GS.sf2

Uses numpy, scipy, soundfile, tinysoundfont and ffmpeg. The Suno masters supply a
short, unpitched rhythmic texture in each regional arrangement. All notes, voicings,
accents and form below are authored for gameplay. The rendered files loop on a barline.
"""
from pathlib import Path
import sys
import subprocess
import numpy as np
from scipy import signal
import soundfile as sf
from tinysoundfont import Synth

ROOT = Path(__file__).resolve().parents[2] / "src/audio/assets/music"
RATE = 44100
# Notes are relative to the tonic. Each cell is one bar of the lead line.
FARM = [[(0,4,.65),(1,7,.36),(1.55,9,.34),(2,7,.8)],[(.55,2,.36),(1,4,.83),(2.5,0,.9)],
        [(0,7,.45),(.75,9,.38),(1.5,12,.85),(3,9,.4)],[(.5,7,.35),(1,4,.64),(2,2,1.2)]]
TOWN = [[(.5,0,.34),(1.25,3,.25),(1.75,5,.5),(3,7,.44)],[(0,10,.55),(1.5,7,.33),(2.25,5,.68)],
        [(.25,3,.34),(1,5,.32),(1.75,7,.45),(2.75,10,.75)],[(.5,5,.37),(1.5,3,.46),(2.5,0,.88)]]
COAST = [[(0,7,1.4),(2,9,.7),(3,4,.72)],[(.5,2,1.1),(2,0,1.64)],
         [(0,4,1),(1.5,7,.75),(2.75,11,.8)],[(.25,9,.7),(1.5,7,.75),(2.75,2,.97)]]
PARTY = [[(0,0,.3),(.75,7,.3),(1.5,10,.43),(2.5,12,.5),(3.5,7,.26)],
         [(.5,5,.36),(1.25,3,.32),(2,0,.65),(3,3,.34)],
         [(0,5,.35),(.75,7,.29),(1.5,12,.81),(3,10,.35)],
         [(.5,7,.4),(1.25,5,.35),(2,3,.36),(2.75,0,.85)]]
# (name, existing source, tempo, tonic, melody, lead, rhythm, bass, countervoice, chord roots)
SCORES = [
    ("gate-latch-reel","hoofington-hop",108,62,FARM,71,24,32,45,[0,5,2,7,0,9,5,7]),
    ("switchyard-shuffle","crane-yard-rumble",119,60,TOWN,11,4,33,65,[0,5,0,7,3,5,8,7]),
    ("glasswater","lanterns-over-billy-isle",82,65,COAST,73,46,32,11,[0,9,5,7,2,5,7,0]),
    ("last-bale-standing","crane-yard-rumble",139,62,PARTY,57,1,33,12,[0,3,5,7,0,8,5,7]),
]


def suno_texture(name, n):
    audio, sr = sf.read(ROOT / (name+".mp3"), always_2d=True)
    # Separate the percussive attack from tonal content, then make a short brushed pickup.
    audio = signal.sosfilt(signal.butter(4, 3300, fs=sr, btype="highpass", output="sos"),audio,axis=0)
    window=round(sr*.075)
    candidates=np.arange(sr*4,sr*18,window)
    start=max(candidates,key=lambda i:np.mean(audio[i:i+window]**2))
    clip=signal.resample(audio[start:start+window],n,axis=0)
    return clip*np.hanning(n)[:,None]/max(.001,np.max(abs(clip)))


def render(index, spec):
    name, source, bpm, tonic, motif, lead, rhythm, bass, answer, roots = spec
    swing = [.11,.145,.025,.055][index]
    rng = np.random.default_rng(7191+index)
    synth = Synth(gain=-9,samplerate=RATE)
    font=synth.sfload(sys.argv[1])
    for ch,program,pan in [(0,lead,69),(1,rhythm,44),(2,bass,64),(3,answer,88),(9,0,64)]:
        synth.program_select(ch,font,128 if ch==9 else 0,program,is_drums=ch==9)
        synth.control_change(ch,10,pan)
    bars=24
    samples=round(bars*4*60/bpm*RATE)
    events=[]
    def frame(beat):
        return round(beat*60/bpm*RATE)
    def note(ch, beat, duration, pitch, velocity):
        delay=swing if abs(beat%1-.5)<.01 else 0
        on=max(0,frame(beat+delay)+round(rng.uniform(-.007,.007)*RATE))
        off=on+frame(duration*rng.uniform(.96,1.025))
        events.extend([(on,1,ch,pitch,int(np.clip(velocity+rng.integers(-4,5),1,124))),(off,0,ch,pitch,0)])
    for bar in range(bars):
        b=bar*4
        # A (8 bars), contrasting B (8), return with an answering instrument and a turn-around.
        section=bar//8
        rel=roots[(bar+(3 if section==1 else 0))%8]
        root=tonic+rel
        minor = rel in ([2,9] if index in (0,2) else [0,5])
        third=3 if minor else 4
        if index==2:
            for j,offset in enumerate([0,.75,1.5,2.25,3.25]):
                note(1,b+offset,.85,root+[-12,-5,third,7,2][j],48+(j==0)*7)
        else:
            strokes=([.5,1.5,2.5,3.5] if index==0 else [.75,1.5,2.75,3.5])
            for offset in strokes:
                for j,pitch in enumerate([third,7,10 if index==1 else 12]):
                    note(1,b+offset+j*.015,.19 if index!=0 else .27,root+pitch-12,50+4*(offset>2))
        for j,offset in enumerate([0,2] if index!=3 else [0,1.5,2,3.25]):
            note(2,b+offset,1.20 if index==2 else .56,root-24+(0 if j%2==0 else 7),74 if j==0 else 65)
        if bar%4==3 and index!=2:
            note(2,b+3.58,.27,tonic+roots[(bar+1)%8]-25,58)
        lead_line=motif[(bar+(1 if section==1 else 0))%4]
        for tm,p,dur in lead_line:
            if section==1:
                # Let the second voice carry the bridge in a lower register.
                note(3,b+tm,dur*1.06,tonic+p+(5 if bar%4<2 else 0),65)
            elif bar%8!=6:
                note(0,b+tm,dur,tonic+p+(12 if index==2 else 0),77 if bar%2==0 else 69)
        if bar%4==3 or (section==2 and bar%2==0):
            for tm,p in [(2.6,third),(3.35,2)]:
                note(3,b+tm,.34,root+p+12,51)
        if index!=2:
            for q in [0,2.5] if index!=3 else [0,1.5,2,3.5]:
                note(9,b+q,.12,36,65 if q==0 else 48)
            for q in [1,3]:
                note(9,b+q,.12,37 if index==0 else 38,54 if index!=3 else 65)
            for q in np.arange(.5,4,.5 if index==3 else 1):
                note(9,b+q,.10,42 if index!=0 else 70,35+(q==3.5)*11)
        elif bar%2:
            note(9,b+3.5,.15,69,31)
    # Render the release across the end and fold it over the beginning for a musical loop.
    length=samples+RATE*2
    audio=np.zeros((length,2))
    cursor=0
    for pos,active,ch,pitch,velocity in sorted(events)+[(length,0,0,0,0)]:
        if pos>cursor:
            audio[cursor:pos]=np.frombuffer(synth.generate_simple(pos-cursor),dtype=np.float32).reshape(-1,2)
            cursor=pos
        if active: synth.noteon(ch,pitch,velocity)
        else: synth.noteoff(ch,pitch)
    audio[:RATE*2]+=audio[samples:]
    audio=audio[:samples]
    brush=suno_texture(source,round(RATE*.084))
    for bar in range(bars):
        for beat in ([3.5] if index==2 else [.5,2.5]):
            k=frame(bar*4+beat+swing)
            audio[k:k+len(brush)]+=brush*(.009 if index==2 else .019)
    # A short stereo room blends the close instruments while preserving the attack.
    dry=audio.copy()
    for delay,gain in [(.029,.08),(.045,.065),(.079,.04),(.109,.025)]:
        audio+=np.roll(dry[:,::-1],round(delay*RATE),axis=0)*gain
    audio *= min(.88/np.max(abs(audio)),.134/np.sqrt(np.mean(audio**2)))
    proc=subprocess.run(["ffmpeg","-loglevel","error","-y","-f","f32le","-ar",str(RATE),
                         "-ac","2","-i","pipe:0","-c:a","libmp3lame","-b:a","160k",
                         str(ROOT/(name+".mp3"))],input=audio.astype("<f4").tobytes(),check=True)
    print(name,round(samples/RATE,2))


if __name__=="__main__":
    for i,spec in enumerate(SCORES):
        render(i,spec)
