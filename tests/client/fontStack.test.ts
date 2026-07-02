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

  it('leaves text-default symbols like U+23FA to browser text-presentation fallback', () => {
    // Listing a color-emoji font would capture symbols missing from the bundled
    // fonts (⏺ ⏸ ⏹) and render them as emoji buttons that ignore ANSI colors.
    expect(terminalFontFamily).not.toContain('Apple Color Emoji');
  });

  it('pins STIX Two Math before monospace so ⏺ ⏸ ⏹ match iTerm2 on Apple platforms', () => {
    // CoreText (iTerm2) and Blink both fall back to STIX Two Math for U+23FA;
    // listing it explicitly makes WebKit deterministic too instead of relying
    // on its emoji-leaning automatic fallback.
    expect(terminalFontFamily.indexOf('"STIX Two Math"')).toBeGreaterThan(
      terminalFontFamily.indexOf('"Apple Symbols"')
    );
    expect(terminalFontFamily.indexOf('"STIX Two Math"')).toBeLessThan(
      terminalFontFamily.indexOf('monospace')
    );
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
