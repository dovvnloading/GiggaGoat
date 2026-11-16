import type { PlayerIntent } from './Game';
import type { PieceType } from '../gameplay';

const PIECES: readonly PieceType[] = ['floor', 'wall', 'ramp', 'launch-pad'];
const axis = (value: number): number => Math.abs(value) < .14 ? 0 :
  Math.sign(value) * (Math.abs(value) - .14) / .86;
const down = (pad: Gamepad, index: number): boolean => pad.buttons[index]?.pressed ?? false;
const trigger = (pad: Gamepad, index: number): boolean => (pad.buttons[index]?.value ?? 0) > .35;

/** Browser-only adapter: no keyboard or Gamepad state leaks into the fixed-step rules. */
export class GameInput {
  private readonly keys = new Set<string>();
  private mousePrimary = false;
  private mouseSecondary = false;
  private buildToggleQueued = false;
  private buildPlaceQueued = false;
  private selected: PieceType | undefined;
  private padToggleWasDown = false;
  private padPlaceWasDown = false;
  private padJumpWasDown = false;
  private padFlingWasDown = false;
  private pendingJump = false;
  private pendingBleat = false;
  private pendingFlop = false;
  private pendingFling = false;
  private readonly unsubscribers: Array<() => void> = [];
  yaw: number;
  pitch = .3;
  debugVisible = false;

  constructor(private readonly canvas: HTMLCanvasElement, initialYaw: number) {
    this.yaw = initialYaw;
    const listen = <K extends keyof (WindowEventMap & DocumentEventMap & HTMLElementEventMap)>(
      target: EventTarget, type: K,
      fn: (event: (WindowEventMap & DocumentEventMap & HTMLElementEventMap)[K]) => void,
    ): void => {
      target.addEventListener(type, fn as EventListener);
      this.unsubscribers.push(() => target.removeEventListener(type, fn as EventListener));
    };
    listen(window, 'keydown', event => {
      if (event.repeat) return;
      const code = event.code;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'F3'].includes(code)) event.preventDefault();
      this.keys.add(code);
      if (code === 'KeyB') this.buildToggleQueued = true;
      if (code === 'F3') this.debugVisible = !this.debugVisible;
      if (code === 'Space') this.pendingJump = true;
      if (code === 'KeyE') this.pendingBleat = true;
      if (code === 'KeyQ') this.pendingFlop = true;
      if (code === 'KeyF') this.pendingFling = true;
      const index = ['Digit1', 'Digit2', 'Digit3', 'Digit4'].indexOf(code);
      if (index >= 0) this.selected = PIECES[index];
    });
    listen(window, 'keyup', event => { this.keys.delete(event.code); });
    listen(window, 'blur', () => { this.reset(); });
    listen(document, 'visibilitychange', () => {
      if (document.hidden) this.reset();
    });
    listen(canvas, 'mousedown', event => {
      if (event.button === 0) {
        this.mousePrimary = true;
        this.buildPlaceQueued = true;
      }
      if (event.button === 2) this.mouseSecondary = true;
      if (document.pointerLockElement !== canvas) void canvas.requestPointerLock();
    });
    listen(window, 'mouseup', event => {
      if (event.button === 0) this.mousePrimary = false;
      if (event.button === 2) this.mouseSecondary = false;
    });
    listen(canvas, 'contextmenu', event => { event.preventDefault(); });
    listen(document, 'mousemove', event => {
      if (document.pointerLockElement !== canvas) return;
      this.yaw -= event.movementX * .0026;
      this.pitch = Math.max(-.22, Math.min(1.15, this.pitch - event.movementY * .0021));
    });
  }

  sample(dt: number, buildMode: boolean): PlayerIntent {
    const pressed = (code: string): boolean => this.keys.has(code);
    let moveX = Number(pressed('KeyD') || pressed('ArrowRight')) -
      Number(pressed('KeyA') || pressed('ArrowLeft'));
    let moveZ = Number(pressed('KeyW') || pressed('ArrowUp')) -
      Number(pressed('KeyS') || pressed('ArrowDown'));
    let sprint = pressed('ShiftLeft') || pressed('ShiftRight');
    let jump = pressed('Space') || this.pendingJump;
    let chargeHeadbutt = this.mousePrimary;
    let tongue = this.mouseSecondary;
    let bleat = pressed('KeyE') || this.pendingBleat;
    let flop = pressed('KeyQ') || this.pendingFlop;
    let flingTongue = pressed('KeyF') || this.pendingFling;
    let toggleBuild = this.buildToggleQueued;
    let placeBuild = this.buildPlaceQueued;
    let buildPiece = this.selected;
    let reelTongue = pressed('KeyR');

    const pad = navigator.getGamepads?.().find(p => p?.connected) ?? null;
    if (pad) {
      const px = axis(pad.axes[0] ?? 0), pz = -axis(pad.axes[1] ?? 0);
      if (Math.hypot(px, pz) > Math.hypot(moveX, moveZ) * .7) {
        moveX = px; moveZ = pz;
      }
      this.yaw -= axis(pad.axes[2] ?? 0) * dt * 2.8;
      this.pitch = Math.max(-.22, Math.min(1.15,
        this.pitch - axis(pad.axes[3] ?? 0) * dt * 1.9));
      sprint ||= down(pad, 5);
      const padJump = down(pad, 0);
      jump ||= padJump;
      if (padJump && !this.padJumpWasDown) this.pendingJump = true;
      this.padJumpWasDown = padJump;
      tongue ||= down(pad, 4) || trigger(pad, 6);
      chargeHeadbutt ||= trigger(pad, 7);
      bleat ||= down(pad, 2);
      flop ||= down(pad, 1);
      const padFling = down(pad, 10);
      flingTongue ||= padFling && !this.padFlingWasDown;
      this.padFlingWasDown = padFling;
      reelTongue ||= down(pad, 11);
      const padToggle = down(pad, 3);
      if (padToggle && !this.padToggleWasDown) toggleBuild = true;
      this.padToggleWasDown = padToggle;
      const chosen = [12, 15, 13, 14].findIndex(i => down(pad, i));
      if (chosen >= 0) buildPiece = PIECES[chosen];
      if (buildMode && chargeHeadbutt && !this.padPlaceWasDown) placeBuild = true;
      this.padPlaceWasDown = chargeHeadbutt;
    } else {
      this.padToggleWasDown = false;
      this.padJumpWasDown = false;
      this.padPlaceWasDown = false;
      this.padFlingWasDown = false;
    }

    const magnitude = Math.hypot(moveX, moveZ);
    if (magnitude > 1) { moveX /= magnitude; moveZ /= magnitude; }
    this.buildToggleQueued = false;
    this.buildPlaceQueued = false;
    this.selected = undefined;
    this.pendingJump = false;
    this.pendingBleat = false;
    this.pendingFlop = false;
    this.pendingFling = false;
    return {
      moveX, moveZ, cameraYaw: this.yaw, sprint, jump, glide: pressed('Space'),
      chargeHeadbutt: !buildMode && chargeHeadbutt, tongue,
      reelTongue, flingTongue, bleat, flop,
      toggleBuild, placeBuild: buildMode && placeBuild, buildPiece,
    };
  }

  private reset(): void {
    this.keys.clear();
    this.mousePrimary = false;
    this.mouseSecondary = false;
    this.pendingJump = this.pendingBleat = this.pendingFlop = this.pendingFling = false;
    this.buildPlaceQueued = false;
  }

  dispose(): void {
    for (const fn of this.unsubscribers.splice(0)) fn();
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
  }
}
