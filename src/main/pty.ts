import * as pty from 'node-pty';
import { homedir } from 'node:os';

export interface PtyHandle {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
}

export function spawnShell(
  onData: (data: string) => void,
  onExit: () => void,
): PtyHandle {
  const shell = process.env.SHELL || (process.platform === 'win32' ? 'powershell.exe' : '/bin/zsh');
  const args = process.platform === 'win32' ? [] : ['-l'];

  const proc = pty.spawn(shell, args, {
    name: 'xterm-256color',
    cols: 80,
    rows: 24,
    cwd: homedir(),
    env: { ...process.env, TERM_PROGRAM: 'slate', COLORTERM: 'truecolor' } as Record<string, string>,
  });

  proc.onData(onData);
  proc.onExit(onExit);

  return {
    write: (d) => proc.write(d),
    resize: (cols, rows) => {
      if (cols > 0 && rows > 0) proc.resize(cols, rows);
    },
    kill: () => {
      try { proc.kill(); } catch { /* already gone */ }
    },
  };
}
