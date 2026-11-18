import { afterEach, describe, expect, it, vi } from 'vitest';
import { GameInput } from './GameInput';
import { PLAY_CAMERA_PITCH } from './GoatCamera';

function setup() {
  const requestPointerLock = vi.fn<() => Promise<void> | void>().mockResolvedValue(undefined);
  const canvas = Object.assign(new EventTarget(), { requestPointerLock });
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
