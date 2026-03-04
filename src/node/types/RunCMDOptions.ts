export type RunCMDOptions = {
    cwd?: string,
    stdio?: string[],
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