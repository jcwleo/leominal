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

  it('prevents single-touch page panning after the client starts', async () => {
    Object.defineProperty(Navigator.prototype, 'maxTouchPoints', {
      configurable: true,
      value: 1
    });

    await import('../../src/client/main.js');

    const oneFingerMove = new Event('touchmove', { cancelable: true });
    Object.defineProperty(oneFingerMove, 'touches', {
      configurable: true,
      value: [{ identifier: 1 }]
    });

    expect(document.dispatchEvent(oneFingerMove)).toBe(false);
    expect(oneFingerMove.defaultPrevented).toBe(true);
  });

  it('allows single-touch scrolling inside the file explorer', async () => {
    Object.defineProperty(Navigator.prototype, 'maxTouchPoints', {
      configurable: true,
      value: 1
    });
    document.body.innerHTML = '<div id="root"></div><div class="file-tree"><button type="button" id="file-row">notes.txt</button></div>';

    await import('../../src/client/main.js');

    const oneFingerMove = new Event('touchmove', { bubbles: true, cancelable: true });
    Object.defineProperty(oneFingerMove, 'touches', {
      configurable: true,
      value: [{ identifier: 1 }]
    });

    const fileRow = document.getElementById('file-row');
    if (!fileRow) {
      throw new Error('file row fixture missing');
    }

    expect(fileRow.dispatchEvent(oneFingerMove)).toBe(true);
    expect(oneFingerMove.defaultPrevented).toBe(false);
  });

  it('allows single-touch scrolling inside the embedded markdown preview', async () => {
    Object.defineProperty(Navigator.prototype, 'maxTouchPoints', {
      configurable: true,
      value: 1
    });
    document.body.innerHTML =
      '<div id="root"></div><div class="editor-markdown-preview"><h1 id="markdown-heading">Title</h1></div>';

    await import('../../src/client/main.js');

    const oneFingerMove = new Event('touchmove', { bubbles: true, cancelable: true });
    Object.defineProperty(oneFingerMove, 'touches', {
      configurable: true,
      value: [{ identifier: 1 }]
    });

    const markdownHeading = document.getElementById('markdown-heading');
    if (!markdownHeading) {
      throw new Error('markdown heading fixture missing');
    }

    expect(markdownHeading.dispatchEvent(oneFingerMove)).toBe(true);
    expect(oneFingerMove.defaultPrevented).toBe(false);
  });
});
