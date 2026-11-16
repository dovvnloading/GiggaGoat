import type { ChallengeTracker, CudWallet, EventBus } from '../gameplay';
import type { GigAward } from './types';
import { GigDirector } from './engine';

/**
 * The only bridge to the existing economy. Call after each completed gig and
 * snapshot this director together with GameSimulation / CudWallet.
 *
 * The challenge tracker has no public "complete gig" method. Its legitimate
 * public progress path is the gameplay EventBus; only verified achievements
 * with an existing equivalent are forwarded here. If the host already forwarded
 * these same physics achievements to gameplay, set forwardChallenges to false.
 */
export class GigGameplayBridge {
  constructor(
    private readonly director: GigDirector,
    private readonly wallet: CudWallet,
    private readonly challenges: ChallengeTracker,
    private readonly gameplayEvents: EventBus,
    private readonly forwardChallenges = true,
  ) {}
  settle(): GigAward[] {
    const delivered: GigAward[] = [];
    for (const award of this.director.pendingAwards) {
      // Wallet credit validates integer bounds; never ACK if it throws.
      this.wallet.credit(award.coins, 'gig:' + award.gigId + ':' + award.rating);
      this.director.acknowledgeAward(award.attemptId);
      delivered.push(award);
      if (!this.forwardChallenges) continue;
      if (award.gigId === 'demolition-contract' &&
        !this.challenges.getProgress('wrecking-crew').completed) {
        // Real displaced tower mass, verified by the gig evaluator.
        this.gameplayEvents.emit('style:scored', {
          trick: 'destruction', points: 1, comboPoints: 1, comboCount: 1,
          distinct: 1, multiplier: 1, title: 'Demolition Contract', meter: 0,
        });
      }
      if (award.gigId === 'summit-sprint' &&
        !this.challenges.getProgress('mountain-goat').completed) {
        const metres = this.director.active?.attemptId === award.attemptId
          ? this.director.active.metrics.climbed : 0;
        if (metres > 0) this.gameplayEvents.emit('traversal', { kind: 'climb', metres });
      }
    }
    return delivered;
  }
}
