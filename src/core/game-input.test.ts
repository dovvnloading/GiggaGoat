import { afterEach, describe, expect, it, vi } from 'vitest';
import { GameInput } from './GameInput';

function setup() {
  const requestPointerLock = vi.fn<() => Promise<void> | void>().mockResolvedValue(undefined);
  const canvas = Object.assign(new EventTarget(), { requestPointerLock });
  const doc = Object.assign(new EventTarget(), {
    pointerLockElement: null as EventTarget | null,
    exitPointerLock: vi.fn(),
  });
  const win = new EventTarget();
  vi.stubGlobal('document', doc);
  vi.stubGlobal('window', win);
  vi.stubGlobal('navigator', { getGamepads: () => [] });
  const input = new GameInput(canvas as unknown as HTMLCanvasElement, 0);

  const press = (button = 0) => {
    canvas.dispatchEvent(Object.assign(new Event('mousedown'), { button, clientX: 60, clientY: 80 }));
  };
  const release = (button = 0) => {
    const event = Object.assign(new Event('mouseup'), { button });
    Object.defineProperty(event, 'target', { value: canvas });
    win.dispatchEvent(event);
  };
  const move = (clientX: number, clientY: number, buttons = 0, movementX = 0, movementY = 0,
    target: EventTarget = canvas) => {
    const event = Object.assign(new Event('mousemove'), {
      clientX, clientY, buttons, movementX, movementY,
    });
    Object.defineProperty(event, 'target', { value: target });
    doc.dispatchEvent(event);
  };
  return { requestPointerLock, canvas, doc, win, input, press, release, move };
}

afterEach(() => vi.unstubAllGlobals());

describe('game camera input', () => {
  it('orbits on ordinary mouse movement after pointer lock is rejected', async () => {
    const { requestPointerLock, input, move } = setup();
    requestPointerLock.mockRejectedValue(new DOMException('Wrong document', 'WrongDocumentError'));
    await expect(input.requestPointerLock()).resolves.toBeUndefined();

    move(100, 60);
    expect(input.yaw).toBe(0);
    expect(input.pitch).toBe(.3);
    move(180, 10, 0, 800, 500);
    expect(input.yaw).toBeCloseTo(.208);
    expect(input.pitch).toBeCloseTo(.195);
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
    expect(input.pitch).toBeCloseTo(.3525);
  });

  it('uses drag look when the embedded browser rejects pointer lock', async () => {
    const { requestPointerLock, input, press, release, move } = setup();
    requestPointerLock.mockRejectedValue(new DOMException('Wrong document', 'WrongDocumentError'));
    await expect(input.requestPointerLock()).resolves.toBeUndefined();

    press();
    move(62, 80, 1);
    expect(input.yaw).toBe(0);
    expect(input.sample(.05, false).chargeHeadbutt).toBe(false);
    move(160, 40, 1, 3, 1);
    expect(input.yaw).toBeCloseTo(.26);
    expect(input.pitch).toBeCloseTo(.216);
    expect(input.sample(.2, false).chargeHeadbutt).toBe(false);
    release();
    move(210, 40, 0);
    expect(input.yaw).toBeCloseTo(.26);
    expect(input.sample(1 / 60, true).placeBuild).toBe(false);
    expect(requestPointerLock).toHaveBeenCalledTimes(1);
  });

  it('keeps native mouse look and both mouse actions while locked', () => {
    const { requestPointerLock, canvas, doc, input, press, release, move } = setup();
    doc.pointerLockElement = canvas;

    move(60, 80, 0, -30, 25);
    expect(input.yaw).toBeCloseTo(-.078);
    expect(input.pitch).toBeCloseTo(.3525);
    press();
    press(2);
    expect(input.sample(1 / 60, false)).toMatchObject({ chargeHeadbutt: true, tongue: true });
    release();
    release(2);
    expect(input.sample(1 / 60, false)).toMatchObject({ chargeHeadbutt: false, tongue: false });
    press();
    expect(input.sample(1 / 60, true).placeBuild).toBe(true);
    expect(requestPointerLock).not.toHaveBeenCalled();
  });

  it('allows a stationary hold to charge and a stationary build click to place once', () => {
    const { requestPointerLock, input, press, release, move } = setup();

    press();
    press(2);
    expect(input.sample(.18, false)).toMatchObject({ chargeHeadbutt: true, tongue: true });
    move(105, 80, 3);
    expect(input.yaw).toBe(0);
    expect(input.sample(1 / 60, false).chargeHeadbutt).toBe(true);
    release(2);
    release();
    expect(input.sample(1 / 60, false)).toMatchObject({ chargeHeadbutt: false, tongue: false });
    expect(requestPointerLock).not.toHaveBeenCalled();

    press();
    release();
    expect(input.sample(1 / 60, false).chargeHeadbutt).toBe(false);
    expect(requestPointerLock).toHaveBeenCalledTimes(1);

    press();
    move(105, 80, 1);
    release();
    expect(input.sample(1 / 60, true).placeBuild).toBe(false);
    press();
    expect(input.sample(.18, true).placeBuild).toBe(false);
    release();
    expect(input.sample(1 / 60, true).placeBuild).toBe(true);
    expect(input.sample(1 / 60, true).placeBuild).toBe(false);
  });

  it('clears an interrupted drag so it cannot turn the camera after blur', () => {
    const { win, input, press, move } = setup();
    press();
    win.dispatchEvent(new Event('blur'));
    move(160, 40, 1);
    expect(input.yaw).toBe(0);
    expect(input.sample(.2, false).chargeHeadbutt).toBe(false);
  });
});
