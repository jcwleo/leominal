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
const viewportOffsetTopProperty = '--leominal-viewport-offset-top';

describe('client viewport height sync', () => {
  let visualViewport: EventTarget;
  let visualViewportHeight = 0;
  let visualViewportOffsetTop = 0;

  beforeEach(() => {
    vi.resetModules();
    rootRender.mockClear();
    document.body.innerHTML = '<div id="root"></div>';
    document.documentElement.style.removeProperty(viewportHeightProperty);
    document.documentElement.style.removeProperty(viewportOffsetTopProperty);
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
    document.documentElement.style.removeProperty(viewportOffsetTopProperty);
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

  it('exposes the visual viewport pan offset so the layout can stay aligned above the keyboard', async () => {
    visualViewportOffsetTop = 12;

    await import('../../src/client/main.js');

    expect(document.documentElement.style.getPropertyValue(viewportOffsetTopProperty)).toBe('12px');

    visualViewportOffsetTop = 48;
    visualViewport.dispatchEvent(new Event('scroll'));

    expect(document.documentElement.style.getPropertyValue(viewportOffsetTopProperty)).toBe('48px');

    visualViewportOffsetTop = -8;
    visualViewport.dispatchEvent(new Event('scroll'));

    expect(document.documentElement.style.getPropertyValue(viewportOffsetTopProperty)).toBe('0px');

    visualViewportOffsetTop = 20;
    visualViewport.dispatchEvent(new Event('resize'));

    expect(document.documentElement.style.getPropertyValue(viewportOffsetTopProperty)).toBe('20px');
  });
});
