import type { IDisposable, Terminal } from '@xterm/xterm';

type ParserTerminal = Pick<Terminal, 'parser'>;
type CsiParams = Array<number | number[]>;

const reportOscIds = [4, 10, 11, 12] as const;

export function installInactiveTerminalReportGuards(terminal: ParserTerminal, isActive: () => boolean): IDisposable {
  const disposables: IDisposable[] = [
    terminal.parser.registerCsiHandler({ final: 'c' }, (params) =>
      shouldSuppressReport(isPrimaryDeviceAttributesRequest(params), isActive)
    ),
    terminal.parser.registerCsiHandler({ prefix: '>', final: 'c' }, (params) =>
      shouldSuppressReport(isPrimaryDeviceAttributesRequest(params), isActive)
    ),
    terminal.parser.registerCsiHandler({ final: 'n' }, (params) => shouldSuppressReport(isDeviceStatusReportRequest(params), isActive)),
    terminal.parser.registerCsiHandler({ prefix: '?', final: 'n' }, (params) =>
      shouldSuppressReport(isPrivateDeviceStatusReportRequest(params), isActive)
    ),
    terminal.parser.registerCsiHandler({ final: 't' }, (params) => shouldSuppressReport(isWindowReportRequest(params), isActive)),
    terminal.parser.registerDcsHandler({ intermediates: '$', final: 'q' }, () => shouldSuppressReport(true, isActive)),
    ...reportOscIds.map((id) =>
      terminal.parser.registerOscHandler(id, (data) => shouldSuppressReport(isOscReportRequest(data), isActive))
    )
  ];

  return {
    dispose() {
      for (const disposable of disposables) {
        disposable.dispose();
      }
    }
  };
}

function shouldSuppressReport(isReportRequest: boolean, isActive: () => boolean): boolean {
  return isReportRequest && !isActive();
}

function isPrimaryDeviceAttributesRequest(params: CsiParams): boolean {
  return firstParam(params) === 0;
}

function isDeviceStatusReportRequest(params: CsiParams): boolean {
  const report = firstParam(params);
  return report === 5 || report === 6;
}

function isPrivateDeviceStatusReportRequest(params: CsiParams): boolean {
  return firstParam(params) === 6;
}

function isWindowReportRequest(params: CsiParams): boolean {
  const report = firstParam(params);
  return report === 14 || report === 16 || report === 18;
}

function isOscReportRequest(data: string): boolean {
  return data.split(';').some((slot) => slot === '?');
}

function firstParam(params: CsiParams): number {
  const first = params[0];
  return typeof first === 'number' ? first : 0;
}
