export const leominalViewportHeightProperty = '--leominal-viewport-height';
export const leominalViewportOffsetTopProperty = '--leominal-viewport-offset-top';

export function installViewportHeightSync(win: Window = window): () => void {
  const root = win.document.documentElement;
  const visualViewport = win.visualViewport;

  function syncHeight() {
    const height = readVisibleViewportHeight(win);
    if (height !== null) {
      root.style.setProperty(leominalViewportHeightProperty, `${height}px`);
    }
    root.style.setProperty(leominalViewportOffsetTopProperty, `${readViewportOffsetTop(win)}px`);
  }

  syncHeight();
  visualViewport?.addEventListener('resize', syncHeight);
  visualViewport?.addEventListener('scroll', syncHeight);
  win.addEventListener('resize', syncHeight);
  win.addEventListener('orientationchange', syncHeight);
  win.addEventListener('pageshow', syncHeight);
  win.document.addEventListener('visibilitychange', syncHeight);

  return () => {
    visualViewport?.removeEventListener('resize', syncHeight);
    visualViewport?.removeEventListener('scroll', syncHeight);
    win.removeEventListener('resize', syncHeight);
    win.removeEventListener('orientationchange', syncHeight);
    win.removeEventListener('pageshow', syncHeight);
    win.document.removeEventListener('visibilitychange', syncHeight);
    root.style.removeProperty(leominalViewportHeightProperty);
    root.style.removeProperty(leominalViewportOffsetTopProperty);
  };
}

function readVisibleViewportHeight(win: Window): number | null {
  const visualViewportHeight = win.visualViewport?.height;
  if (isUsableHeight(visualViewportHeight)) {
    return visualViewportHeight;
  }
  if (isUsableHeight(win.innerHeight)) {
    return win.innerHeight;
  }
  return null;
}

function isUsableHeight(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function readViewportOffsetTop(win: Window): number {
  const offsetTop = win.visualViewport?.offsetTop;
  if (typeof offsetTop !== 'number' || !Number.isFinite(offsetTop)) {
    return 0;
  }
  return Math.max(0, Math.round(offsetTop));
}
