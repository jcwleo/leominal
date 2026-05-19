import { describe, expect, it, vi } from 'vitest';
import { installInactiveTerminalReportGuards } from '../../src/client/terminal/terminalReportGuards.js';

interface HandlerCall {
  id: { prefix?: string; intermediates?: string; final?: string } | number;
  callback: (...args: unknown[]) => boolean | Promise<boolean>;
  type: 'csi' | 'dcs' | 'osc';
}

function createTerminal() {
  const handlers: HandlerCall[] = [];
  const register = (type: HandlerCall['type']) =>
    vi.fn((id: HandlerCall['id'], callback: HandlerCall['callback']) => {
      handlers.push({ id, callback, type });
      return { dispose: vi.fn() };
    });

  return {
    handlers,
    terminal: {
      parser: {
        registerCsiHandler: register('csi'),
        registerDcsHandler: register('dcs'),
        registerEscHandler: vi.fn(),
        registerOscHandler: register('osc')
      }
    }
  };
}

function findHandler(handlers: HandlerCall[], type: HandlerCall['type'], id: HandlerCall['id']) {
  return handlers.find((handler) => handler.type === type && JSON.stringify(handler.id) === JSON.stringify(id));
}

describe('inactive terminal report guards', () => {
  it('suppresses report-producing terminal queries while the pane is inactive', () => {
    let active = false;
    const { handlers, terminal } = createTerminal();

    installInactiveTerminalReportGuards(terminal, () => active);

    expect(findHandler(handlers, 'csi', { final: 'c' })?.callback([0])).toBe(true);
    expect(findHandler(handlers, 'csi', { prefix: '>', final: 'c' })?.callback([0])).toBe(true);
    expect(findHandler(handlers, 'csi', { final: 'n' })?.callback([6])).toBe(true);
    expect(findHandler(handlers, 'csi', { prefix: '?', final: 'n' })?.callback([6])).toBe(true);
    expect(findHandler(handlers, 'csi', { final: 't' })?.callback([18])).toBe(true);
    expect(findHandler(handlers, 'dcs', { intermediates: '$', final: 'q' })?.callback('', [])).toBe(true);
    expect(findHandler(handlers, 'osc', 10)?.callback('?')).toBe(true);
    expect(findHandler(handlers, 'osc', 11)?.callback('?')).toBe(true);

    active = true;

    expect(findHandler(handlers, 'csi', { final: 'c' })?.callback([0])).toBe(false);
    expect(findHandler(handlers, 'csi', { final: 'n' })?.callback([6])).toBe(false);
    expect(findHandler(handlers, 'osc', 10)?.callback('?')).toBe(false);
  });

  it('lets non-reporting control sequences fall through to xterm handlers', () => {
    const { handlers, terminal } = createTerminal();

    installInactiveTerminalReportGuards(terminal, () => false);

    expect(findHandler(handlers, 'csi', { final: 'n' })?.callback([4])).toBe(false);
    expect(findHandler(handlers, 'csi', { prefix: '?', final: 'n' })?.callback([15])).toBe(false);
    expect(findHandler(handlers, 'csi', { final: 't' })?.callback([22])).toBe(false);
    expect(findHandler(handlers, 'osc', 10)?.callback('#ffffff')).toBe(false);
    expect(findHandler(handlers, 'osc', 11)?.callback('rgb:0000/0000/0000')).toBe(false);
  });
});
