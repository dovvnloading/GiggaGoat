"""Edit the game's ElevenLabs recordings into a sample-accurate, mono Foley bank."""
import base64
import io
import json
import re
from pathlib import Path

import numpy as np
import soundfile as sf
from scipy import signal

ROOT = Path(__file__).resolve().parents[2] / "src/audio"
RATE = 32000
sources = {}
for key, encoded in re.findall(r"""['"]([\w-]+)['"]:\s*['"]([A-Za-z0-9+/=]+)['"]""", (ROOT/"recorded-effects.ts").read_text()):
    raw,sr=sf.read(io.BytesIO(base64.b64decode(encoded)),always_2d=True)
    raw=raw.mean(axis=1)
    onset=np.where(abs(raw)>max(.003,abs(raw).max()*.032))[0][0]
    raw=raw[max(0,onset-round(sr*.003)):]
    sources[key]=signal.resample(raw,round(RATE*len(raw)/sr))

clips=[]
marks={}
cursor=0

def take(name, dur, pitch=1, tone=10000, start=0):
    raw=sources[name][round(start*RATE):]
    out=signal.resample(raw,max(1,round(len(raw)/pitch)))[:round(RATE*dur)]
    out=signal.sosfilt(signal.butter(2,tone,fs=RATE,output="sos"),out)
    out*=np.minimum(1,np.arange(len(out))/32)
    out*=np.minimum(1,np.arange(len(out))[::-1]/max(1,min(len(out)*.35,RATE*.032)))
    return out

def add(key, layers, target=.58):
    global cursor
    end=max(round(t*RATE)+len(w) for t,w,g in layers)
    mix=np.zeros(end)
    for t,w,g in layers:
        i=round(t*RATE)
        mix[i:i+len(w)]+=g*w
    # Keep room for other voices. Preserve transients without boosting quiet tails.
    mix*=min(target/max(.001,abs(mix).max()),.165/max(.001,np.sqrt(np.mean(mix*mix))))
    marks.setdefault(key,[]).append([cursor/RATE,len(mix)/RATE])
    pad=np.zeros(RATE//50)
    clips.extend([mix,pad])
    cursor+=len(mix)+len(pad)

for material,source in [('grass','footstep-grass'),('sand','footstep-sand'),('wood','footstep-wood'),
                        ('rock','hoof-step-stone'),('metal','footstep-metal'),('water','footstep-water')]:
    for v,(rate,gap) in enumerate([(1.06,.016),(.92,.025),(1.15,.032)]):
        # One cloven contact contains a toe tap and a softer, differently spaced heel/scuff.
        toe=take(source,.082 if material!='metal' else .115,rate,8200-v*700)
        sole=take(source,.115,rate*.84,3100,start=.021+v*.008)
        add('footstep-'+material,[(0,toe,1),(gap,sole,.35)],.51)
        add('jump-'+material,[(0,take(source,.105,rate*.90),.91),
            (.034+v*.003,take('jump',.19,1.12,4000,start=.029),.56)],.63)
        add('landing-'+material,[(0,take(source,.135,rate*.91),.94),
            (.013,take('landing',.18,.92,1750),.91),(.04+v*.005,sole,.38)],.71)

add('ui-click',[(0,take('ui-click',.046,1.05,5400),1)],.42)
add('ui-confirm',[(0,take('ui-click',.033,1.08,6500),.45),
                  (.018,take('ui-confirm',.16,1.13,7600),1)],.55)
add('ui-back',[(0,take('ui-back',.14,1.02,6100),1)],.46)
add('tongue-reel',[(0,take('tongue-reel',.24,1.15,5000),1)],.54)
add('tongue-snap',[(0,take('tongue-snap',.073,1.05,7000),1)],.55)
add('climb',[(0,take('hoof-step-stone',.053,1.11,6000),.7),(.024,take('climb',.19,1.06,4100),1)],.50)
add('trampoline',[(0,take('landing',.09,1,1900),.54),(.019,take('trampoline',.46,1.06),1)],.77)
add('launch-pad',[(0,take('headbutt-metal',.084,.8,4600),.67),(.024,take('flip-whoosh',.27,.88,6800),1)],.78)
add('soda-pop',[(0,take('tongue-snap',.055,1.26),.66),(.013,take('water-flop-splash',.29,1.7,10600,start=.02),1)],.69)
add('domino',[(0,take('headbutt-wood',.13,1.08),1),(.063,take('build-snap',.12,.93,5100),.43)],.56)
add('graze',[(0,take('break-hay',.09,1.13,7000),1),(.064,take('footstep-grass',.09,1.4,4300),.48)],.49)
add('checkpoint',[(0,take('coin',.11,1.12,5500),.58),(.081,take('gig-reward',.20,1.23,7100),.68)],.56)
out=ROOT/"assets/foley"
out.mkdir(parents=True,exist_ok=True)
sf.write(out/"contact-bank.wav",np.concatenate(clips),RATE,subtype="PCM_16")
(out/"contacts.json").write_text(json.dumps(marks,indent=2)+"\n")
