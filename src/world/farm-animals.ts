import * as THREE from 'three';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { fitLibraryModel } from './library-fit';
import type { HoofPlacement } from './visual-hoofington';

export const FARM_ANIMALS = new Set(['cow', 'horse', 'sheep', 'pig']);

/** Keep the kit's bind transforms, skin weights and native materials intact. */
export function createFarmAnimal(asset: GLTF, place: HoofPlacement, index: number) {
  const skin = cloneSkeleton(asset.scene);
  const stand = asset.animations.find(clip => /(^|\|)Idle$/.test(clip.name));
  if (!stand) throw new Error('Missing authored idle for ' + place.model);
  const mixer = new THREE.AnimationMixer(skin);
  const idle = mixer.clipAction(stand).play();
  const eat = asset.animations.find(clip => clip.name === 'Eating');
  const grazing = eat && mixer.clipAction(eat);
  const phase = (index * .381966 + .19) % 1;
  idle.time = phase * stand.duration;
  mixer.update(0);
  skin.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(skin, true);
  const fit = fitLibraryModel(bounds.getSize(new THREE.Vector3()), new THREE.Vector3().copy(place.size), '');
  const center = bounds.getCenter(new THREE.Vector3());
  const pivot = new THREE.Group();
  pivot.add(skin);
  skin.position.sub(new THREE.Vector3(center.x, bounds.min.y, center.z));
  pivot.scale.copy(fit.scale);
  pivot.rotation.y = place.yaw + fit.yaw;
  pivot.position.copy(place.position);
  pivot.position.y -= place.size.y / 2;
  pivot.name = 'livestock-' + place.model;
  const bones = new Set<THREE.Skeleton>();
  skin.traverse(object => {
    if (object instanceof THREE.SkinnedMesh) {
      object.frustumCulled = false;
      object.receiveShadow = true;
      bones.add(object.skeleton);
    }
  });
  pivot.updateMatrixWorld(true);
  let feeding = false, last = NaN;
  return {
    root: pivot,
    update(time: number) {
      const dt = Number.isFinite(last) ? THREE.MathUtils.clamp(time - last, 0, .12) : 0;
      last = time;
      if (!pivot.visible || dt === 0) return;
      const feedingNow = (time + phase * 24) % 24 < 10;
      if (grazing && feedingNow !== feeding) {
        const next = feedingNow ? grazing : idle, previous = feedingNow ? idle : grazing;
        next.reset().play().crossFadeFrom(previous, .65, false);
        feeding = feedingNow;
      }
      mixer.update(dt);
    },
    dispose() {
      mixer.stopAllAction();
      mixer.uncacheRoot(skin);
      for (const skeleton of bones) skeleton.dispose();
      pivot.removeFromParent();
    },
  };
}
