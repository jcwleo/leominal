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

describe('client viewport height sync', () => {
  let visualViewport: EventTarget;
  let visualViewportHeight = 0;

  beforeEach(() => {
    vi.resetModules();
    rootRender.mockClear();
    document.body.innerHTML = '<div id="root"></div>';
    document.documentElement.style.removeProperty(viewportHeightProperty);
    visualViewport = new EventTarget();
    visualViewportHeight = 744;
    Object.defineProperty(visualViewport, 'height', {
      configurable: true,
      get: () => visualViewportHeight
    });
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: visualViewport
    });
  });

  afterEach(() => {
    document.documentElement.style.removeProperty(viewportHeightProperty);
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
});
