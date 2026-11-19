import type { PlayerIntent } from './Game';
import type { PieceType } from '../gameplay';
import { PLAY_CAMERA_PITCH, clampCameraPitch } from './GoatCamera';

const PIECES: readonly PieceType[] = ['floor', 'wall', 'ramp', 'launch-pad'];
const BUILD_KEYS = ['Digit1', 'Digit2', 'Digit3', 'Digit4'];
const KEYBOARD_CONTROLS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight',
  'KeyI', 'KeyJ', 'KeyK', 'KeyL', 'Space', 'ShiftLeft', 'ShiftRight', 'KeyE', 'KeyF',
  'KeyQ', 'KeyR', 'KeyV', 'KeyX', 'KeyG', 'KeyB', 'KeyC', 'F3', ...BUILD_KEYS,
]);
const STICK_ACTION_DELTA = .2;
const STICK_REST_MAGNITUDE = .12;
const MOUSE_LOOK_ACTION_PIXELS = 4;
const LOOK_HINT_RADIANS = .4;
const UNLOCKED_EDGE_WIDTH = 18;
const UNLOCKED_EDGE_PIXELS_PER_SECOND = 720;

function edgeLook(position: number, start: number, end: number): number {
  const width = Math.min(UNLOCKED_EDGE_WIDTH, (end - start) / 4);
  if (width <= 0 || position < start || position > end) return 0;
  const before = Math.max(0, 1 - (position - start) / width);
  const after = Math.max(0, 1 - (end - position) / width);
  return after - before;
}

function recenterDelta(position: number, delta: number, edge: number, start: number, end: number): number {
  if (edge === 0 || delta * edge >= 0) return delta;
  // Once edge turning has been used, let the cursor travel back to the
  // middle without orbiting back. Movement past the middle turns normally.
  const center = (start + end) / 2;
  return edge > 0 ? Math.min(0, position - center) : Math.max(0, position - center);
}

export type InputDevice = 'keyboard-mouse' | 'gamepad';
export const PAD_BUILD_BINDINGS: Record<PieceType, { button: number; key: string; label: string }> = {
  floor: { button: 12, key: '↑', label: 'D-pad up' },
  wall: { button: 15, key: '→', label: 'D-pad right' },
  ramp: { button: 13, key: '↓', label: 'D-pad down' },
  'launch-pad': { button: 14, key: '←', label: 'D-pad left' },
};
const PAD_CONTROL_BUTTONS = [0, 1, 2, 3, 4, 5, 9, 10, 11,
  ...PIECES.map(piece => PAD_BUILD_BINDINGS[piece].button)];

const axis = (value: number): number => Math.abs(value) < .14 ? 0 :
  Math.sign(value) * (Math.abs(value) - .14) / .86;
const down = (pad: Gamepad, index: number): boolean => pad.buttons[index]?.pressed ?? false;
const trigger = (pad: Gamepad, index: number): boolean => (pad.buttons[index]?.value ?? 0) > .35;

