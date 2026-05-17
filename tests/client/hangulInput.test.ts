import { describe, expect, it } from 'vitest';
import { HangulInputComposer } from '../../src/client/terminal/hangulInput.js';

function feed(composer: HangulInputComposer, input: string): string {
  let output = '';
  for (const char of input) {
    output += composer.accept(char);
  }
  return output;
}

describe('HangulInputComposer', () => {
  it('buffers compatibility jamo until the syllable boundary is known', () => {
    const composer = new HangulInputComposer();
    const outputs = ['ㅎ', 'ㅏ', 'ㄴ', 'ㄱ', 'ㅡ', 'ㄹ', '\r'].map((input) => composer.accept(input));

    expect(outputs).toEqual(['', '', '', '한', '', '', '글\r']);
    expect(outputs.join('')).toBe('한글\r');
  });

  it('moves an ambiguous final consonant to the next syllable when a vowel follows', () => {
    const composer = new HangulInputComposer();

    expect(feed(composer, 'ㄱㅏㄴㅏ ')).toBe('가나 ');
  });

  it('keeps compound final consonants when a new syllable starts with a consonant', () => {
    const composer = new HangulInputComposer();

    expect(feed(composer, 'ㅇㅓㅂㅅㅇㅓ ')).toBe('없어 ');
  });

  it('passes already composed Hangul and ordinary terminal input through', () => {
    const composer = new HangulInputComposer();

    expect(composer.accept('한글')).toBe('한글');
    expect(composer.accept(' && pwd\r')).toBe(' && pwd\r');
  });

  it('treats iOS replacement syllables as pending composition updates', () => {
    const composer = new HangulInputComposer();

    expect(composer.accept('ㄱ')).toBe('');
    expect(composer.accept('가')).toBe('');
    expect(composer.accept('\r')).toBe('가\r');
  });
});
