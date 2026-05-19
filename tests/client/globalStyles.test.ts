/// <reference types="node" />
// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('global app styles', () => {
  it('prevents the document and root from becoming page scroll containers', () => {
    const styles = readFileSync('src/client/styles.css', 'utf8');

    expect(styles).toMatch(/html,\s*body,\s*#root\s*\{[^}]*overflow:\s*hidden;[^}]*overscroll-behavior:\s*none;/s);
  });
});
