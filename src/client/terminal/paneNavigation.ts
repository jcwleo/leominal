import type { LayoutNode, TerminalId } from '../../shared/types.js';

export type PaneNavigationDirection = 'up' | 'down' | 'left' | 'right';

export interface PaneBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
  centerX: number;
  centerY: number;
}

export interface PaneNavigationEntry {
  terminalId: TerminalId;
  index: number;
  bounds: PaneBounds;
}

interface RawPaneEntry {
  terminalId: TerminalId;
  bounds: PaneBounds;
}

interface DirectionScore {
  entry: PaneNavigationEntry;
  primaryDistance: number;
  perpendicularDistance: number;
  overlap: number;
}

const rootBounds = createBounds(0, 0, 1, 1);
const epsilon = 0.000001;

export function getPaneScreenReadingOrder(root: LayoutNode): TerminalId[] {
  return getPaneNavigationEntries(root).map((entry) => entry.terminalId);
}

export function getPaneNavigationEntries(root: LayoutNode): PaneNavigationEntry[] {
  return collectPaneEntries(root, rootBounds)
    .sort(compareScreenPosition)
    .map((entry, index) => ({ ...entry, index: index + 1 }));
}

export function getDirectionalPaneTarget(
  root: LayoutNode,
  activeTerminalId: TerminalId,
  direction: PaneNavigationDirection
): TerminalId | null {
  const entries = getPaneNavigationEntries(root);
  const activeEntry = entries.find((entry) => entry.terminalId === activeTerminalId);
  if (!activeEntry) {
    return null;
  }

  const scores = entries
    .filter((entry) => entry.terminalId !== activeTerminalId)
    .map((entry) => scoreDirectionalCandidate(activeEntry, entry, direction))
    .filter((score): score is DirectionScore => score !== null)
    .sort(compareDirectionScores);

  return scores[0]?.entry.terminalId ?? null;
}

export function getNextPaneTarget(root: LayoutNode, activeTerminalId: TerminalId): TerminalId | null {
  return getRelativePaneTarget(root, activeTerminalId, 1);
}

export function getPreviousPaneTarget(root: LayoutNode, activeTerminalId: TerminalId): TerminalId | null {
  return getRelativePaneTarget(root, activeTerminalId, -1);
}

export function getPaneTargetByIndex(root: LayoutNode, index: number): TerminalId | null {
  if (!Number.isInteger(index) || index < 1) {
    return null;
  }
  return getPaneScreenReadingOrder(root)[index - 1] ?? null;
}

function getRelativePaneTarget(root: LayoutNode, activeTerminalId: TerminalId, offset: -1 | 1): TerminalId | null {
  const order = getPaneScreenReadingOrder(root);
  const activeIndex = order.indexOf(activeTerminalId);
  if (activeIndex === -1 || order.length < 2) {
    return null;
  }

  const targetIndex = (activeIndex + offset + order.length) % order.length;
  return order[targetIndex] ?? null;
}

function collectPaneEntries(node: LayoutNode, bounds: PaneBounds): RawPaneEntry[] {
  if (node.type === 'pane') {
    return [{ terminalId: node.terminalId, bounds }];
  }

  const ratio = clampRatio(node.ratio);
  if (node.direction === 'vertical') {
    const splitX = bounds.left + (bounds.right - bounds.left) * ratio;
    return [
      ...collectPaneEntries(node.first, createBounds(bounds.left, bounds.top, splitX, bounds.bottom)),
      ...collectPaneEntries(node.second, createBounds(splitX, bounds.top, bounds.right, bounds.bottom))
    ];
  }

  const splitY = bounds.top + (bounds.bottom - bounds.top) * ratio;
  return [
    ...collectPaneEntries(node.first, createBounds(bounds.left, bounds.top, bounds.right, splitY)),
    ...collectPaneEntries(node.second, createBounds(bounds.left, splitY, bounds.right, bounds.bottom))
  ];
}

function scoreDirectionalCandidate(
  activeEntry: PaneNavigationEntry,
  entry: PaneNavigationEntry,
  direction: PaneNavigationDirection
): DirectionScore | null {
  const active = activeEntry.bounds;
  const candidate = entry.bounds;
  const horizontalOverlap = overlap(active.left, active.right, candidate.left, candidate.right);
  const verticalOverlap = overlap(active.top, active.bottom, candidate.top, candidate.bottom);

  switch (direction) {
    case 'left':
      if (candidate.centerX >= active.centerX - epsilon || verticalOverlap <= epsilon) {
        return null;
      }
      return {
        entry,
        primaryDistance: Math.max(0, active.left - candidate.right),
        perpendicularDistance: Math.abs(active.centerY - candidate.centerY),
        overlap: verticalOverlap
      };
    case 'right':
      if (candidate.centerX <= active.centerX + epsilon || verticalOverlap <= epsilon) {
        return null;
      }
      return {
        entry,
        primaryDistance: Math.max(0, candidate.left - active.right),
        perpendicularDistance: Math.abs(active.centerY - candidate.centerY),
        overlap: verticalOverlap
      };
    case 'up':
      if (candidate.centerY >= active.centerY - epsilon || horizontalOverlap <= epsilon) {
        return null;
      }
      return {
        entry,
        primaryDistance: Math.max(0, active.top - candidate.bottom),
        perpendicularDistance: Math.abs(active.centerX - candidate.centerX),
        overlap: horizontalOverlap
      };
    case 'down':
      if (candidate.centerY <= active.centerY + epsilon || horizontalOverlap <= epsilon) {
        return null;
      }
      return {
        entry,
        primaryDistance: Math.max(0, candidate.top - active.bottom),
        perpendicularDistance: Math.abs(active.centerX - candidate.centerX),
        overlap: horizontalOverlap
      };
    default:
      return null;
  }
}

function compareScreenPosition(first: RawPaneEntry, second: RawPaneEntry): number {
  return compareNumbers(first.bounds.top, second.bounds.top) || compareNumbers(first.bounds.left, second.bounds.left);
}

function compareDirectionScores(first: DirectionScore, second: DirectionScore): number {
  return (
    compareNumbers(first.primaryDistance, second.primaryDistance) ||
    compareNumbers(first.perpendicularDistance, second.perpendicularDistance) ||
    compareNumbers(second.overlap, first.overlap) ||
    compareNumbers(first.entry.index, second.entry.index)
  );
}

function compareNumbers(first: number, second: number): number {
  const difference = first - second;
  return Math.abs(difference) <= epsilon ? 0 : difference;
}

function overlap(firstStart: number, firstEnd: number, secondStart: number, secondEnd: number): number {
  return Math.max(0, Math.min(firstEnd, secondEnd) - Math.max(firstStart, secondStart));
}

function createBounds(left: number, top: number, right: number, bottom: number): PaneBounds {
  return {
    left,
    top,
    right,
    bottom,
    centerX: left + (right - left) / 2,
    centerY: top + (bottom - top) / 2
  };
}

function clampRatio(ratio: number): number {
  return Number.isFinite(ratio) ? Math.min(0.9, Math.max(0.1, ratio)) : 0.5;
}
