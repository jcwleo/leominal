import { describe, expect, it } from 'vitest';
import { ctrlModifiedData, terminalKeySequence } from '../../src/client/terminal/mobileTerminalKeys.js';

describe('mobile terminal key helpers', () => {
  it('maps standalone helper keys to terminal input sequences', () => {
    expect(terminalKeySequence('escape')).toBe('\x1b');
    expect(terminalKeySequence('tab')).toBe('\t');
    expect(terminalKeySequence('arrowUp')).toBe('\x1b[A');
    expect(terminalKeySequence('arrowDown')).toBe('\x1b[B');
    expect(terminalKeySequence('arrowRight')).toBe('\x1b[C');
    expect(terminalKeySequence('arrowLeft')).toBe('\x1b[D');
  });

  it('converts ASCII letters to one-shot Ctrl control characters', () => {
    expect(ctrlModifiedData('c')).toBe('\x03');
    expect(ctrlModifiedData('C')).toBe('\x03');
    expect(ctrlModifiedData('d')).toBe('\x04');
    expect(ctrlModifiedData('z')).toBe('\x1a');
  });

  it('does not convert non-letter or multi-character input', () => {
    expect(ctrlModifiedData('ㄱ')).toBeNull();
    expect(ctrlModifiedData('\r')).toBeNull();
    expect(ctrlModifiedData('paste')).toBeNull();
  });
});
