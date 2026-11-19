import { afterEach, describe, expect, it, vi } from 'vitest';
import { GameInput } from './GameInput';
import { PLAY_CAMERA_PITCH } from './GoatCamera';

function setup() {
  const requestPointerLock = vi.fn<() => Promise<void> | void>().mockResolvedValue(undefined);
  const canvas = Object.assign(new EventTarget(), {
    requestPointerLock,
    getBoundingClientRect: () => ({ left: 0, right: 800, top: 0, bottom: 500 }),
  });
  const doc = Object.assign(new EventTarget(), {
    pointerLockElement: null as EventTarget | null,
    exitPointerLock: vi.fn(),
  });
  const win = new EventTarget();
  const getGamepads = vi.fn<() => Array<Pick<Gamepad, 'connected' | 'axes' | 'buttons'> | null>>()
    .mockReturnValue([]);
  vi.stubGlobal('document', doc);
  vi.stubGlobal('window', win);
  vi.stubGlobal('navigator', { getGamepads });
  const input = new GameInput(canvas as unknown as HTMLCanvasElement, 0);

  const press = (button = 0, clientX = 60, clientY = 80) => {
    canvas.dispatchEvent(Object.assign(new Event('mousedown'), { button, clientX, clientY }));
  };
  const release = (button = 0) => {
    win.dispatchEvent(Object.assign(new Event('mouseup'), { button }));
  };
  const key = (type: 'keydown' | 'keyup', code: string, init: KeyboardEventInit = {}) => {
    win.dispatchEvent(Object.assign(new Event(type, { cancelable: true }), { code, ...init }));
  };
  const move = (clientX: number, clientY: number, buttons = 0, movementX = 0, movementY = 0,
    target: EventTarget = canvas) => {
    const event = Object.assign(new Event('mousemove'), {
      clientX, clientY, buttons, movementX, movementY,
    });
    Object.defineProperty(event, 'target', { value: target });
    doc.dispatchEvent(event);
  };
  return { requestPointerLock, canvas, doc, win, input, press, release, move, key, getGamepads };
}

afterEach(() => vi.unstubAllGlobals());

