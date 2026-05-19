import type { Terminal } from '@xterm/xterm';

interface Disposable {
  dispose(): void;
}

export function installTerminalClipboard(xterm: Terminal): Disposable {
  xterm.attachCustomKeyEventHandler((event) => {
    if (!isTerminalCopyShortcut(event)) {
      return true;
    }
    const selection = readSelection(xterm);
    if (!selection) {
      return true;
    }
    event.preventDefault();
    event.stopPropagation();
    void writeClipboardText(selection);
    return false;
  });

  const element = xterm.element;
  if (!element) {
    return {
      dispose() {
        xterm.attachCustomKeyEventHandler(() => true);
      }
    };
  }

  const handleCopy = (event: ClipboardEvent) => {
    const selection = readSelection(xterm);
    if (!selection) {
      return;
    }
    if (event.clipboardData) {
      event.clipboardData.setData('text/plain', selection);
      event.preventDefault();
      return;
    }
    event.preventDefault();
    void writeClipboardText(selection);
  };

  element.addEventListener('copy', handleCopy, true);

  return {
    dispose() {
      element.removeEventListener('copy', handleCopy, true);
      xterm.attachCustomKeyEventHandler(() => true);
    }
  };
}

function isTerminalCopyShortcut(event: KeyboardEvent): boolean {
  if (event.type !== 'keydown' || event.altKey) {
    return false;
  }
  if (event.key.toLowerCase() !== 'c') {
    return false;
  }
  if (event.metaKey && !event.ctrlKey && !event.shiftKey) {
    return true;
  }
  return event.ctrlKey && event.shiftKey && !event.metaKey;
}

function readSelection(xterm: Terminal): string {
  if (!xterm.hasSelection()) {
    return '';
  }
  return xterm.getSelection();
}

async function writeClipboardText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall back below for non-secure origins or clipboard permission failures.
    }
  }
  copyViaTemporaryTextArea(text);
}

function copyViaTemporaryTextArea(text: string): void {
  const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.top = '0';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.focus({ preventScroll: true });
  textarea.select();
  try {
    if (typeof document.execCommand === 'function') {
      document.execCommand('copy');
    }
  } finally {
    textarea.remove();
    previousFocus?.focus({ preventScroll: true });
  }
}
