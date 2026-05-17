export interface PtyExit {
  exitCode: number | null;
}

export interface PtyProcess {
  pid: number;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  onData(listener: (data: string) => void): Disposable;
  onExit(listener: (event: PtyExit) => void): Disposable;
}

export interface Disposable {
  dispose(): void;
}

export interface PtySpawnOptions {
  shell: string;
  cwd: string;
  cols: number;
  rows: number;
  env: NodeJS.ProcessEnv;
}

export interface PtyAdapter {
  spawn(options: PtySpawnOptions): PtyProcess;
}