describe('game camera input', () => {
  it('dismisses each device look hint after steering and teaches edge look after a denial', async () => {
    const { requestPointerLock, input, move, key, getGamepads } = setup();
    key('keydown', 'KeyL');
    input.sample(.05, false);
    expect(input.lookHintNeeded).toBe(true);
    input.sample(.10, false);
    key('keyup', 'KeyL');
    expect(input.lookHintNeeded).toBe(false);

    getGamepads.mockReturnValue([{ connected: true, axes: [1, 0, 0, 0], buttons: [] }]);
    input.sample(.1, false);
    expect(input.device).toBe('gamepad');
    expect(input.lookHintNeeded).toBe(true);
    getGamepads.mockReturnValue([{ connected: true, axes: [1, 0, 1, 0], buttons: [] }]);
    input.sample(.2, false);
    expect(input.lookHintNeeded).toBe(false);

    getGamepads.mockReturnValue([]);
    input.sample(.1, false);
    expect(input.lookHintNeeded).toBe(false);
    requestPointerLock.mockRejectedValue(new DOMException('Wrong document', 'WrongDocumentError'));
    await input.requestPointerLock();
    expect(input.lookHintNeeded).toBe(true);
    move(100, 100);
    move(103, 100);
    expect(input.lookHintNeeded).toBe(true);
    move(270, 100);
    expect(input.lookHintNeeded).toBe(false);
    await input.requestPointerLock();
    expect(input.lookHintNeeded).toBe(false);
  });

  it('orbits on ordinary mouse movement after pointer lock is rejected', async () => {
    const { requestPointerLock, input, move } = setup();
    requestPointerLock.mockRejectedValue(new DOMException('Wrong document', 'WrongDocumentError'));
    await expect(input.requestPointerLock()).resolves.toBeUndefined();

    move(100, 60);
    expect(input.yaw).toBe(0);
    expect(input.pitch).toBe(PLAY_CAMERA_PITCH);
    move(180, 10, 0, 800, 500);
    expect(input.yaw).toBeCloseTo(.208);
    expect(input.pitch).toBeCloseTo(PLAY_CAMERA_PITCH - .105);
    expect(input.sample(1 / 60, false)).toMatchObject({ chargeHeadbutt: false, tongue: false });
    expect(input.sample(1 / 60, true).placeBuild).toBe(false);
  });

  it('continues turning at either edge when an unlocked cursor runs out of space', async () => {
    const { canvas, doc, requestPointerLock, input, move } = setup();
    requestPointerLock.mockRejectedValue(new DOMException('Wrong document', 'WrongDocumentError'));
    await input.requestPointerLock();

    move(720, 250);
    move(799, 250);
    const right = input.yaw;
    for (let frame = 0; frame < 30; frame++) input.sample(1 / 60, false);
    expect(input.yaw - right).toBeGreaterThan(.8);

    move(600, 250);
    const inside = input.yaw;
    input.sample(.2, false);
    expect(input.yaw).toBe(inside);

    move(1, 250);
    const left = input.yaw;
    for (let frame = 0; frame < 30; frame++) input.sample(1 / 60, false);
    expect(input.yaw - left).toBeLessThan(-.8);

    canvas.dispatchEvent(new Event('mouseleave'));
    const outside = input.yaw;
    input.sample(.2, false);
    expect(input.yaw).toBe(outside);

    move(710, 250);
    move(799, 250);
    doc.pointerLockElement = canvas;
    doc.dispatchEvent(new Event('pointerlockchange'));
    const locked = input.yaw;
    input.sample(.2, false);
    expect(input.yaw).toBe(locked);
    move(799, 250, 0, 15, 0);
    expect(input.yaw - locked).toBeCloseTo(.039);
  });

  it('recenters after edge turning without reversing the accumulated orbit', async () => {
    const { input, move, requestPointerLock } = setup();
    requestPointerLock.mockRejectedValue(new DOMException('Wrong document', 'WrongDocumentError'));
    await input.requestPointerLock();
    expect(input.pointerLockUnavailable).toBe(true);
    move(600, 260);
    move(799, 260);
    for (let frame = 0; frame < 20; frame++) input.sample(1 / 60, false);
    const yaw = input.yaw;
    const pitch = input.pitch;

    move(700, 250);
    move(400, 250);
    expect(input.yaw).toBe(yaw);
    expect(input.pitch).toBeLessThan(pitch);
    input.sample(.2, false);
    expect(input.yaw).toBe(yaw);

    move(420, 250);
    expect(input.yaw).toBeCloseTo(yaw + .052);
  });

  it('restarts hover tracking after leaving the canvas, blur, or a menu transition', () => {
    const { canvas, doc, win, requestPointerLock, input, move } = setup();
    move(90, 50);
    move(110, 50);
    expect(input.yaw).toBeCloseTo(.052);

    canvas.dispatchEvent(new Event('mouseleave'));
    move(500, 240);
    expect(input.yaw).toBeCloseTo(.052);
    move(510, 240, 0, 0, 0, doc);
    move(300, 100);
    expect(input.yaw).toBeCloseTo(.052);

    win.dispatchEvent(new Event('blur'));
    move(40, 50);
    expect(input.yaw).toBeCloseTo(.052);
    input.setActive(false);
    move(60, 50);
    move(140, 50);
    void input.requestPointerLock();
    expect(requestPointerLock).not.toHaveBeenCalled();
    expect(input.yaw).toBeCloseTo(.052);
    input.setActive(true);
    move(180, 50);
    expect(input.yaw).toBeCloseTo(.052);
    move(200, 50);
    expect(input.yaw).toBeCloseTo(.104);
  });

  it('keeps mouse look after a legacy lock error and switches back to native input on capture', async () => {
    const { canvas, doc, requestPointerLock, input, move } = setup();
    requestPointerLock.mockImplementation(() => {
      doc.dispatchEvent(new Event('pointerlockerror'));
    });
    move(100, 50);
    await input.requestPointerLock();
    move(400, 50);
    expect(input.yaw).toBe(0);
    move(420, 50);
    expect(input.yaw).toBeCloseTo(.052);

    doc.pointerLockElement = canvas;
    doc.dispatchEvent(new Event('pointerlockchange'));
    move(420, 50, 0, -20);
    expect(input.yaw).toBeCloseTo(0);
  });

  it.each([false, true])('inverts only vertical mouse look when enabled (locked: %s)', locked => {
    const { canvas, doc, input, move } = setup();
    if (locked) doc.pointerLockElement = canvas;
    input.invertY = true;

    move(100, 60);
    move(130, 35, 0, 30, -25);
    expect(input.yaw).toBeCloseTo(.078);
    expect(input.pitch).toBeCloseTo(PLAY_CAMERA_PITCH + .0525);
  });

  it.each([false, true])('aims while holding headbutt or tongue (locked: %s)', locked => {
    const { requestPointerLock, canvas, doc, input, press, release, move } = setup();
    if (locked) doc.pointerLockElement = canvas;

    press();
    expect(input.sample(1 / 60, false)).toMatchObject({ chargeHeadbutt: true, tongue: false });
    move(90, 70, 1, 30, -10);
    expect(input.yaw).toBeCloseTo(.078);
    expect(input.pitch).toBeCloseTo(PLAY_CAMERA_PITCH - .021);
    expect(input.sample(1 / 60, false).chargeHeadbutt).toBe(true);
    release();

    press(2, 90, 70);
    move(120, 80, 2, 30, 10);
    expect(input.yaw).toBeCloseTo(.156);
    expect(input.pitch).toBeCloseTo(PLAY_CAMERA_PITCH);
    expect(input.sample(1 / 60, false)).toMatchObject({ chargeHeadbutt: false, tongue: true });
    release(2);
    expect(input.sample(1 / 60, false)).toMatchObject({ chargeHeadbutt: false, tongue: false });
    expect(requestPointerLock).not.toHaveBeenCalled();
  });

  it.each([false, true])('places one build piece for a click shorter than one frame (locked: %s)', locked => {
    const { requestPointerLock, canvas, doc, input, press, release } = setup();
    if (locked) doc.pointerLockElement = canvas;

    press();
    release();
    expect(input.sample(1 / 60, true)).toMatchObject({ placeBuild: true, chargeHeadbutt: false });
    expect(input.sample(1 / 60, true).placeBuild).toBe(false);
    expect(requestPointerLock).not.toHaveBeenCalled();
  });

  it('queues keyboard build entry, ramp selection, exit, and board interaction', () => {
    const { input, key } = setup();
    key('keydown', 'KeyB');
    key('keyup', 'KeyB');
    expect(input.sample(1 / 60, false).toggleBuild).toBe(true);

    key('keydown', 'Digit3');
    key('keyup', 'Digit3');
    expect(input.sample(1 / 60, true)).toMatchObject({ buildPiece: 'ramp', toggleBuild: false });

    key('keydown', 'KeyB');
    key('keyup', 'KeyB');
    expect(input.sample(1 / 60, true).toggleBuild).toBe(true);
    key('keydown', 'KeyE');
    key('keyup', 'KeyE');
    expect(input.sample(1 / 60, false)).toMatchObject({ interact: true, toggleBuild: false });
  });

  it('holds glide on Space and gamepad A without turning a short jump tap into glide', () => {
    const { input, key, getGamepads } = setup();
    const a = { pressed: false, touched: false, value: 0 };
    getGamepads.mockReturnValue([{ connected: true, axes: [], buttons: [a] }]);

    key('keydown', 'Space');
    key('keyup', 'Space');
    expect(input.sample(1 / 60, false)).toMatchObject({ jump: true, glide: false });
    expect(input.sample(1 / 60, false)).toMatchObject({ jump: false, glide: false });

    key('keydown', 'Space');
    expect(input.sample(1 / 60, false)).toMatchObject({ jump: true, glide: true });
    key('keyup', 'Space');
    expect(input.sample(1 / 60, false)).toMatchObject({ jump: false, glide: false });

    a.pressed = true;
    expect(input.sample(1 / 60, false)).toMatchObject({ jump: true, glide: true });
    expect(input.sample(1 / 60, false)).toMatchObject({ jump: true, glide: true });
    a.pressed = false;
    expect(input.sample(1 / 60, false)).toMatchObject({ jump: false, glide: false });

    input.setActive(false);
    a.pressed = true;
    expect(input.sample(1 / 60, false)).toEqual({ cameraYaw: 0 });
  });

  it('keeps the hints on keyboard and mouse for connected pads with idle stick drift', () => {
    const { input, getGamepads } = setup();
    getGamepads.mockReturnValue([{ connected: true, axes: [.13, -.13, .21, -.15], buttons: [] }]);
    input.sample(1 / 60, false);
    expect(input.yaw).toBeGreaterThan(0);
    expect(input.device).toBe('keyboard-mouse');
  });

  it('switches for actual pad stick movement without letting a held stick override new keys', () => {
    const { input, key, getGamepads } = setup();
    const axes = [0, 0, .7, 0];
    getGamepads.mockReturnValue([{ connected: true, axes, buttons: [] }]);
    input.sample(1 / 60, false);
    expect(input.device).toBe('gamepad');
    key('keydown', 'KeyZ');
    key('keydown', 'KeyW', { repeat: true });
    key('keydown', 'KeyW', { ctrlKey: true });
    expect(input.device).toBe('gamepad');

    key('keydown', 'KeyW');
    expect(input.sample(1 / 60, false).moveZ).toBe(1);
    expect(input.device).toBe('keyboard-mouse');

    axes[2] = .69;
    input.sample(1 / 60, false);
    expect(input.device).toBe('keyboard-mouse');
    axes[2] = -.8;
    input.sample(1 / 60, false);
    expect(input.device).toBe('gamepad');
    getGamepads.mockReturnValue([]);
    input.sample(1 / 60, false);
    expect(input.device).toBe('keyboard-mouse');
  });

  it('tracks new pad buttons, gameplay mouse buttons and existing build and board bindings', () => {
    const { input, press, release, getGamepads } = setup();
    const buttons = Array.from({ length: 16 }, () => ({ pressed: false, touched: false, value: 0 }));
    getGamepads.mockReturnValue([{ connected: true, axes: [], buttons }]);
    buttons[3]!.pressed = true;
    expect(input.sample(1 / 60, false).toggleBuild).toBe(true);
    expect(input.device).toBe('gamepad');
    press(2);
    expect(input.sample(1 / 60, true)).toMatchObject({ tongue: true, toggleBuild: false });
    expect(input.device).toBe('keyboard-mouse');
    release(2);

    buttons[13]!.pressed = true;
    expect(input.sample(1 / 60, true).buildPiece).toBe('ramp');
    expect(input.device).toBe('gamepad');
    buttons[3]!.pressed = buttons[13]!.pressed = false;
    buttons[2]!.pressed = true;
    expect(input.sample(1 / 60, false)).toMatchObject({ interact: true, graze: true });
    expect(input.sample(1 / 60, false).interact).toBe(false);
    expect(input.device).toBe('gamepad');
  });

  it('switches after cumulative canvas mouse look and keeps tiny reversals on the gamepad', () => {
    const { input, move, getGamepads } = setup();
    getGamepads.mockReturnValue([{ connected: true, axes: [.75, 0, 0, 0], buttons: [] }]);
    input.sample(1 / 60, false);
    move(100, 50);
    move(101, 50);
    move(100, 50);
    expect(input.device).toBe('gamepad');
    move(102, 50);
    move(104, 50);
    expect(input.device).toBe('keyboard-mouse');
    expect(input.yaw).toBeCloseTo(.0104);
  });

  it('requests pointer lock on C only during active gameplay and ignores repeat and shortcuts', () => {
    const { requestPointerLock, input, key } = setup();
    input.setActive(false);
    key('keydown', 'KeyC');
    input.setActive(true);
    key('keydown', 'KeyC', { ctrlKey: true });
    key('keydown', 'KeyC', { metaKey: true });
    key('keydown', 'KeyC', { altKey: true });
    key('keydown', 'KeyC', { repeat: true });
    expect(requestPointerLock).not.toHaveBeenCalled();

    key('keydown', 'KeyC');
    key('keydown', 'KeyC', { repeat: true });
    expect(requestPointerLock).toHaveBeenCalledTimes(1);
  });

  it('keeps WASD and arrows for movement while IJKL supplies uninverted look', () => {
    const { input, key, win } = setup();
    input.invertY = true;
    key('keydown', 'KeyW');
    key('keydown', 'ArrowRight');
    key('keydown', 'KeyL');
    key('keydown', 'KeyI');
    const intent = input.sample(.1, false);
    expect(intent.moveX).toBeCloseTo(Math.SQRT1_2);
    expect(intent.moveZ).toBeCloseTo(Math.SQRT1_2);
    expect(intent.cameraYaw).toBeCloseTo(.28);
    expect(input.pitch).toBeCloseTo(PLAY_CAMERA_PITCH - .19);
    key('keyup', 'KeyL');
    key('keyup', 'KeyI');
    key('keydown', 'KeyJ');
    key('keydown', 'KeyK');
    expect(input.sample(.1, false).cameraYaw).toBeCloseTo(0);
    expect(input.pitch).toBeCloseTo(PLAY_CAMERA_PITCH);

    win.dispatchEvent(new Event('blur'));
    expect(input.sample(.1, false)).toMatchObject({ moveX: 0, moveZ: 0, cameraYaw: 0 });
    expect(input.pitch).toBeCloseTo(PLAY_CAMERA_PITCH);
    input.setActive(false);
    key('keydown', 'KeyL');
    input.setActive(true);
    expect(input.sample(.1, false).cameraYaw).toBeCloseTo(0);
  });

  it('limits keyboard pitch at 60° up and 75° down', () => {
    const { input, key } = setup();
    key('keydown', 'KeyI');
    input.sample(1, false);
    expect(input.pitch).toBeCloseTo(-Math.PI / 3);
    key('keyup', 'KeyI');
    key('keydown', 'KeyK');
    input.sample(2, false);
    expect(input.pitch).toBeCloseTo(75 * Math.PI / 180);
  });

  it.each([false, true])('matches right-stick and mouse directions (invert Y: %s)', invertY => {
    const { getGamepads, input } = setup();
    getGamepads.mockReturnValue([{ connected: true, axes: [0, 0, 1, 1], buttons: [] }]);
    input.invertY = invertY;
    const intent = input.sample(.1, false);
    expect(intent.cameraYaw).toBeCloseTo(.28);
    expect(input.pitch).toBeCloseTo(PLAY_CAMERA_PITCH + (invertY ? -.19 : .19));
  });

  it('clears buttons and restarts mouse tracking after blur', () => {
    const { win, input, press, move } = setup();
    press();
    press(2);
    win.dispatchEvent(new Event('blur'));
    move(160, 40, 3);
    expect(input.yaw).toBe(0);
    expect(input.sample(.2, false)).toMatchObject({ chargeHeadbutt: false, tongue: false });
  });
});
