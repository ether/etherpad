export type RunCMDOptions = {
  cwd?: string,
  stdio?: string | (string | null | Function)[],
  env?: NodeJS.ProcessEnv
}

export type RunCMDPromise = {
  stdout?:Function,
  stderr?:Function
}

export type ErrorExtended = {
  code?: number|null,
  signal?: NodeJS.Signals|null
}