/** Browser-only adapter: no keyboard or Gamepad state leaks into the fixed-step rules. */
export class GameInput {
  private readonly keys = new Set<string>();
  private active = true;
  private mousePrimary = false;
  private mouseSecondary = false;
  private unlockedMouse: { x: number; y: number } | null = null;
  private readonly unlockedEdge = { x: 0, y: 0 };
  private readonly unlockedRecenter = { x: 0, y: 0 };
  pointerLockUnavailable = false;
  private buildToggleQueued = false;
  private buildPlaceQueued = false;
  private selected: PieceType | undefined;
  private padToggleWasDown = false;
  private padInteractWasDown = false;
  private padPlaceWasDown = false;
  private padJumpWasDown = false;
  private padFlingWasDown = false;
  private pendingJump = false;
  private pendingBleat = false;
  private pendingFlop = false;
  private pendingFling = false;
  private pendingCycle = 0;
  private pendingToy = false;
  private padToyMask = 0;
  private pendingGraze = false;
  private pendingInteract = false;
  private readonly unsubscribers: Array<() => void> = [];
  private currentDevice: InputDevice = 'keyboard-mouse';
  private readonly lookTravel: Record<InputDevice, number> = { 'keyboard-mouse': 0, gamepad: 0 };
  private padPromptButtons = 0;
  private readonly padPromptMove = { x: 0, y: 0 };
  private readonly padPromptLook = { x: 0, y: 0 };
  private pointerPromptX = 0;
  private pointerPromptY = 0;
  yaw: number;
  pitch = PLAY_CAMERA_PITCH;
  debugVisible = false;
  sensitivity = 1;
  invertY = false;

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
      if (!this.active || event.ctrlKey || event.metaKey || event.altKey) return;
      const code = event.code;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'F3'].includes(code)) event.preventDefault();
      if (event.repeat) return;
      if (KEYBOARD_CONTROLS.has(code)) this.recordDevice('keyboard-mouse');
      if (code === 'KeyC') {
        void this.requestPointerLock();
        return;
      }
      this.keys.add(code);
      if (code === 'KeyB') this.buildToggleQueued = true;
      if (code === 'F3') this.debugVisible = !this.debugVisible;
      if (code === 'Space') this.pendingJump = true;
      if (code === 'KeyE') { this.pendingBleat = true; this.pendingInteract = true; }
      if (code === 'KeyV') this.pendingCycle = event.shiftKey ? -1 : 1;
      if (code === 'KeyX') this.pendingToy = true;
      if (code === 'KeyG') this.pendingGraze = true;
      if (code === 'KeyQ') this.pendingFlop = true;
      if (code === 'KeyF') this.pendingFling = true;
      const index = BUILD_KEYS.indexOf(code);
      if (index >= 0) this.selected = PIECES[index];
    });
    listen(window, 'keyup', event => { this.keys.delete(event.code); });
    listen(window, 'blur', () => { this.reset(); });
    listen(document, 'visibilitychange', () => {
      if (document.hidden) this.reset();
    });
    const clearMouseAnchor = () => this.clearMouseAnchor();
    listen(canvas, 'mouseleave', clearMouseAnchor);
    listen(document, 'pointerlockchange', () => {
      if (document.pointerLockElement === canvas) this.pointerLockUnavailable = false;
      clearMouseAnchor();
    });
    listen(document, 'pointerlockerror', () => this.reportLockUnavailable());
    listen(canvas, 'mousedown', event => {
      if (!this.active) return;
      if (event.button === 0 || event.button === 2) this.recordDevice('keyboard-mouse');
      if (document.pointerLockElement !== canvas) {
        this.unlockedMouse = { x: event.clientX, y: event.clientY };
      }
      if (event.button === 0) {
        this.mousePrimary = true;
        this.buildPlaceQueued = true;
      }
      if (event.button === 2) this.mouseSecondary = true;
    });
    listen(window, 'mouseup', event => {
      if (event.button === 0) this.mousePrimary = false;
      if (event.button === 2) this.mouseSecondary = false;
    });
    listen(canvas, 'contextmenu', event => { event.preventDefault(); });
    listen(document, 'mousemove', event => {
      if (!this.active) return;
      // The button state also recovers a release that landed outside the page.
      if (!(event.buttons & 1)) this.mousePrimary = false;
      if (!(event.buttons & 2)) this.mouseSecondary = false;
      if (document.pointerLockElement === canvas) {
        this.look(event.movementX, event.movementY);
        return;
      }
      if (event.target !== canvas) {
        clearMouseAnchor();
        return;
      }
      const previous = this.unlockedMouse;
      this.unlockedMouse = { x: event.clientX, y: event.clientY };
      if (!previous) return;
      // Embedded browsers can deny pointer lock. Each edge can still steer
      // independently, even while the other axis is returning to center.
      const bounds = canvas.getBoundingClientRect();
      const recenter = this.unlockedRecenter;
      this.look(
        recenterDelta(event.clientX, event.clientX - previous.x, recenter.x, bounds.left, bounds.right),
        recenterDelta(event.clientY, event.clientY - previous.y, recenter.y, bounds.top, bounds.bottom),
      );
      if ((event.clientX - (bounds.left + bounds.right) / 2) * recenter.x <= 0) recenter.x = 0;
      if ((event.clientY - (bounds.top + bounds.bottom) / 2) * recenter.y <= 0) recenter.y = 0;
      this.unlockedEdge.x = edgeLook(event.clientX, bounds.left, bounds.right);
      this.unlockedEdge.y = edgeLook(event.clientY, bounds.top, bounds.bottom);
    });
  }

  private clearMouseAnchor(): void {
    this.unlockedMouse = null;
    this.unlockedEdge.x = this.unlockedEdge.y = 0;
    this.unlockedRecenter.x = this.unlockedRecenter.y = 0;
    this.pointerPromptX = this.pointerPromptY = 0;
  }

  get device(): InputDevice { return this.currentDevice; }
  get lookHintNeeded(): boolean { return this.lookTravel[this.device] < LOOK_HINT_RADIANS; }

  private recordDevice(device: InputDevice): void {
    this.currentDevice = device;
    this.pointerPromptX = this.pointerPromptY = 0;
  }

  /** Pad movement owns the hints after a deliberate gesture. The gameplay
   * deadzone and aim response remain independent of this presentation filter. */
  private movedPromptStick(x: number, y: number, last: { x: number; y: number }): boolean {
    const magnitude = Math.hypot(x, y);
    if (magnitude < STICK_REST_MAGNITUDE) last.x = last.y = 0;
    if (!Number.isFinite(magnitude) || magnitude < STICK_ACTION_DELTA ||
        Math.hypot(x - last.x, y - last.y) < STICK_ACTION_DELTA) return false;
    last.x = x;
    last.y = y;
    return true;
  }

  private recordGamepadActivity(pad: Gamepad, moveX: number, moveY: number, lookX: number, lookY: number): void {
    const buttons = PAD_CONTROL_BUTTONS.reduce((mask, index) => down(pad, index) ? mask | (1 << index) : mask, 0) |
      (trigger(pad, 6) ? 1 << 6 : 0) | (trigger(pad, 7) ? 1 << 7 : 0);
    const moved = this.movedPromptStick(moveX, moveY, this.padPromptMove);
    const looked = this.movedPromptStick(lookX, lookY, this.padPromptLook);
    if ((buttons & ~this.padPromptButtons) !== 0 || moved || looked) this.recordDevice('gamepad');
    this.padPromptButtons = buttons;
  }

  async requestPointerLock(): Promise<void> {
    if (!this.active || document.pointerLockElement === this.canvas) return;
    try {
      if (this.canvas.requestPointerLock) {
        await this.canvas.requestPointerLock();
        return;
      }
    } catch {
      // Keep the same edge-look path in browsers that deny pointer lock.
    }
    this.reportLockUnavailable();
  }

  private reportLockUnavailable(): void {
    // Teach the browser's edge controls the first time capture is denied.
    if (!this.pointerLockUnavailable) this.lookTravel['keyboard-mouse'] = 0;
    this.pointerLockUnavailable = true;
    this.clearMouseAnchor();
  }

  setActive(active: boolean): void {
    this.active = active;
    this.reset();
  }

  private applyLook(device: InputDevice, yaw: number, pitch: number): void {
    const previousPitch = this.pitch;
    this.yaw += yaw;
    this.pitch = clampCameraPitch(previousPitch + pitch);
    if (this.lookTravel[device] < LOOK_HINT_RADIANS) {
      this.lookTravel[device] += Math.hypot(yaw, this.pitch - previousPitch);
    }
  }

  private look(dx: number, dy: number): void {
    this.applyLook('keyboard-mouse', dx * .0026 * this.sensitivity,
      dy * .0021 * this.sensitivity * (this.invertY ? -1 : 1));
    if (this.device === 'gamepad') {
      this.pointerPromptX += dx;
      this.pointerPromptY += dy;
      if (Math.hypot(this.pointerPromptX, this.pointerPromptY) >= MOUSE_LOOK_ACTION_PIXELS) {
        this.recordDevice('keyboard-mouse');
      }
    }
  }

  sample(dt: number, buildMode: boolean): PlayerIntent {
    if (!this.active) return { cameraYaw: this.yaw };
    const edge = this.unlockedEdge;
    if ((edge.x || edge.y) && document.pointerLockElement !== this.canvas) {
      const pixels = UNLOCKED_EDGE_PIXELS_PER_SECOND * dt;
      if (edge.x) this.unlockedRecenter.x = Math.sign(edge.x);
      if (edge.y) this.unlockedRecenter.y = Math.sign(edge.y);
      this.look(edge.x * pixels, edge.y * pixels);
    }
    const pressed = (code: string): boolean => this.keys.has(code);
    const lookX = Number(pressed('KeyL')) - Number(pressed('KeyJ'));
    const lookY = Number(pressed('KeyK')) - Number(pressed('KeyI'));
    this.applyLook('keyboard-mouse', lookX * dt * 2.8, lookY * dt * 1.9);
    let moveX = Number(pressed('KeyD') || pressed('ArrowRight')) -
      Number(pressed('KeyA') || pressed('ArrowLeft'));
    let moveZ = Number(pressed('KeyW') || pressed('ArrowUp')) -
      Number(pressed('KeyS') || pressed('ArrowDown'));
    let sprint = pressed('ShiftLeft') || pressed('ShiftRight');
    let glide = pressed('Space');
    let jump = glide || this.pendingJump;
    let chargeHeadbutt = this.mousePrimary;
    let tongue = this.mouseSecondary;
    let bleat = pressed('KeyE') || this.pendingBleat;
    let flop = pressed('KeyQ') || this.pendingFlop;
    let flingTongue = pressed('KeyF') || this.pendingFling;
    let toggleBuild = this.buildToggleQueued;
    let placeBuild = this.buildPlaceQueued;
    let buildPiece = this.selected;
    let reelTongue = pressed('KeyR');
    let cycleToy = this.pendingCycle, useToy = this.pendingToy;
    let graze = this.pendingGraze;
    let interact = this.pendingInteract;

    const pad = navigator.getGamepads?.().find(p => p?.connected) ?? null;
    if (pad) {
      const px = axis(pad.axes[0] ?? 0), pz = -axis(pad.axes[1] ?? 0);
      const rx = axis(pad.axes[2] ?? 0), ry = axis(pad.axes[3] ?? 0);
      this.recordGamepadActivity(pad, px, pz, rx, ry);
      if (Math.hypot(px, pz) > Math.hypot(moveX, moveZ) * .7) {
        moveX = px; moveZ = pz;
      }
      this.applyLook('gamepad', rx * dt * 2.8 * this.sensitivity,
        ry * dt * 1.9 * (this.invertY ? -1 : 1));
      sprint ||= down(pad, 5);
      const padJump = down(pad, 0);
      jump ||= padJump;
      glide ||= padJump;
      if (padJump && !this.padJumpWasDown) this.pendingJump = true;
      this.padJumpWasDown = padJump;
      tongue ||= down(pad, 4) || trigger(pad, 6);
      const padHeadbutt = trigger(pad, 7);
      chargeHeadbutt ||= padHeadbutt;
      bleat ||= down(pad, 2);
      // X is a context action near boards or grazing patches.
      interact ||= down(pad, 2) && !this.padInteractWasDown;
      graze ||= down(pad, 2) && !this.padInteractWasDown;
      this.padInteractWasDown = down(pad, 2);
      flop ||= down(pad, 1);
      const padFling = down(pad, 10);
      flingTongue ||= padFling && !this.padFlingWasDown;
      this.padFlingWasDown = padFling;
      reelTongue ||= down(pad, 11);
      const padToggle = down(pad, 3);
      if (padToggle && !this.padToggleWasDown) toggleBuild = true;
      this.padToggleWasDown = padToggle;
      const mask = Number(down(pad,14)) | Number(down(pad,15)) << 1 | Number(down(pad,12)) << 2;
      const edge = mask & ~this.padToyMask;
      this.padToyMask = mask;
      if (!buildMode) {
        if (edge & 1) cycleToy = -1;
        if (edge & 2) cycleToy = 1;
        useToy ||= !!(edge & 4);
      }
      if (buildMode) buildPiece = PIECES.find(piece => down(pad, PAD_BUILD_BINDINGS[piece].button)) ?? buildPiece;
      if (buildMode && chargeHeadbutt && !this.padPlaceWasDown) placeBuild = true;
      this.padPlaceWasDown = chargeHeadbutt;
    } else {
      if (this.device === 'gamepad') this.recordDevice('keyboard-mouse');
      this.padToyMask = 0;
      this.padPromptButtons = 0;
      this.padPromptMove.x = this.padPromptMove.y = 0;
      this.padPromptLook.x = this.padPromptLook.y = 0;
      this.padToggleWasDown = false;
      this.padJumpWasDown = false;
      this.padPlaceWasDown = false;
      this.padFlingWasDown = false;
      this.padInteractWasDown = false;
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
    this.pendingCycle = 0;
    this.pendingToy = false;
    this.pendingGraze = false;
    this.pendingInteract = false;
    return {
      moveX, moveZ, cameraYaw: this.yaw, cameraPitch: this.pitch, sprint, jump, glide,
      cycleToy, useToy,
      chargeHeadbutt: !buildMode && chargeHeadbutt, tongue,
      reelTongue, flingTongue, bleat, flop,
      toggleBuild, placeBuild: buildMode && placeBuild, buildPiece, graze, interact,
    };
  }

  reset(): void {
    this.keys.clear();
    this.pendingCycle = this.padToyMask = 0;
    this.pendingToy = false;
    this.mousePrimary = false;
    this.mouseSecondary = false;
    this.clearMouseAnchor();
    this.pendingJump = this.pendingBleat = this.pendingFlop = this.pendingFling = false;
    this.pendingGraze = this.pendingInteract = false;
    this.buildToggleQueued = this.buildPlaceQueued = false;
    this.selected = undefined;
  }

  dispose(): void {
    for (const fn of this.unsubscribers.splice(0)) fn();
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
  }
}
