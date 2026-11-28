import * as THREE from 'three';
import upstairsUrl from './assets/downtown/upstairs.webp?url';
import { BAKERY_NAME } from './bakery-sign';
import { facadeTransform } from './library-fit';
import { hashString } from './random';
import type { DowntownModel, DowntownPlacement } from './visual-downtown';

// Bounds of the recessed street-facing panes, measured in the source GLBs.
// The stone surrounds, balcony rails and glazing bars sit in front of these surfaces.
type Pane = readonly [left: number, right: number, sill: number, head: number, front: number];
const bays: Partial<Record<DowntownModel, { work: Pane; home?: Pane }>> = {
  bakery:     { work: [-.22821, -.12821, .51, .65, .42395], home: [.17179, .27179, .91, 1.05, .42395] },
  cornerShop: { work: [.215, .315, .55, .65, .43], home: [.215, .315, .95, 1.05, .43] },
  kayShop:    { work: [.17179, .27179, .55, .65, .505] },
  cinema:     { work: [-.25, -.15, .51, .65, .37] },
  cafe:       { work: [.5, .7, .55, .65, .42395] },
  market:     { work: [.165, .365, .55, .65, .381], home: [.165, .365, 1.35, 1.45, .381] },
  boutique:   { work: [.37179, .47179, .42, .65, .48], home: [-.02821, .07179, .95, 1.05, .58] },
  arcade:     { work: [-.02821, .07179, .51, .65, .391], home: [.77179, .87179, .91, 1.05, .391] },
  kayHouse:   { work: [-.3, -.1, .55, .65, .435], home: [.1, .3, 1.35, 1.45, .435] },
  townhouse:  { work: [-.015, .145, .95, 1.05, .641], home: [.385, .545, 1.75, 1.85, .641] },
  brickHouse: { work: [-.45, -.35, .95, 1.05, .579], home: [.35, .45, 2.15, 2.25, .579] },
};

const room = { oven: 0, band: 1, projector: 2, plants: 3, tailor: 4, reading: 5, books: 6, pinball: 7 };
const tenants: Record<string, number> = {
  [BAKERY_NAME]: room.oven, GOATFLIX: room.projector, BOUTIQUE: room.tailor, 'KID ARCADE': room.pinball,
  FLOWERS: room.plants, BOOKS: room.books, CAFE: room.reading,
  'ICE CREAM': room.reading, 'HAY MART': room.plants, 'HOOF & CO': room.tailor,
};
const homes = [room.reading, room.plants, room.books, room.tailor];

/** Only the actual venues can turn on the oven or play the rehearsal lights. */
export function upstairsGeometry(
  placements: readonly DowntownPlacement[], models: ReadonlyMap<string, THREE.Group>, recordLot?: string,
): THREE.BufferGeometry | null {
  const positions: number[] = [], uvs: number[] = [];
  const indices: number[][] = [[], [], []];
  for (const place of placements) {
    const bay = bays[place.model], source = place.source, model = models.get(place.model);
    if (!bay || !model || !source || (source.kind !== 'shop' && source.kind !== 'house')) continue;
    const world = facadeTransform(place, model);
    if (!world) continue;
    const address = hashString(source.id) % homes.length;
    const tile = source.id === recordLot ? room.band : tenants[place.storefront ?? ''] ?? homes[address]!;
    const addPane = ([left, right, sill, head, front]: Pane, painting: number) => {
      const lower = world(new THREE.Vector3(left, sill, front));
      const aspect = lower.distanceTo(world(new THREE.Vector3(right, sill, front))) /
        lower.distanceTo(world(new THREE.Vector3(left, head, front)));
      const first = positions.length / 3;
      // Crop wide and narrow openings to a square painting without stretching the props.
      for (const [u, v] of [[0, 0], [1, 0], [1, 1], [0, 1]] as const) {
        const p = world(new THREE.Vector3(u ? right : left, v ? head : sill, front + .0003));
        positions.push(p.x, p.y, p.z);
        const s = .5 + (u - .5) * Math.min(1, aspect) * .96;
        const t = .5 + (v - .5) * Math.min(1, 1 / aspect) * .96;
        uvs.push(((painting % 4) + s) / 4, (1 - Math.floor(painting / 4) + t) / 2);
      }
      const light = painting === room.oven ? 1 : painting === room.band ? 2 : 0;
      indices[light]!.push(first, first + 1, first + 2, first, first + 2, first + 3);
    };
    // The record counter's tall marquee covers the lower bay from the pavement.
    if (tile === room.band && bay.home) {
      addPane(bay.home, tile);
      continue;
    }
    addPane(bay.work, tile);
    if (bay.home) {
      const next = homes[address] === tile ? (address + 1) % homes.length : address;
      addPane(bay.home, homes[next]!);
    }
  }
  if (!positions.length) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices.flat());
  let start = 0;
  indices.forEach((group, light) => {
    if (group.length) geometry.addGroup(start, group.length, light);
    start += group.length;
  });
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function roomMaterial(map: THREE.Texture): THREE.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial({ map, polygonOffset: true, polygonOffsetFactor: -1 });
  material.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
varying vec3 roomEye;`).replace('#include <begin_vertex>', `#include <begin_vertex>
vec3 eye = cameraPosition - (modelMatrix * vec4(position, 1.)).xyz;
vec3 outward = normalize(mat3(modelMatrix) * normal);
roomEye = vec3(dot(eye, vec3(outward.z, 0., -outward.x)), eye.y, dot(eye, outward));`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 roomEye;`).replace('#include <map_fragment>', `
vec2 grid = vec2(4., 2.);
vec2 address = floor(vMapUv * grid);
vec2 pane = fract(vMapUv * grid);
// Looking past a sash reveals a different part of the recessed room.
vec2 direction = clamp(roomEye.xy / max(roomEye.z, .01), -1., 1.);
vec2 inside = clamp(.5 + (pane - .5) * .82 - .083 * direction, .018, .982);
vec3 interior = texture2D(map, (address + inside) / grid).rgb;
float grazing = 1. - clamp(normalize(roomEye).z, 0., 1.);
diffuseColor.rgb *= mix(interior, vec3(.16, .21, .23), .06 + .55 * grazing * grazing);`);
  };
  material.customProgramCacheKey = () => 'downtown-room-glass';
  return material;
}

export function buildUpstairsRooms(
  placements: readonly DowntownPlacement[], sources: ReadonlyMap<string, THREE.Group>, recordLot?: string,
) {
  const geometry = upstairsGeometry(placements, sources, recordLot);
  if (!geometry) return;
  const texture = new THREE.TextureLoader().load(upstairsUrl);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const ordinary = roomMaterial(texture), oven = roomMaterial(texture), band = roomMaterial(texture);
  const mesh = new THREE.Mesh(geometry, [ordinary, oven, band]);
  mesh.name = 'downtown-upstairs-rooms';
  mesh.visible = false;
  return {
    mesh,
    update(daylight: number, nearby: boolean, baking: boolean, recordGlow: number): void {
      mesh.visible = nearby && !!texture.image;
      if (!mesh.visible) return;
      const ambient = .54 + .25 * daylight;
      ordinary.color.setScalar(ambient);
      const fire = baking ? .72 : 0;
      oven.color.setRGB(ambient + fire, ambient + fire * .51, ambient + fire * .18);
      band.color.setRGB(ambient + recordGlow * .72, ambient + recordGlow * .24, ambient + recordGlow * .62);
    },
  };
}
