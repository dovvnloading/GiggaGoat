import * as THREE from 'three';

export const BAKERY_NAME = "EAP'S Bakery";

// The marquee and the projecting blade share the baker's scored loaf mark.
function loaf(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  ctx.moveTo(-23, 7);
  ctx.bezierCurveTo(-31, -3, -19, -16, -6, -17);
  ctx.bezierCurveTo(11, -21, 27, -14, 27, -2);
  ctx.bezierCurveTo(27, 12, -11, 19, -23, 7);
  for (const x of [-10, 0, 10]) {
    ctx.moveTo(x - 3, -9);
    ctx.quadraticCurveTo(x + 2, -7, x + 3, -2);
  }
  ctx.stroke();
}

function tube(ctx: CanvasRenderingContext2D, color: string, draw: () => void): void {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.shadowColor = color;
  ctx.shadowBlur = 9;
  ctx.strokeStyle = color;
  ctx.lineWidth = 4;
  draw();
  ctx.shadowBlur = 0;
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = '#fff5dd';
  draw();
}

export function paintBakeryMarquee(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(w / 512, h / 80);
  ctx.fillStyle = '#2a1428';
  ctx.fillRect(0, 0, 512, 80);
  ctx.strokeStyle = '#ad6659';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.roundRect(6, 5, 500, 70, 11); ctx.stroke();
  ctx.translate(53, 41);
  tube(ctx, '#ffab37', () => loaf(ctx));
  ctx.translate(49, 0);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.font = 'bold 55px Georgia';
  tube(ctx, '#ff527f', () => ctx.strokeText("EAP'S", 0, 0, 176));
  ctx.font = 'italic bold 52px Georgia';
  tube(ctx, '#ffb947', () => ctx.strokeText('Bakery', 182, 0, 190));
  ctx.restore();
}

/** A metal blade perpendicular to the street, with an illuminated face on each side. */
export function bakeryBlade(bounds: THREE.Box3, world: (p: THREE.Vector3) => THREE.Vector3) {
  const centre = bounds.getCenter(new THREE.Vector3());
  const mount = world(new THREE.Vector3(bounds.min.x, centre.y, bounds.max.z));
  const outward = world(new THREE.Vector3(bounds.min.x, centre.y, bounds.max.z + 1)).sub(mount).normalize();
  const height = world(new THREE.Vector3(bounds.min.x, bounds.max.y, bounds.max.z)).distanceTo(mount) * 2;
  const group = new THREE.Group();
  group.name = 'eaps-projecting-neon-loaf';
  group.position.copy(mount);
  group.rotation.y = Math.atan2(outward.x, outward.z);
  group.scale.setScalar(height);
  const metal = new THREE.MeshStandardMaterial({ color: 0x593b48, metalness: .45, roughness: .6 });
  const bracket = new THREE.Mesh(new THREE.BoxGeometry(.12,.13,1.8), metal);
  bracket.position.set(0, .58, .84);
  group.add(bracket);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 192;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#302037';
  ctx.fillRect(0, 0, 192, 192);
  ctx.translate(96, 96);
  ctx.scale(2.55, 2.55);
  tube(ctx, '#ff4577', () => { ctx.beginPath(); ctx.arc(0,0,33,0,Math.PI*2); ctx.stroke(); });
  tube(ctx, '#ffae3e', () => loaf(ctx));
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const face = new THREE.MeshBasicMaterial({ map: texture, toneMapped: false });
  const disk = new THREE.Mesh(new THREE.CylinderGeometry(.75,.75,.16,40), metal);
  disk.rotation.z = Math.PI / 2;
  disk.position.set(0,-.18,1.36);
  group.add(disk);
  for (const side of [-1, 1]) {
    const lens = new THREE.Mesh(new THREE.CircleGeometry(.73,40), face);
    lens.rotation.y = side * Math.PI / 2;
    lens.position.set(side * .083,-.18,1.36);
    group.add(lens);
  }
  return group;
}
