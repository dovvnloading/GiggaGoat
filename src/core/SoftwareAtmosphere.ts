import * as THREE from 'three';
import { cloudSample, type IslandWeather } from '../world/island-weather';
import { pixel, type SoftwareFrame } from './SoftwareFrame';

const ease = THREE.MathUtils.smoothstep;

/** Use reciprocal scene depth to keep distant haze off the goat and nearby props. */
export class SoftwareAtmosphere {
  private palette = new Uint8Array(64 * 3 * 256);
  private lastGrade = -Infinity;
  private readonly start = new THREE.Vector3();
  private readonly end = new THREE.Vector3();

  sky(frame: SoftwareFrame, camera: THREE.Camera, weather: IslandWeather, horizon: number): void {
    const { width, height } = frame.image;
    const { time, phase, cloud } = weather;
    const altitude = -Math.cos(phase * 2 * Math.PI), day = ease(altitude, -.22, .45);
    const gold = 1 - ease(Math.abs(altitude - .14), .02, .40);
    const storm = ease(cloud, .45, .95);
    const base = [horizon >> 16, (horizon >> 8) & 255, horizon & 255];
    const top = [26 + 38*day + 65*gold, 35 + 115*day - 32*gold, 77 + 145*day - 48*gold];
    const e = camera.matrixWorld.elements, p = camera.projectionMatrix.elements;
    // Sample the upper hemisphere in small spans; opaque geometry then overwrites these pixels.
    for (let y = 0; y < height; y += 3) {
      const v = (1 - 2*y/height + p[9]) / p[5];
      const row = y * width;
      for (let x = 0; x < width; x += 5) {
        const u = (2*x/width - 1 + p[8]) / p[0];
        const rx = e[0]*u + e[4]*v - e[8], ry = e[1]*u + e[5]*v - e[9], rz = e[2]*u + e[6]*v - e[10];
        const h = Math.max(0,ry) / Math.hypot(rx,ry,rz);
        const grad = ease(h, -.04, .83) * (1 - .67*storm);
        const reach = 140 / Math.max(.05,ry);
        const density = h > .004 ? cloudSample((e[12]+rx*reach)*.0018+time*.00052,
          (e[14]+rz*reach)*.0018-time*.00019) : 0;
        const edge = .69-cloud*.38;
        const mass = ease(density,edge-.07,edge+.08)*ease(h,.002,.115)*.88;
        const light = (.29+.71*day)*(1-.30*storm);
        const r = base[0]!+(top[0]!-base[0]!)*grad, g = base[1]!+(top[1]!-base[1]!)*grad;
        const b = base[2]!+(top[2]!-base[2]!)*grad;
        frame.pixels.fill(pixel(r+(222*light-r)*mass,g+((232-22*gold)*light-g)*mass,
          b+((247-48*gold)*light-b)*mass),row+x,row+Math.min(width,x+5));
      }
      for (let dy = 1; dy < 3 && y+dy < height; dy++) frame.pixels.copyWithin(row+dy*width,row,row+width);
    }
  }

  grade(frame: SoftwareFrame, weather: IslandWeather, horizon: number, density: number): void {
    if (Math.abs(weather.time - this.lastGrade) >= .9) {
      this.lastGrade = weather.time;
      const altitude = -Math.cos(weather.phase*2*Math.PI), daylight = ease(altitude,-.18,.50);
      const gold = 1-ease(Math.abs(altitude-.12),.04,.38), storm = ease(weather.cloud,.46,.96);
      const levels = [.56+.44*daylight+.05*gold-.15*storm, .63+.37*daylight-.045*gold-.10*storm,
        .80+.2*daylight-.14*gold-.06*storm];
      for (let band = 0; band < 64; band++) {
        const haze = 1-Math.exp(-((band*4*density)**2));
        for (let c = 0; c < 3; c++) {
          const sky = (horizon >> (16-8*c)) & 255;
          for (let i = 0; i < 256; i++) this.palette[band*768+c*256+i] =
            Math.min(255, i*levels[c]!*(1-haze)+sky*haze);
        }
      }
    }
    const {pixels,depth} = frame, lut = this.palette;
    for (let i = 0; i < pixels.length; i++) {
      const iz = depth[i]!;
      if (iz <= 0) continue;
      const k = Math.min(63, (.25 / iz) | 0) * 768, c = pixels[i]!;
      pixels[i] = pixel(lut[k+(c&255)]!,lut[k+256+((c>>>8)&255)]!,lut[k+512+((c>>>16)&255)]!);
    }
  }

  drops(frame: SoftwareFrame, lines: THREE.LineSegments, camera: THREE.Camera): void {
    const attr = lines.geometry.getAttribute('position'), {width,height} = frame.image;
    for (let i = 0; i < lines.geometry.drawRange.count; i += 2) {
      const a = this.start.fromBufferAttribute(attr,i).applyMatrix4(camera.matrixWorldInverse);
      const b = this.end.fromBufferAttribute(attr,i+1).applyMatrix4(camera.matrixWorldInverse);
      if (a.z > -.65 || b.z > -.65) continue;
      const iz = -1/a.z;
      a.applyMatrix4(camera.projectionMatrix); b.applyMatrix4(camera.projectionMatrix);
      if (Math.abs(a.x)>1 || Math.abs(a.y)>1) continue;
      const x = (a.x*.5+.5)*width, y = (.5-a.y*.5)*height;
      const dx = (b.x-a.x)*width*.5, dy = (a.y-b.y)*height*.5;
      const n = Math.max(1, Math.ceil(Math.max(Math.abs(dx),Math.abs(dy))));
      for (let k=0; k<n; k++) {
        const col=Math.floor(x+dx*k/n), row=Math.floor(y+dy*k/n);
        if (col<0 || row<0 || col>=width || row>=height) continue;
        const j=row*width+col;
        if (iz <= frame.depth[j]!) continue;
        const c=frame.pixels[j]!;
        frame.pixels[j] = pixel((c&255)*.70+55, ((c>>>8)&255)*.70+62, ((c>>>16)&255)*.70+70);
      }
    }
  }
}
