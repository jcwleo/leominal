type TouchLikeEvent = Event & {
  touches?: { length: number };
};

const mobileGestureEvents = ['gesturestart', 'gesturechange', 'gestureend'] as const;

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

  function preventMultiTouchZoom(event: Event) {
    const touches = (event as TouchLikeEvent).touches;
    if (touches && touches.length > 1) {
      preventZoom(event);
    }
  }

  for (const eventName of mobileGestureEvents) {
    document.addEventListener(eventName, preventZoom, options);
  }
  document.addEventListener('touchmove', preventMultiTouchZoom, options);
  document.addEventListener('dblclick', preventZoom, options);

  return () => {
    for (const eventName of mobileGestureEvents) {
      document.removeEventListener(eventName, preventZoom, options);
    }
    document.removeEventListener('touchmove', preventMultiTouchZoom, options);
    document.removeEventListener('dblclick', preventZoom, options);
  };
}

function isTouchBrowser(win: Window): boolean {
  if (win.navigator.maxTouchPoints > 0) {
    return true;
  }
  return typeof win.matchMedia === 'function' && win.matchMedia('(pointer: coarse)').matches;
}
