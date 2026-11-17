import * as THREE from 'three';

/** All HUD collision tests use viewport/screen coordinates, not CSS percentages. */
export interface ScreenRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface HudPanelRect { id: string; rect: ScreenRect }
export interface HudPromptSize { id: string; width: number; height: number }
export interface GoatSafeHudLayout {
  hiddenPanels: Set<string>;
  prompts: Map<string, ScreenRect>;
}

export function rectsIntersect(a: ScreenRect, b: ScreenRect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

const expand = (r: ScreenRect, padding: number): ScreenRect => ({
  left: r.left - padding, top: r.top - padding,
  right: r.right + padding, bottom: r.bottom + padding,
});

/** Measure only artwork that is actually visible: the dormant glider, tongue,
 * and GIGGA aura must not make the small KID goat appear screen-filling. */
export function visibleGoatBounds(root: THREE.Object3D, output = new THREE.Box3()): THREE.Box3 {
  output.makeEmpty();
  const part = new THREE.Box3();
  root.updateWorldMatrix(true, true);
  root.traverseVisible(object => {
    if (!(object instanceof THREE.Mesh)) return;
    const geometry = object.geometry;
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    if (geometry.boundingBox) {
      output.union(part.copy(geometry.boundingBox).applyMatrix4(object.matrixWorld));
    }
  });
  return output;
}

/** Project the actual sculpt's world-space bounding box through the live camera.
 * If the camera intersects the box, conservatively protect the entire viewport
 * rather than projecting corners behind the near plane to bogus locations. */
export function projectGoatScreenBox(bounds: THREE.Box3, camera: THREE.PerspectiveCamera,
  viewport: ScreenRect): ScreenRect | null {
  if (bounds.isEmpty() || viewport.right <= viewport.left || viewport.bottom <= viewport.top) {
    return null;
  }
  camera.updateWorldMatrix(true, false);
  const point = new THREE.Vector3();
  const inCamera = new THREE.Vector3();
  let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
  for (const x of [bounds.min.x, bounds.max.x]) {
    for (const y of [bounds.min.y, bounds.max.y]) {
      for (const z of [bounds.min.z, bounds.max.z]) {
        point.set(x, y, z);
        if (inCamera.copy(point).applyMatrix4(camera.matrixWorldInverse).z >= -camera.near) {
          return { ...viewport };
        }
        point.project(camera);
        const px = viewport.left + (point.x + 1) * (viewport.right - viewport.left) / 2;
        const py = viewport.top + (1 - point.y) * (viewport.bottom - viewport.top) / 2;
        if (!Number.isFinite(px) || !Number.isFinite(py)) return { ...viewport };
        left = Math.min(left, px); right = Math.max(right, px);
        top = Math.min(top, py); bottom = Math.max(bottom, py);
      }
    }
  }
  const clipped = {
    left: Math.max(viewport.left, left), top: Math.max(viewport.top, top),
    right: Math.min(viewport.right, right), bottom: Math.min(viewport.bottom, bottom),
  };
  return clipped.right > clipped.left && clipped.bottom > clipped.top ? clipped : null;
}

/** Prefer the mockup's fixed corner panels. An encroaching panel is hidden
 * without reflow; prompts are stacked immediately above the goat, or hidden
 * when the camera/viewport leaves no genuinely clear space. */
export function planGoatSafeHud(goat: ScreenRect, viewport: ScreenRect,
  panels: readonly HudPanelRect[], prompts: readonly HudPromptSize[]): GoatSafeHudLayout {
  const hiddenPanels = new Set<string>();
  const placed = new Map<string, ScreenRect>();
  const protectedGoat = expand(goat, 14);
  const occupied: ScreenRect[] = [];
  for (const panel of panels) {
    const box = expand(panel.rect, 8); // borders, labels and drop shadows
    if (rectsIntersect(protectedGoat, box)) hiddenPanels.add(panel.id);
    else occupied.push(box);
  }

  let above = protectedGoat.top - 10;
  for (const prompt of prompts) {
    const width = prompt.width, height = prompt.height;
    if (!(width > 0 && height > 0) || width > viewport.right - viewport.left - 16) continue;
    const center = Math.max(viewport.left + 8 + width / 2,
      Math.min(viewport.right - 8 - width / 2, (goat.left + goat.right) / 2));
    const left = center - width / 2;
    let top = above - height;
    // Try successively higher slots when a fixed HUD panel or earlier prompt
    // occupies the preferred position. Keep these controls out of the goat.
    for (let attempt = 0; attempt <= occupied.length; attempt++) {
      const candidate = { left, top, right: left + width, bottom: top + height };
      const blocker = occupied.find(box => rectsIntersect(candidate, box));
      if (!blocker) break;
      top = Math.min(top, blocker.top - height - 10);
    }
    const box = { left, top, right: left + width, bottom: top + height };
    if (top < viewport.top + 8 || rectsIntersect(box, protectedGoat) ||
      occupied.some(used => rectsIntersect(box, used))) continue;
    placed.set(prompt.id, box);
    occupied.push(expand(box, 8));
    above = top - 10;
  }
  return { hiddenPanels, prompts: placed };
}
