import type { GigConfig } from '../gigs';
import { HUD_SPRITES, hudSpriteImage, type HudSpriteName } from './HudSprites';

const OFFER_ICONS: Record<Exclude<GigConfig['kind'], 'mow-down'>, HudSpriteName> = {
  'hay-haul': HUD_SPRITES.hayFloor,
  'rooftop-express': HUD_SPRITES.markerHousePink,
  'demolition-contract': HUD_SPRITES.suppliesCrate,
  'escort-the-gnome': HUD_SPRITES.markerTreePine,
  'stack-up': HUD_SPRITES.suppliesCrate,
  'summit-sprint': HUD_SPRITES.mapPin,
  'splash-dive': HUD_SPRITES.launchPad,
};

export function gigBoardIcon(kind: GigConfig['kind']): string {
  return kind === 'mow-down'
    ? '<span class="gg-board-icon gg-board-grass" aria-hidden="true">☘︎</span>'
    : hudSpriteImage(OFFER_ICONS[kind], 'gg-board-icon');
}

export function gigBoardGoal(config: GigConfig): string {
  switch (config.kind) {
    case 'hay-haul': return 'Deliver ' + config.required + ' bales';
    case 'rooftop-express': return 'Cross ' + config.checkpoints.length + ' rooftop checkpoints';
    case 'demolition-contract': return 'Move ' + Math.round(config.requiredFraction * 100) + '% of the tower mass';
    case 'mow-down': return 'Graze ' + config.patches.length + ' grass patches';
    case 'escort-the-gnome': return 'Escort through ' + config.route.length + ' flags';
    case 'stack-up': return 'Stack ' + config.requiredLayers + ' crates';
    case 'summit-sprint': {
      const climb = config.minimumClimb > 0 ? 'Climb ' + config.minimumClimb + ' m through ' : 'Reach ';
      return climb + config.checkpoints.length + ' checkpoints' + (config.requiresBleat ? ' and bleat' : '');
    }
    case 'splash-dive': return (config.requiresFlop ? 'Flop' : 'Splash') + ' from a ' + config.minDrop + ' m drop';
  }
}
