export class HangulInputComposer {
  private pending: PendingHangul | null = null;

  accept(data: string): string {
    let output = '';
    for (const char of data) {
      output += this.acceptChar(char);
    }
    return output;
  }

  private acceptChar(char: string): string {
    if (char === '\x7f') {
      return this.acceptBackspace();
    }
    if (INITIAL_INDEX.has(char)) {
      return this.acceptConsonant(char);
    }
    if (VOWEL_INDEX.has(char)) {
      return this.acceptVowel(char);
    }
    if (isHangulSyllable(char) && this.canReplacePendingWith(char)) {
      this.pending = decomposeSyllable(char);
      return '';
    }
    return this.flushPending() + char;
  }

  private acceptConsonant(consonant: string): string {
    if (!this.pending) {
      this.pending = { initial: consonant };
      return '';
    }

    if (!this.pending.vowel) {
      const output = this.flushPending();
      this.pending = { initial: consonant };
      return output;
    }

    if (!this.pending.final) {
      if (FINAL_INDEX.has(consonant)) {
        this.pending.final = consonant;
        return '';
      }
      const output = this.flushPending();
      this.pending = { initial: consonant };
      return output;
    }

    const combinedFinal = COMPOUND_FINALS.get(`${this.pending.final}${consonant}`);
    if (combinedFinal) {
      this.pending.final = combinedFinal;
      return '';
    }

    const output = this.flushPending();
    this.pending = { initial: consonant };
    return output;
  }

  private acceptVowel(vowel: string): string {
    if (!this.pending) {
      return vowel;
    }

    if (!this.pending.vowel) {
      this.pending.vowel = vowel;
      return '';
    }

    if (!this.pending.final) {
      const combinedVowel = COMPOUND_VOWELS.get(`${this.pending.vowel}${vowel}`);
      if (combinedVowel) {
        this.pending.vowel = combinedVowel;
        return '';
      }
      return this.flushPending() + vowel;
    }

    const splitFinal = SPLIT_FINALS.get(this.pending.final);
    if (splitFinal) {
      this.pending.final = splitFinal[0];
      const output = this.flushPending();
      this.pending = { initial: splitFinal[1], vowel };
      return output;
    }

    const nextInitial = this.pending.final;
    const output = renderHangul({ initial: this.pending.initial, vowel: this.pending.vowel });
    this.pending = { initial: nextInitial, vowel };
    return output;
  }

  private acceptBackspace(): string {
    if (!this.pending) {
      return '\x7f';
    }

    if (this.pending.final) {
      const splitFinal = SPLIT_FINALS.get(this.pending.final);
      if (splitFinal) {
        this.pending.final = splitFinal[0];
      } else {
        delete this.pending.final;
      }
      return '';
    }

    if (this.pending.vowel) {
      delete this.pending.vowel;
      return '';
    }

    this.pending = null;
    return '';
  }

  private canReplacePendingWith(char: string): boolean {
    if (!this.pending?.initial) {
      return false;
    }

    const replacement = decomposeSyllable(char);
    return (
      replacement.initial === this.pending.initial &&
      (!this.pending.vowel || replacement.vowel === this.pending.vowel) &&
      (!this.pending.final || replacement.final === this.pending.final)
    );
  }

  private flushPending(): string {
    if (!this.pending) {
      return '';
    }
    const output = renderHangul(this.pending);
    this.pending = null;
    return output;
  }
}

interface PendingHangul {
  initial: string;
  vowel?: string;
  final?: string;
}

const HANGUL_BASE = 0xac00;
const VOWEL_COUNT = 21;
const FINAL_COUNT = 28;
const SYLLABLE_COUNT = 19 * VOWEL_COUNT * FINAL_COUNT;

