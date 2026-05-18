import { describe, expect, it } from 'vitest';
import type { LayoutNode } from '../../src/shared/types.js';
import {
  getDirectionalPaneTarget,
  getNextPaneTarget,
  getPaneScreenReadingOrder,
  getPaneTargetByIndex,
  getPreviousPaneTarget
} from '../../src/client/terminal/paneNavigation.js';

const readingOrderLayout = {
  type: 'split',
  direction: 'vertical',
  ratio: 0.4,
  first: {
    type: 'split',
    direction: 'horizontal',
    ratio: 0.45,
    first: { type: 'pane', terminalId: 'term-a' },
    second: { type: 'pane', terminalId: 'term-c' }
  },
  second: { type: 'pane', terminalId: 'term-b' }
} satisfies LayoutNode;

const gridLayout = {
  type: 'split',
  direction: 'horizontal',
  ratio: 0.5,
  first: {
    type: 'split',
    direction: 'vertical',
    ratio: 0.5,
    first: { type: 'pane', terminalId: 'term-a' },
    second: { type: 'pane', terminalId: 'term-b' }
  },
  second: {
    type: 'split',
    direction: 'vertical',
    ratio: 0.5,
    first: { type: 'pane', terminalId: 'term-c' },
    second: { type: 'pane', terminalId: 'term-d' }
  }
} satisfies LayoutNode;

describe('pane navigation helper', () => {
  it('orders panes by screen position', () => {
    expect(getPaneScreenReadingOrder(readingOrderLayout)).toEqual(['term-a', 'term-b', 'term-c']);
  });

  it('selects horizontal directional neighbors', () => {
    expect(getDirectionalPaneTarget(gridLayout, 'term-a', 'right')).toBe('term-b');
    expect(getDirectionalPaneTarget(gridLayout, 'term-d', 'left')).toBe('term-c');
    expect(getDirectionalPaneTarget(gridLayout, 'term-b', 'right')).toBeNull();
  });

  it('selects vertical directional neighbors', () => {
    expect(getDirectionalPaneTarget(gridLayout, 'term-a', 'down')).toBe('term-c');
    expect(getDirectionalPaneTarget(gridLayout, 'term-d', 'up')).toBe('term-b');
    expect(getDirectionalPaneTarget(gridLayout, 'term-c', 'down')).toBeNull();
  });

  it('wraps relative pane navigation', () => {
    expect(getNextPaneTarget(readingOrderLayout, 'term-a')).toBe('term-b');
    expect(getNextPaneTarget(readingOrderLayout, 'term-c')).toBe('term-a');
    expect(getPreviousPaneTarget(readingOrderLayout, 'term-a')).toBe('term-c');
    expect(getPreviousPaneTarget(readingOrderLayout, 'term-b')).toBe('term-a');
    expect(getNextPaneTarget(readingOrderLayout, 'term-missing')).toBeNull();
  });

  it('does not select the same pane for relative navigation in a single pane tab', () => {
    const singlePane = { type: 'pane', terminalId: 'term-only' } satisfies LayoutNode;

    expect(getNextPaneTarget(singlePane, 'term-only')).toBeNull();
    expect(getPreviousPaneTarget(singlePane, 'term-only')).toBeNull();
  });

  it('selects panes by one based reading index', () => {
    expect(getPaneTargetByIndex(readingOrderLayout, 1)).toBe('term-a');
    expect(getPaneTargetByIndex(readingOrderLayout, 2)).toBe('term-b');
    expect(getPaneTargetByIndex(readingOrderLayout, 3)).toBe('term-c');
    expect(getPaneTargetByIndex(readingOrderLayout, 0)).toBeNull();
    expect(getPaneTargetByIndex(readingOrderLayout, 4)).toBeNull();
  });
});
