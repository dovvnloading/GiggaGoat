import * as THREE from 'three';
import type { CharacterPart } from './motion';

/** Art-specific object references. Every vertex lives in Billy-sized BODY-LOCAL coordinates. */
export interface Ribbon {
  readonly geometry: THREE.BufferGeometry;
  readonly length: number;
  readonly width: number;
  readonly offset: number;
}
export interface GoatMesh {
  readonly root: THREE.Group;
  readonly parts: Record<CharacterPart, THREE.Group>;
  readonly torsoFur: THREE.Group;
  readonly headFur: THREE.Group;
  readonly ears: readonly [THREE.Group, THREE.Group];
  readonly eyebrows: readonly [THREE.Group, THREE.Group];
  readonly eyelids: readonly [THREE.Mesh, THREE.Mesh];
  readonly horns: readonly [THREE.Group, THREE.Group];
  readonly jaw: THREE.Group;
  readonly mouthOpening: THREE.Mesh;
  readonly tongue: THREE.Mesh;
  readonly tongueTip: THREE.Mesh;
  readonly scarf: readonly [Ribbon, Ribbon];
  readonly tail: THREE.Group;
  readonly glider: THREE.Group;
  readonly aura: readonly [THREE.Mesh, THREE.Mesh];
  readonly purpleLight: THREE.PointLight;
  readonly mounts: Readonly<Record<'head' | 'neck' | 'back', THREE.Group>>;
  dispose(): void;
}
type Point = readonly [number, number, number];