const INITIALS = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
const VOWELS = ['ㅏ', 'ㅐ', 'ㅑ', 'ㅒ', 'ㅓ', 'ㅔ', 'ㅕ', 'ㅖ', 'ㅗ', 'ㅘ', 'ㅙ', 'ㅚ', 'ㅛ', 'ㅜ', 'ㅝ', 'ㅞ', 'ㅟ', 'ㅠ', 'ㅡ', 'ㅢ', 'ㅣ'];
const FINALS = ['', 'ㄱ', 'ㄲ', 'ㄳ', 'ㄴ', 'ㄵ', 'ㄶ', 'ㄷ', 'ㄹ', 'ㄺ', 'ㄻ', 'ㄼ', 'ㄽ', 'ㄾ', 'ㄿ', 'ㅀ', 'ㅁ', 'ㅂ', 'ㅄ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];

const INITIAL_INDEX = indexMap(INITIALS);
const VOWEL_INDEX = indexMap(VOWELS);
const FINAL_INDEX = indexMap(FINALS);

const COMPOUND_VOWELS = new Map([
  ['ㅗㅏ', 'ㅘ'],
  ['ㅗㅐ', 'ㅙ'],
  ['ㅗㅣ', 'ㅚ'],
  ['ㅜㅓ', 'ㅝ'],
  ['ㅜㅔ', 'ㅞ'],
  ['ㅜㅣ', 'ㅟ'],
  ['ㅡㅣ', 'ㅢ']
]);

const COMPOUND_FINAL_ENTRIES = [
  ['ㄱㅅ', 'ㄳ'],
  ['ㄴㅈ', 'ㄵ'],
  ['ㄴㅎ', 'ㄶ'],
  ['ㄹㄱ', 'ㄺ'],
  ['ㄹㅁ', 'ㄻ'],
  ['ㄹㅂ', 'ㄼ'],
  ['ㄹㅅ', 'ㄽ'],
  ['ㄹㅌ', 'ㄾ'],
  ['ㄹㅍ', 'ㄿ'],
  ['ㄹㅎ', 'ㅀ'],
  ['ㅂㅅ', 'ㅄ']
] as const;

const COMPOUND_FINALS = new Map<string, string>(COMPOUND_FINAL_ENTRIES);
const SPLIT_FINALS = new Map<string, readonly [string, string]>(
  COMPOUND_FINAL_ENTRIES.map(([parts, final]) => [final, [parts[0]!, parts[1]!] as const])
);

function indexMap(values: string[]): Map<string, number> {
  return new Map(values.map((value, index) => [value, index]));
}

function isHangulSyllable(char: string): boolean {
  const codePoint = char.codePointAt(0);
  return codePoint !== undefined && codePoint >= HANGUL_BASE && codePoint < HANGUL_BASE + SYLLABLE_COUNT;
}

function decomposeSyllable(char: string): PendingHangul {
  const offset = char.codePointAt(0)! - HANGUL_BASE;
  const initialIndex = Math.floor(offset / (VOWEL_COUNT * FINAL_COUNT));
  const vowelIndex = Math.floor((offset % (VOWEL_COUNT * FINAL_COUNT)) / FINAL_COUNT);
  const finalIndex = offset % FINAL_COUNT;
  const pending = {
    initial: INITIALS[initialIndex]!,
    vowel: VOWELS[vowelIndex]!
  };
  return finalIndex === 0 ? pending : { ...pending, final: FINALS[finalIndex]! };
}

function renderHangul(pending: PendingHangul): string {
  if (!pending.vowel) {
    return pending.initial;
  }

  const initialIndex = INITIAL_INDEX.get(pending.initial);
  const vowelIndex = VOWEL_INDEX.get(pending.vowel);
  const finalIndex = pending.final ? FINAL_INDEX.get(pending.final) : 0;
  if (initialIndex === undefined || vowelIndex === undefined || finalIndex === undefined) {
    return `${pending.initial}${pending.vowel}${pending.final ?? ''}`;
  }

  return String.fromCodePoint(HANGUL_BASE + (initialIndex * VOWEL_COUNT + vowelIndex) * FINAL_COUNT + finalIndex);
}
