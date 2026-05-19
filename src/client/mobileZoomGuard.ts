type TouchLikeEvent = Event & {
  touches?: { length: number };
};

const mobileGestureEvents = ['gesturestart', 'gesturechange', 'gestureend'] as const;
const nativeMobileScrollSelector = ['.workspace-list', '.terminal-tab-list', '.mobile-terminal-key-bar', '.upload-toast-body'].join(',');

export function installMobileZoomGuard(win: Window = window): () => void {
  if (!isTouchBrowser(win)) {
    return () => undefined;
  }

  const options: AddEventListenerOptions = { passive: false };
  const document = win.document;

  function preventZoom(event: Event) {
    if (event.cancelable) {
      event.preventDefault();
    }
  }

  function preventPagePanAndZoom(event: Event) {
    if (event.defaultPrevented) {
      return;
    }
    const touches = (event as TouchLikeEvent).touches;
    if (!touches || touches.length === 0) {
      return;
    }
    if (touches.length > 1 || !isNativeMobileScrollTarget(event.target)) {
      preventZoom(event);
    }
  }

  for (const eventName of mobileGestureEvents) {
    document.addEventListener(eventName, preventZoom, options);
  }
  document.addEventListener('touchmove', preventPagePanAndZoom, options);
  document.addEventListener('dblclick', preventZoom, options);

  return () => {
    for (const eventName of mobileGestureEvents) {
      document.removeEventListener(eventName, preventZoom, options);
    }
    document.removeEventListener('touchmove', preventPagePanAndZoom, options);
    document.removeEventListener('dblclick', preventZoom, options);
  };
}

function isNativeMobileScrollTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(nativeMobileScrollSelector) !== null;
}

function isTouchBrowser(win: Window): boolean {
  if (win.navigator.maxTouchPoints > 0) {
    return true;
  }
  return typeof win.matchMedia === 'function' && win.matchMedia('(pointer: coarse)').matches;
}
