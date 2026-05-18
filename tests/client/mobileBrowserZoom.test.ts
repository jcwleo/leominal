// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const rootRender = vi.hoisted(() => vi.fn());

vi.mock('react-dom/client', () => ({
  createRoot: () => ({ render: rootRender })
}));

vi.mock('../../src/client/App.js', () => ({
  App: () => null
}));

const originalMaxTouchPoints = Object.getOwnPropertyDescriptor(Navigator.prototype, 'maxTouchPoints');

describe('mobile browser zoom guard', () => {
  beforeEach(() => {
    vi.resetModules();
    rootRender.mockClear();
    document.body.innerHTML = '<div id="root"></div>';
  });

  afterEach(() => {
    if (originalMaxTouchPoints) {
      Object.defineProperty(Navigator.prototype, 'maxTouchPoints', originalMaxTouchPoints);
    } else {
      Reflect.deleteProperty(Navigator.prototype, 'maxTouchPoints');
    }
  });

  it('prevents mobile gesture zoom events after the client starts', async () => {
    Object.defineProperty(Navigator.prototype, 'maxTouchPoints', {
      configurable: true,
      value: 2
    });

    await import('../../src/client/main.js');

    const gesture = new Event('gesturestart', { cancelable: true });
    const twoFingerMove = new Event('touchmove', { cancelable: true });
    Object.defineProperty(twoFingerMove, 'touches', {
      configurable: true,
      value: [{ identifier: 1 }, { identifier: 2 }]
    });

    expect(document.dispatchEvent(gesture)).toBe(false);
    expect(gesture.defaultPrevented).toBe(true);
    expect(document.dispatchEvent(twoFingerMove)).toBe(false);
    expect(twoFingerMove.defaultPrevented).toBe(true);
  });
});
