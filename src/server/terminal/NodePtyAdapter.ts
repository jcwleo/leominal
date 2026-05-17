import * as nodePty from 'node-pty';
import type { PtyAdapter, PtyProcess, PtySpawnOptions } from './PtyAdapter.js';

export class NodePtyAdapter implements PtyAdapter {
  spawn(options: PtySpawnOptions): PtyProcess {
    const pty = nodePty.spawn(options.shell, [], {
      name: 'xterm-256color',
      cols: options.cols,
      rows: options.rows,
      cwd: options.cwd,
      env: options.env
    });
    return pty;
  }
}
