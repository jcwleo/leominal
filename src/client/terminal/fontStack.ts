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
  '"Apple Color Emoji"',
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
