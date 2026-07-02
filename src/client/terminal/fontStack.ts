const terminalWebFontFamilies = ['"MesloLGS NF"'] as const;
const terminalFontLoadTimeoutMs = 1_500;

export const terminalFontSize = 13;

export const terminalFontFamily = [
  '"MesloLGS NF"',
  '"MesloLGS Nerd Font Mono"',
  '"MesloLGSNerdFontMono"',
  '"JetBrainsMono Nerd Font"',
  '"Hack Nerd Font"',
  '"FiraCode Nerd Font"',
  '"SF Mono"',
  'Menlo',
  'Monaco',
  'Consolas',
  '"Liberation Mono"',
  '"Symbols Nerd Font Mono"',
  '"Apple Symbols"',
  // Covers ⏺ ⏸ ⏹ (U+23F8–23FA) with text glyphs on Apple platforms — the same
  // font CoreText picks for iTerm2 — so WebKit cannot route them to the color
  // emoji font. Unresolved (ignored) on non-Apple clients.
  '"STIX Two Math"',
  // No color-emoji font here: it would capture text-default symbols missing
  // from the fonts above (⏺ ⏸ ⏹) and render them as emoji buttons that ignore
  // ANSI colors. Emoji-default characters still reach the system emoji font
  // through the browser's automatic fallback.
  'monospace'
].join(', ');

export async function waitForTerminalFonts(fontSize = terminalFontSize): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) {
    return;
  }

  const fontLoads = Promise.all(
    terminalWebFontFamilies.map((fontFamily) => document.fonts.load(`${fontSize}px ${fontFamily}`))
  )
    .then(() => undefined)
    .catch(() => undefined);

  await Promise.race([
    fontLoads,
    new Promise<void>((resolve) => {
      globalThis.setTimeout(resolve, terminalFontLoadTimeoutMs);
    })
  ]);
}
