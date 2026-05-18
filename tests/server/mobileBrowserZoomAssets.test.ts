import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

describe('mobile browser zoom assets', () => {
  it('locks mobile viewport scaling for the full-screen terminal surface', async () => {
    const html = await readFile(path.join(repoRoot, 'index.html'), 'utf8');
    const viewportContent = html.match(/<meta name="viewport" content="([^"]+)"/)?.[1];

    expect(viewportContent).toBeDefined();
    expect(viewportContent).toContain('width=device-width');
    expect(viewportContent).toContain('initial-scale=1.0');
    expect(viewportContent).toContain('minimum-scale=1.0');
    expect(viewportContent).toContain('maximum-scale=1.0');
    expect(viewportContent).toContain('user-scalable=no');
    expect(viewportContent).toContain('viewport-fit=cover');
  });

  it('keeps focused mobile inputs large enough to avoid iOS focus zoom', async () => {
    const styles = await readFile(path.join(repoRoot, 'src/client/styles.css'), 'utf8');

    expect(styles).toMatch(/@media \(max-width: 760px\)[\s\S]*input[\s\S]*font-size:\s*16px/);
    expect(styles).toMatch(/@media \(max-width: 760px\)[\s\S]*\.xterm \.xterm-helper-textarea[\s\S]*font-size:\s*16px/);
  });
});
