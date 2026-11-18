import * as THREE from 'three';
import { createGoatCharacter, type GoatCharacter } from '../character';
import type { Game, GoatVisualCue } from './Game';

const FEET = ['frontLeft', 'frontRight', 'backLeft', 'backRight'] as const;
const PLANE_FRONT = new THREE.Vector3(0, 0, 1);

/**
 * The only goat artwork in the game scene. The character lane owns its sculpt
 * and samples the existing seven Rapier bodies; this adapter owns scene/lifetime.
 * No visual object or cosmetic action creates or advances physics.
 */
export class GameCharacters {
  readonly player: GoatCharacter;
  readonly bots = new Map<string, GoatCharacter>();
  private readonly pendingCues: GoatVisualCue[] = [];
  private readonly frustum = new THREE.Frustum();
  private readonly cameraMatrix = new THREE.Matrix4();
  private readonly testPoint = new THREE.Vector3();
  private readonly contactPose = new THREE.Object3D();
  private readonly hoof = new THREE.Vector3();
  private readonly legRotation = new THREE.Quaternion();
  private readonly groundNormal = new THREE.Vector3();
  private readonly contacts = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1),
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        varying vec2 vUv;
        void main() {
          float shade = 1.0 - smoothstep(0.075, 0.49, length(vUv - 0.5));
          gl_FragColor = vec4(0.11, 0.08, 0.06, shade * 0.39);
        }`,
    }), FEET.length);
  private readonly offCue: () => void;

  constructor(private readonly scene: THREE.Scene, private readonly game: Game) {
    this.player = createGoatCharacter(game.goat);
    this.contacts.name = 'player hoof contacts';
    this.contacts.frustumCulled = false;
    this.contacts.count = 0;
    this.scene.add(this.player.root, this.contacts);
    // Commands can execute before a new bot has been added to this render scene.
    // Buffer visual-only cues until the next render-frame roster sync.
    this.offCue = game.onVisualCue(cue => { this.pendingCues.push(cue); });
  }

  update(dt: number, alpha: number, camera?: THREE.Camera, drawDistance = Infinity): void {
    if (camera) {
      camera.updateMatrixWorld();
      this.cameraMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      this.frustum.setFromProjectionMatrix(this.cameraMatrix);
    }
    for (const [id, character] of this.bots) {
      if (this.game.party.bots.get(id)?.goat === character.physics) continue;
      character.dispose();
      this.bots.delete(id);
    }
    for (const [id, bot] of this.game.party.bots) {
      if (this.bots.has(id)) continue;
      const character = createGoatCharacter(bot.goat);
      this.scene.add(character.root);
      this.bots.set(id, character);
    }
    for (const { goatId, action } of this.pendingCues) {
      const character = goatId === this.game.goat.id ? this.player : this.bots.get(goatId);
      character?.play(action, action === 'glide' ? .18 : action === 'headbutt' ? .5 : .7);
    }
    this.pendingCues.length = 0;
    this.player.update(dt, alpha);
    this.updateContacts(alpha);
    for (const character of this.bots.values()) {
      let visible = true;
      if (camera) {
        const position = character.physics?.torso.translation();
        if (position) {
          this.testPoint.set(position.x, position.y, position.z);
          const distanceSq = camera.position.distanceToSquared(this.testPoint);
          visible = distanceSq < drawDistance * drawDistance &&
            (distanceSq < 25 * 25 || this.frustum.containsPoint(this.testPoint));
        } else visible = false;
      }
      character.root.visible = visible;
      if (visible) character.update(dt, alpha);
    }
  }

  private updateContacts(alpha: number): void {
    const goat = this.game.goat;
    const ground = goat.locomotion.groundHit;
    this.contacts.count = 0;
    if (!ground || ground.normal.y < .65 || !goat.locomotion.grounded ||
        goat.pose !== 'stand' || goat.isRagdoll) return;
    const { size } = goat;
    const { point, normal } = ground;
    this.groundNormal.set(normal.x, normal.y, normal.z);
    this.contactPose.quaternion.setFromUnitVectors(PLANE_FRONT, this.groundNormal);
    this.contactPose.scale.set(.40 * size, .42 * size, 1);
    for (const part of FEET) {
      const { translation, rotation } = this.game.physics.getInterpolatedTransform(goat.getPart(part), alpha);
      this.legRotation.set(rotation.x, rotation.y, rotation.z, rotation.w);
      this.hoof.set(0, -.38 * size, 0).applyQuaternion(this.legRotation);
      this.hoof.x += translation.x;
      this.hoof.y += translation.y;
      this.hoof.z += translation.z;
      const y = point.y - ((this.hoof.x - point.x) * normal.x +
        (this.hoof.z - point.z) * normal.z) / normal.y;
      if (this.hoof.y > y + .38 * size) continue;
      this.contactPose.position.set(this.hoof.x, y + .018 * size, this.hoof.z);
      this.contactPose.updateMatrix();
      this.contacts.setMatrixAt(this.contacts.count++, this.contactPose.matrix);
    }
    this.contacts.instanceMatrix.needsUpdate = true;
  }

  /** Release art/event subscriptions before Game tears down its Rapier world. */
  dispose(): void {
    this.offCue();
    this.pendingCues.length = 0;
    this.contacts.removeFromParent();
    this.contacts.geometry.dispose();
    this.contacts.material.dispose();
    this.player.dispose();
    for (const character of this.bots.values()) character.dispose();
    this.bots.clear();
  }
}
