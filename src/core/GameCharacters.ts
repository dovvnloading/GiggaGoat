import * as THREE from 'three';
import { createGoatCharacter, type GoatCharacter } from '../character';
import type { Game, GoatVisualCue } from './Game';

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
  private readonly offCue: () => void;

  constructor(private readonly scene: THREE.Scene, private readonly game: Game) {
    this.player = createGoatCharacter(game.goat);
    this.scene.add(this.player.root);
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
    for (const character of this.bots.values()) {
      let visible = true;
      if (camera) {
        const position = character.physics.torso.translation();
        this.testPoint.set(position.x, position.y, position.z);
        const distanceSq = camera.position.distanceToSquared(this.testPoint);
        visible = distanceSq < drawDistance * drawDistance &&
          (distanceSq < 25 * 25 || this.frustum.containsPoint(this.testPoint));
      }
      character.root.visible = visible;
      if (visible) character.update(dt, alpha);
    }
  }

  /** Release art/event subscriptions before Game tears down its Rapier world. */
  dispose(): void {
    this.offCue();
    this.pendingCues.length = 0;
    this.player.dispose();
    for (const character of this.bots.values()) character.dispose();
    this.bots.clear();
  }
}
