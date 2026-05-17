// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { terminalFontFamily, waitForTerminalFonts } from '../../src/client/terminal/fontStack.js';

describe('terminal font stack', () => {
  const originalFonts = document.fonts;

  afterEach(() => {
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: originalFonts
    });
    vi.useRealTimers();
  });

  it('prefers bundled terminal web fonts before the browser monospace fallback', () => {
    expect(terminalFontFamily).toContain('"MesloLGS NF"');
    expect(terminalFontFamily.indexOf('"MesloLGS NF"')).toBeLessThan(terminalFontFamily.indexOf('monospace'));
  });

  it('requests terminal web fonts before xterm measures cell dimensions', async () => {
    const load = vi.fn().mockResolvedValue([]);
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: { load }
    });

    await waitForTerminalFonts(13);

    expect(load).toHaveBeenCalledWith('13px "MesloLGS NF"');
  });
});
