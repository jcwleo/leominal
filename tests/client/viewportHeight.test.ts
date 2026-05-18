// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const rootRender = vi.hoisted(() => vi.fn());

vi.mock('react-dom/client', () => ({
  createRoot: () => ({ render: rootRender })
}));

vi.mock('../../src/client/App.js', () => ({
  App: () => null
}));

const originalVisualViewport = Object.getOwnPropertyDescriptor(window, 'visualViewport');
const viewportHeightProperty = '--leominal-viewport-height';
const keyboardVisibleAttribute = 'data-leominal-keyboard-visible';
const keyboardInsetBottomProperty = '--leominal-keyboard-inset-bottom';

describe('client viewport height sync', () => {
  let visualViewport: EventTarget;
  let visualViewportHeight = 0;
  let visualViewportOffsetTop = 0;

  beforeEach(() => {
    vi.resetModules();
    rootRender.mockClear();
    document.body.innerHTML = '<div id="root"></div>';
    document.documentElement.style.removeProperty(viewportHeightProperty);
    document.documentElement.style.removeProperty(keyboardInsetBottomProperty);
    document.documentElement.removeAttribute(keyboardVisibleAttribute);
    visualViewport = new EventTarget();
    visualViewportHeight = 744;
    visualViewportOffsetTop = 0;
    Object.defineProperty(visualViewport, 'height', {
      configurable: true,
      get: () => visualViewportHeight
    });
    Object.defineProperty(visualViewport, 'offsetTop', {
      configurable: true,
      get: () => visualViewportOffsetTop
    });
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: visualViewport
    });
  });

  afterEach(() => {
    document.documentElement.style.removeProperty(viewportHeightProperty);
    document.documentElement.style.removeProperty(keyboardInsetBottomProperty);
    document.documentElement.removeAttribute(keyboardVisibleAttribute);
    if (originalVisualViewport) {
      Object.defineProperty(window, 'visualViewport', originalVisualViewport);
    } else {
      Reflect.deleteProperty(window, 'visualViewport');
    }
  });

  it('tracks the visible viewport height from browser viewport changes', async () => {
    await import('../../src/client/main.js');

    expect(document.documentElement.style.getPropertyValue(viewportHeightProperty)).toBe('744px');

    visualViewportHeight = 692;
    visualViewport.dispatchEvent(new Event('resize'));

    expect(document.documentElement.style.getPropertyValue(viewportHeightProperty)).toBe('692px');
  });

  it('refreshes the visible viewport height when the page is shown again', async () => {
    await import('../../src/client/main.js');

    expect(document.documentElement.style.getPropertyValue(viewportHeightProperty)).toBe('744px');

    visualViewportHeight = 681;
    window.dispatchEvent(new Event('pageshow'));

    expect(document.documentElement.style.getPropertyValue(viewportHeightProperty)).toBe('681px');
  });

  it('marks the document when the visual viewport is shortened by the keyboard', async () => {
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      value: 844
    });
    visualViewportHeight = 520;

    await import('../../src/client/main.js');

    expect(document.documentElement.getAttribute(keyboardVisibleAttribute)).toBe('true');

    visualViewportHeight = 830;
    visualViewport.dispatchEvent(new Event('resize'));

    expect(document.documentElement.getAttribute(keyboardVisibleAttribute)).toBe('false');
  });

  it('exposes the keyboard-covered bottom inset for fixed mobile controls', async () => {
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      value: 844
    });
    visualViewportHeight = 520;
    visualViewportOffsetTop = 12;

    await import('../../src/client/main.js');

    expect(document.documentElement.style.getPropertyValue(keyboardInsetBottomProperty)).toBe('312px');

    visualViewportHeight = 830;
    visualViewportOffsetTop = 0;
    visualViewport.dispatchEvent(new Event('resize'));

    expect(document.documentElement.style.getPropertyValue(keyboardInsetBottomProperty)).toBe('14px');
  });
});
