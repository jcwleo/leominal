export type MobileTerminalStandaloneKey = 'escape' | 'tab' | 'arrowLeft' | 'arrowRight' | 'arrowUp' | 'arrowDown';

const standaloneSequences = {
  escape: '\x1b',
  tab: '\t',
  arrowUp: '\x1b[A',
  arrowDown: '\x1b[B',
  arrowRight: '\x1b[C',
  arrowLeft: '\x1b[D'
} satisfies Record<MobileTerminalStandaloneKey, string>;

export function terminalKeySequence(key: MobileTerminalStandaloneKey): string {
  return standaloneSequences[key];
}

export function ctrlModifiedData(data: string): string | null {
  if (!/^[a-z]$/i.test(data)) {
    return null;
  }
  return String.fromCharCode(data.toUpperCase().charCodeAt(0) - 64);
}