export function sculptGoat(): GoatMesh {
  const root = new THREE.Group();
  root.name = 'Gigga-Goat | seven-body sculpt';
  const sphere = new THREE.SphereGeometry(1, 16, 12);
  const owned = new Set<THREE.BufferGeometry>([sphere]);
  const ink = new THREE.MeshBasicMaterial({ color: 0x4a302b, side: THREE.BackSide });
  const skinInk = new THREE.MeshBasicMaterial({ color: 0x584037, side: THREE.BackSide });
  const materials = new Set<THREE.Material>([ink, skinInk]);
  const toon = (color: number, extra: THREE.MeshToonMaterialParameters = {}): THREE.MeshToonMaterial => {
    const mat = new THREE.MeshToonMaterial({ color, ...extra });
    materials.add(mat);
    return mat;
  };
  const wool = toon(0xf4e6ce);
  const ivory = toon(0xfff5e2);
  const shade = toon(0xe0c8a6);
  const milk = toon(0xfffcf0);
  const hornTan = toon(0xd8943f);
  const hornRidge = toon(0xf2b357);
  const hornDark = toon(0xaf692c);
  const hoof = toon(0x3f3536);
  const hoofTop = toon(0x6a5350);
  const pink = toon(0xdb9791);
  const nose = toon(0xc98275);
  const iris = toon(0xe7ad22);
  const pupil = toon(0x30251d);
  const mouthDark = toon(0x4c252b);
  const tonguePink = toon(0xf05286);
  const orange = toon(0xf36e06);
  const redOrange = toon(0xd64d00);
  const gold = toon(0xffcc19);
  const wood = toon(0xc48b41);
  const attach = (parent: THREE.Object3D, geometry: THREE.BufferGeometry,
    material: THREE.Material, name: string): THREE.Mesh => {
    owned.add(geometry);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };
  const blob = (
    parent: THREE.Object3D, name: string, mat: THREE.Material, xyz: Point,
    radii: Point, outlined = false,
  ): THREE.Mesh => {
    const mesh = attach(parent, sphere, mat, name);
    mesh.position.set(...xyz);
    mesh.scale.set(...radii);
    if (outlined) {
      const rim = new THREE.Mesh(sphere, mat === pink || mat === nose ? skinInk : ink);
      rim.name = name + ' ink silhouette';
      rim.scale.setScalar(1.057);
      rim.castShadow = false;
      rim.receiveShadow = false;
      mesh.add(rim);
    }
    return mesh;
  };
  const group = (parent: THREE.Object3D, name: string, xyz?: Point): THREE.Group => {
    const result = new THREE.Group();
    result.name = name;
    if (xyz) result.position.set(...xyz);
    parent.add(result);
    return result;
  };
  const curveLine = (
    parent: THREE.Object3D, name: string, points: Point[], radius: number,
    material: THREE.Material,
  ): THREE.Mesh => {
    const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)));
    return attach(parent, new THREE.TubeGeometry(curve, Math.max(12, points.length * 5),
      radius, 7, false), material, name);
  };
  const fleeceTip = (
    parent: THREE.Object3D, xyz: Point, radii: Point, angle = 0,
    tint: THREE.Material = ivory,
  ): void => {
    const puff = blob(parent, 'tapered fleece lock', tint, xyz, radii);
    puff.rotation.z = angle;
    const tip = attach(parent, new THREE.ConeGeometry(radii[0] * .64,
      radii[1] * 1.35, 6), tint, 'pointed wool tip');
    tip.position.set(xyz[0], xyz[1] - radii[1] * .65, xyz[2] + radii[2] * .17);
    tip.rotation.z = angle + Math.PI;
    tip.castShadow = true;
  };
  const parts: Record<CharacterPart, THREE.Group> = {
    torso: group(root, 'ragdoll torso'),
    neck: group(root, 'ragdoll neck'),
    head: group(root, 'ragdoll head'),
    frontLeft: group(root, 'ragdoll front-left'),
    frontRight: group(root, 'ragdoll front-right'),
    backLeft: group(root, 'ragdoll hind-left'),
    backRight: group(root, 'ragdoll hind-right'),
  };
  const torsoFur = group(parts.torso, 'squash-only coat');
  blob(torsoFur, 'voluminous barrel chest', wool, [0, .005, .01],
    [.365, .305, .56], true);
  blob(torsoFur, 'rounded breast', ivory, [0, .115, -.34],
    [.315, .245, .28]);
  blob(torsoFur, 'warm underbelly', shade, [0, -.215, .09],
    [.295, .10, .445]);
  blob(torsoFur, 'raised rump', wool, [0, .12, .39],
    [.315, .24, .29]);
  // Offset rows of teardrop locks make a scalloped, furry silhouette in every view.
  for (const side of [-1, 1]) {
    for (let row = 0; row < 3; row++) {
      for (let column = 0; column < 6; column++) {
        const z = -.43 + column * .165 + (row % 2) * .037;
        const y = .18 - row * .15 + .018 * Math.sin(column * 3.1 + row);
        const x = side * (.307 + (row === 1 ? .028 : 0));
        fleeceTip(torsoFur, [x, y, z],
          [.074 + .01 * (column % 2), .086 + row * .008, .088],
          side * .13, (column + row) % 4 === 0 ? shade : ivory);
      }
    }
    for (let i = 0; i < 4; i++) {
      fleeceTip(torsoFur, [side * (.14 + i * .045), -.18, -.37 + i * .20],
        [.075, .09, .075], side * .17, ivory);
    }
  }
  const tail = group(torsoFur, 'wagging cotton tail', [0, .17, .54]);
  blob(tail, 'tail tuft', ivory, [0, .055, .08], [.14, .145, .16], true);
  for (let i = 0; i < 5; i++) {
    const a = i * Math.PI * 2 / 5;
    blob(tail, 'tail fluff', milk,
      [Math.sin(a) * .092, .08 + Math.cos(a) * .085, .14],
      [.066, .087, .086]);
  }

  for (const side of [-1, 1]) {
    for (const fore of [true, false]) {
      const key: CharacterPart =
        fore ? (side < 0 ? 'frontLeft' : 'frontRight') :
          (side < 0 ? 'backLeft' : 'backRight');
      const limb = parts[key];
      blob(limb, 'stocky leg', wool, [0, .095, 0], [.126, .31, .137], true);
      blob(limb, 'cream shaggy cuff', ivory, [0, -.11, -.013], [.145, .184, .152]);
      for (let i = 0; i < 5; i++) {
        const theta = (i / 5) * Math.PI * 2;
        fleeceTip(limb,
          [Math.cos(theta) * .105, -.17, Math.sin(theta) * .102],
          [.059, .105, .058], Math.cos(theta) * .14);
      }
      blob(limb, 'hoof ankle', hoofTop, [0, -.29, -.005],
        [.115, .10, .13]);
      for (const split of [-1, 1]) {
        const toe = blob(limb, 'dark split hoof', hoof,
          [split * .059, -.355, -.05], [.066, .078, .11], true);
        toe.rotation.x = -.11;
      }
      curveLine(limb, 'cleft between hoof toes',
        [[0, -.40, -.153], [0, -.353, -.154], [0, -.319, -.12]],
        .008, pupil);
    }
  }

  const neck = parts.neck;
  blob(neck, 'shaggy upright neck', ivory, [0, -.025, -.015],
    [.22, .275, .238], true);
  for (const side of [-1, 1]) {
    for (let i = 0; i < 5; i++) {
      fleeceTip(neck, [side * (.10 + i * .016), -.11 - i * .024, -.08 + i * .07],
        [.071, .118, .085], side * .13);
    }
  }
  const head = parts.head;
  const headFur = group(head, 'head animation secondary coat');
  blob(headFur, 'large cream cranium', wool, [0, .02, .04],
    [.27, .245, .265], true);
  blob(headFur, 'beige cheek left', shade, [-.175, -.083, -.136],
    [.12, .12, .145]);
  blob(headFur, 'beige cheek right', shade, [.175, -.083, -.136],
    [.12, .12, .145]);
  blob(headFur, 'big friendly muzzle', milk, [0, -.106, -.22],
    [.205, .145, .19], true);
  blob(headFur, 'soft pink nose pad', nose, [0, -.116, -.384],
    [.145, .081, .037]);
  for (const side of [-1, 1]) {
    blob(headFur, 'nostril', mouthDark,
      [side * .085, -.11, -.417], [.020, .018, .008]);
    blob(headFur, 'muzzle highlight', ivory,
      [side * .12, -.074, -.37], [.035, .026, .018]);
  }

  const jaw = group(headFur, 'hinged smile and bleating jaw', [0, -.186, -.23]);
  const mouthOpening = blob(jaw, 'open dark mouth', mouthDark, [0, -.036, -.127],
    [.137, .020, .07]);
  blob(jaw, 'inner tongue', tonguePink, [0, -.068, -.175],
    [.084, .02, .024]);
  blob(jaw, 'lower jaw and chin', milk, [0, -.102, -.07],
    [.151, .068, .115], true);
  curveLine(headFur, 'upturned mouth corners',
    [[-.166, -.190, -.283], [-.119, -.217, -.344], [0, -.223, -.363],
      [.119, -.217, -.344], [.166, -.190, -.283]], .013, mouthDark);
  // Three tapered locks under the chin read as the billy-goat beard from 3/4.
  for (let i = -1; i <= 1; i++) {
    fleeceTip(jaw, [i * .061, -.157, -.027],
      [.052, .143 - Math.abs(i) * .029, .062], i * .11, ivory);
  }

  const eyebrows: [THREE.Group, THREE.Group] = [
    group(headFur, 'left eyebrow control', [-.156, .167, -.207]),
    group(headFur, 'right eyebrow control', [.156, .167, -.207]),
  ];
  const eyelids: [THREE.Mesh, THREE.Mesh] = [
    new THREE.Mesh(sphere, wool), new THREE.Mesh(sphere, wool),
  ];
  const ears: [THREE.Group, THREE.Group] = [
    group(headFur, 'left floppy ear pivot', [-.248, .054, .065]),
    group(headFur, 'right floppy ear pivot', [.248, .054, .065]),
  ];
  for (const [index, side] of [-1, 1].entries()) {
    blob(headFur, 'oval ivory eyeball',
      milk, [side * .166, .085, -.185], [.095, .103, .084], true);
    blob(headFur, 'gold horizontal-pupil iris', iris,
      [side * .180, .077, -.257], [.048, .064, .022]);
    blob(headFur, 'GOAT horizontal pupil', pupil,
      [side * .183, .082, -.277], [.035, .010, .012]);
    blob(headFur, 'tiny eye glint', milk,
      [side * .197 - .012, .105, -.283], [.012, .016, .008]);
    const eyebrow = eyebrows[index]!;
    curveLine(eyebrow, 'expressive curved brow',
      [[-.073, -.015, .005], [-.031, .030, -.015],
        [.023, .032, -.018], [.074, -.009, .003]], .025, hornDark);
    const lid = eyelids[index]!;
    lid.name = 'blinking upper eyelid';
    lid.position.set(side * .166, .152, -.250);
    lid.scale.set(.098, .010, .031);
    lid.castShadow = false;
    headFur.add(lid);
    const ear = ears[index]!;
    const outer = blob(ear, 'long floppy ear', wool,
      [side * .150, -.050, .015], [.198, .082, .105], true);
    outer.rotation.z = side * -.19;
    const inner = blob(ear, 'peach ear interior', pink,
      [side * .177, -.041, -.052], [.131, .041, .045]);
    inner.rotation.z = side * -.20;
    blob(ear, 'ear folded tip', ivory, [side * .302, -.081, .032],
      [.071, .058, .071]);
  }
  // Forelock is a fluffy wavy little fringe, not short hair painted on the skull.
  for (let i = -2; i <= 2; i++) {
    fleeceTip(headFur, [i * .073, .232 + .033 * (2 - Math.abs(i)), -.151],
      [.064, .078, .076], .21 * i, i % 2 === 0 ? milk : ivory);
  }

  const makeHorn = (side: number): THREE.Group => {
    const pivot = group(headFur, side < 0 ? 'left curled ram horn' : 'right curled ram horn',
      [side * .17, .148, .067]);
    const pts = [
      [0, .015, -.04], [side * .115, .17, -.065],
      [side * .20, .330, .002], [side * .255, .358, .164],
      [side * .27, .245, .317], [side * .24, .09, .30],
      [side * .19, .045, .18], [side * .13, .150, .102],
    ] as Point[];
    const curve = new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(...p)),
      false, 'catmullrom', .42);
    const longitudinal = 60, radial = 10;
    const geometry = new THREE.TubeGeometry(curve, longitudinal, 1, radial, false);
    const attr = geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i <= longitudinal; i++) {
      const t = i / longitudinal;
      const centre = curve.getPointAt(t);
      const radius = .087 * (1 - t * .82) + .007;
      for (let j = 0; j <= radial; j++) {
        const idx = i * (radial + 1) + j;
        const vertex = new THREE.Vector3().fromBufferAttribute(attr, idx);
        vertex.sub(centre).multiplyScalar(radius).add(centre);
        attr.setXYZ(idx, vertex.x, vertex.y, vertex.z);
      }
    }
    attr.needsUpdate = true;
    geometry.computeVertexNormals();
    attach(pivot, geometry, hornTan, 'heavy tapered spiral horn');
    // Fine circumferential ridges like the approved golden, banded ram horns.
    for (let i = 1; i <= 16; i++) {
      const t = i / 18;
      const r = .087 * (1 - t * .82) + .009;
      const ring = attach(pivot,
        new THREE.TorusGeometry(r, i % 4 === 0 ? .012 : .0075, 5, 12),
        i % 4 === 0 ? hornDark : hornRidge, 'horn growth ring');
      ring.position.copy(curve.getPointAt(t));
      const tangent = curve.getTangentAt(t).normalize();
      ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), tangent);
    }
    return pivot;
  };
  const horns: [THREE.Group, THREE.Group] = [makeHorn(-1), makeHorn(1)];

  // Scarlet-orange collar with layered wraps, golden embroidery and two free tails.
  const scarfGeo = new THREE.TorusGeometry(.215, .062, 8, 30);
  const collar = attach(neck, scarfGeo, orange, 'thick orange infinity scarf');
  collar.position.y = .10;
  collar.rotation.x = Math.PI / 2;
  const wrap = attach(neck, new THREE.TorusGeometry(.22, .048, 8, 28),
    redOrange, 'lower scarf wrap');
  wrap.position.y = .031;
  wrap.rotation.x = Math.PI / 2;
  blob(neck, 'orange scarf knot', orange, [0, -.06, -.207], [.108, .094, .087], true);
  const flap = blob(neck, 'front scarf tab', orange, [0, -.180, -.241],
    [.093, .150, .035]);
  flap.rotation.z = -.16;
  blob(neck, 'yellow embroidery', gold, [.015, -.245, -.273],
    [.055, .018, .010]);
  const ribbons: Ribbon[] = [];
  const makeRibbon = (offset: number, length: number, width: number): void => {
    const geometry = new THREE.BufferGeometry();
    const count = 12;
    const coords = new Float32Array((count + 1) * 2 * 3);
    const colors = new Float32Array(coords.length);
    const indices: number[] = [];
    for (let i = 0; i < count; i++) {
      const a = 2 * i;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    for (let i = 0; i <= count; i++) {
      const u = i / count;
      for (let edge = 0; edge < 2; edge++) {
        // Offset by edge to make a bold diagonal chevron, not flat gold stripes.
        const stripe = u > .70 && u < .97 && Math.floor((u + edge * .045) * 22) % 6 < 3;
        const color = new THREE.Color(stripe ? 0xffd52a : 0xf36a05);
        const j = (i * 2 + edge) * 3;
        colors[j] = color.r; colors[j + 1] = color.g; colors[j + 2] = color.b;
      }
    }
    geometry.setAttribute('position', new THREE.BufferAttribute(coords, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    const material = toon(0xffffff, { vertexColors: true, side: THREE.DoubleSide });
    const ribbon = attach(neck, geometry, material, 'wind-swept scarf ribbon');
    ribbon.frustumCulled = false;
    ribbons.push({ geometry, length, width, offset });
    // Open, pointed tassels at the fabric ends.
    for (const j of [-1, 0, 1]) {
      const tassel = blob(neck, 'yellow scarf fringe', gold,
        [offset + j * width * .36, .13, .23 + length],
        [.018, .032, .065]);
      tassel.rotation.x = -.35;
    }
  };
  makeRibbon(.07, .86, .16);
  makeRibbon(-.075, .63, .105);

  const mounts = {
    head: group(headFur, 'cosmetic mount | head', [0, .255, -.035]),
    neck: group(neck, 'cosmetic mount | neck', [0, .07, -.21]),
    back: group(torsoFur, 'cosmetic mount | back', [0, .31, .06]),
  } as const;

  // A sample mountable wing is rendered only for the GLIDE art pose.
  // It is scenery/cosmetic, not a collider or a flight controller.
  const glider = group(mounts.back, 'optional hang-glider cosmetic');
  const sailMaterial = toon(0xf68d0e, { side: THREE.DoubleSide });
  const sailShape = new THREE.BufferGeometry();
  sailShape.setAttribute('position', new THREE.Float32BufferAttribute([
    0, .71, -.64,  -1.55, .45, .42,  0, .53, .27,
    0, .71, -.64,   0, .53, .27,  1.55, .45, .42,
  ], 3));
  sailShape.setIndex([0, 1, 2, 3, 4, 5]);
  sailShape.computeVertexNormals();
  attach(glider, sailShape, sailMaterial, 'orange double-delta sail');
  const rod = (a: Point, b: Point, radius: number, name: string): void => {
    const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b);
    const mid = start.clone().add(end).multiplyScalar(.5);
    const mesh = attach(glider,
      new THREE.CylinderGeometry(radius, radius, start.distanceTo(end), 7),
      wood, name);
    mesh.position.copy(mid);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0),
      end.sub(start).normalize());
  };
  rod([-1.55, .45, .42], [1.55, .45, .42], .032, 'bamboo spreader');
  rod([0, .71, -.64], [-1.55, .45, .42], .028, 'left wing spar');
  rod([0, .71, -.64], [1.55, .45, .42], .028, 'right wing spar');
  rod([0, .05, -.15], [0, .60, -.18], .02, 'harness rope');
  glider.visible = false;

  const tongue = attach(headFur,
    new THREE.CylinderGeometry(.041, .061, 1, 8, 1),
    tonguePink, 'elastic 3D tongue tether');
  tongue.visible = false;
  const tongueTip = blob(headFur, 'sticky tongue tip', tonguePink,
    [0, -.18, -.31], [.075, .051, .078]);
  tongueTip.visible = false;

  const auraMaterial = new THREE.MeshBasicMaterial({
    color: 0x8544e9, transparent: true, opacity: .14,
    blending: THREE.AdditiveBlending, side: THREE.BackSide, depthWrite: false,
  });
  materials.add(auraMaterial);
  const auraBody = blob(parts.torso, 'GIGGA violet aura', auraMaterial,
    [0, 0, 0], [.47, .4, .70]);
  const auraHead = blob(head, 'GIGGA horn halo', auraMaterial,
    [0, .12, .04], [.45, .50, .48]);
  auraBody.renderOrder = 1;
  auraHead.renderOrder = 1;
  auraBody.visible = false;
  auraHead.visible = false;
  const purpleLight = new THREE.PointLight(0x9c5cff, 0, 2.6);
  purpleLight.position.set(0, .25, .05);
  parts.torso.add(purpleLight);

  const dispose = (): void => {
    root.removeFromParent();
    for (const geometry of owned) geometry.dispose();
    for (const material of materials) material.dispose();
    purpleLight.dispose();
  };
  // Fill initially so no one sees an uninitialized ribbon before update().
  for (const ribbon of ribbons) animateRibbon(ribbon, 0);
  return {
    root, parts, torsoFur, headFur, ears, eyebrows, eyelids, horns, jaw, mouthOpening,
    tongue, tongueTip, scarf: [ribbons[0]!, ribbons[1]!],
    tail, glider, aura: [auraBody, auraHead], purpleLight,
    mounts, dispose,
  };
}

/** Deforms lightweight fabric only; no changes to the Rapier neck rigid body. */
export function animateRibbon(ribbon: Ribbon, time: number, airflow = 0): void {
  const count = 12;
  const p = ribbon.geometry.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i <= count; i++) {
    const t = i / count;
    const sway = Math.sin(time * 7.2 - t * 4.6 + ribbon.offset * 4);
    const wave = Math.sin(time * 5 - t * 7.8);
    const midX = ribbon.offset + .13 * t + sway * (.075 + airflow * .10) * t;
    const midY = .12 + .17 * t + wave * (.06 + airflow * .05) * t;
    const midZ = .23 + ribbon.length * t;
    const half = ribbon.width * (1 - t * .16) * .5;
    p.setXYZ(2 * i, midX - half, midY, midZ);
    p.setXYZ(2 * i + 1, midX + half, midY + .015 * t, midZ);
  }
  p.needsUpdate = true;
  ribbon.geometry.computeVertexNormals();
}
