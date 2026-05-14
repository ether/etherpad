import {spawnSync} from 'node:child_process';

export type PnpmCommand = readonly [string, ...string[]];

export const defaultPnpmCommand: PnpmCommand = ['pnpm'];

export const resolvePnpmCommandSync = (cwd: string): PnpmCommand | null => {
  for (const cmd of [defaultPnpmCommand, ['corepack', 'pnpm'] as const]) {
    const [command, ...args] = cmd;
    const result = spawnSync(command, [...args, '--version'], {cwd, stdio: 'ignore'});
    if (result.status === 0) return cmd;
  }
  return null;
};

export const pnpmInvocation = (pnpmCommand: PnpmCommand | undefined, args: string[]) => {
  const [command, ...prefix] = pnpmCommand ?? defaultPnpmCommand;
  return {
    command,
    args: [...prefix, ...args],
    label: `pnpm ${args.join(' ')}`,
  };
};
