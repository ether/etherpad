'use strict';

import {ErrorExtended, RunCMDOptions, RunCMDPromise} from "../types/RunCMDOptions";
import {ChildProcess} from "node:child_process";
import {PromiseWithStd} from "../types/PromiseWithStd";
import {Readable} from "node:stream";

import spawn from 'cross-spawn';
import log4js from 'log4js';
import path from 'path';
import settings from './Settings';

const logger = log4js.getLogger('runCmd');

const logLines = (readable: undefined | Readable | null, logLineFn: (arg0: (string | undefined)) => void) => {
  readable!.setEncoding('utf8');
  // The process won't necessarily write full lines every time -- it might write a part of a line
  // then write the rest of the line later.
  let leftovers: string| undefined = '';
  readable!.on('data', (chunk) => {
    const lines = chunk.split('\n');
    if (lines.length === 0) return;
    lines[0] = leftovers + lines[0];
    leftovers = lines.pop();
    for (const line of lines) {
      logLineFn(line);
    }
  });
  readable!.on('end', () => {
    if (leftovers !== '') logLineFn(leftovers);
    leftovers = '';
  });
};

/**
 * Runs a command, logging its output to Etherpad's logs by default.
 *
 * Examples:
 *
 *   Just run a command, logging stdout and stder to Etherpad's logs:
 *     await runCmd(['ls', '-l']);
 *
 *   Capture just stdout as a string:
 *     const stdout = await runCmd(['ls', '-l'], {stdio: [null, 'string']});
 *
 *   Capture both stdout and stderr as strings:
 *     const p = runCmd(['ls', '-l'], {stdio: 'string'});
 *     const stdout = await p; // Or: await p.stdout;
 *     const stderr = await p.stderr;
 *
 *   Call a callback with each line of stdout:
 *     await runCmd(['ls', '-l'], {stdio: [null, (line) => console.log(line)]});
 *
 * @param args Array of command-line arguments, where `args[0]` is the command to run.
 * @param opts As with `child_process.spawn()`, except:
 *   - `cwd` defaults to the Etherpad root directory.
 *   - `env.PATH` is prefixed with `src/node_modules/.bin:node_modules/.bin` so that utilities from
 *     installed dependencies (e.g., npm) are preferred over system utilities.
 *   - By default stdout and stderr are logged to the Etherpad log at log levels INFO and ERROR.
 *     To pipe without logging you must explicitly use 'pipe' for opts.stdio.
 *   - opts.stdio[1] and opts.stdio[2] can be functions that will be called each time a line (utf8)
 *     is written to stdout or stderr. The line (without its trailing newline, if present) will be
 *     passed as the only argument, and the return value is ignored. opts.stdio = fn is equivalent
 *     to opts.stdio = [null, fn, fn].
 *   - opts.stdio[1] and opts.stdio[2] can be 'string', which will cause output to be collected,
 *     decoded as utf8, and returned (see below). opts.stdio = 'string' is equivalent to
 *     opts.stdio = [null, 'string', 'string'].
 *
 * @returns A Promise that resolves when the command exits. The Promise resolves to the complete
 * stdout if opts.stdio[1] is 'string', otherwise it resolves to undefined. The returned Promise is
 * augmented with these additional properties:
 *   - `stdout`: If opts.stdio[1] is 'pipe', the stdout stream object. If opts.stdio[1] is 'string',
 *     a Promise that will resolve to the complete stdout (utf8 decoded) when the command exits.
 *   - `stderr`: Similar to `stdout` but for stderr.
 *   - `child`: The ChildProcess object.
 */
module.exports = exports = (args: string[], opts:RunCMDOptions = {}) => {
  logger.debug(`Executing command: ${args.join(' ')}`);

  opts = {cwd: settings.root, ...opts};
  logger.debug(`cwd: ${opts.cwd}`);

  // Log stdout and stderr by default.
  const stdio =
      Array.isArray(opts.stdio) ? opts.stdio.slice() // Copy to avoid mutating the caller's array.
      : typeof opts.stdio === 'function' ? [null, opts.stdio, opts.stdio]
      : opts.stdio === 'string' ? [null, 'string', 'string']
      : Array(3).fill(opts.stdio);
  const cmdLogger = log4js.getLogger(`runCmd|${args[0]}`);
  if (stdio[1] == null) stdio[1] = (line: string) => cmdLogger.info(line);
  if (stdio[2] == null) stdio[2] = (line: string) => cmdLogger.error(line);
  const stdioLoggers = [];
  const stdioSaveString = [];
  for (const fd of [1, 2]) {
    if (typeof stdio[fd] === 'function') {
      stdioLoggers[fd] = stdio[fd];
      stdio[fd] = 'pipe';
    } else if (stdio[fd] === 'string') {
      stdioSaveString[fd] = true;
      stdio[fd] = 'pipe';
    }
  }
  opts.stdio = stdio;

  // On Windows the PATH environment var might be spelled "Path".
  const pathVarName =
      Object.keys(process.env).filter((k) => k.toUpperCase() === 'PATH')[0] || 'PATH';
  // Set PATH so that utilities from installed dependencies (e.g., npm) are preferred over system
  // (global) utilities.
  const {env = process.env} = opts;
  const {[pathVarName]: PATH} = env;
  opts.env = {
    ...env, // Copy env to avoid modifying process.env or the caller's supplied env.
    [pathVarName]: [
      path.join(settings.root, 'src', 'node_modules', '.bin'),
      path.join(settings.root, 'node_modules', '.bin'),
      ...(PATH ? PATH.split(path.delimiter) : []),
    ].join(path.delimiter),
  };
  logger.debug(`${pathVarName}=${opts.env[pathVarName]}`);

  // Create an error object to use in case the process fails. This is done here rather than in the
  // process's `exit` handler so that we get a useful stack trace.
  const procFailedErr: Error & ErrorExtended = new Error();

  const proc: ChildProcess = spawn(args[0], args.slice(1), opts as any);
  const streams:[undefined, Readable|null, Readable|null] = [undefined, proc.stdout, proc.stderr];

  let px: { reject: any; resolve: any; };
  const p:PromiseWithStd = new Promise<string>((resolve, reject) => { px = {resolve, reject}; });
  [, p.stdout, p.stderr] = streams;
  p.child = proc;

  const stdioStringPromises = [undefined, Promise.resolve(), Promise.resolve()];
  for (const fd of [1, 2]) {
    if (streams[fd] == null) continue;
    if (stdioLoggers[fd] != null) {
      logLines(streams[fd], stdioLoggers[fd]);
    } else if (stdioSaveString[fd]) {
      // @ts-ignore
      p[[null, 'stdout', 'stderr'][fd]] = stdioStringPromises[fd] = (async () => {
        const chunks = [];
        for await (const chunk of streams[fd]!) chunks.push(chunk);
        return Buffer.concat(chunks).toString().replace(/\n+$/g, '');
      })();
    }
  }

  proc.on('exit', async (code, signal) => {
    const [, stdout] = await Promise.all(stdioStringPromises);
    if (code !== 0) {
      procFailedErr.message =
          `Command exited ${code ? `with code ${code}` : `on signal ${signal}`}: ${args.join(' ')}`;
      procFailedErr.code = code;
      procFailedErr.signal = signal;
      logger.debug(procFailedErr.stack);
      return px.reject(procFailedErr);
    }
    logger.debug(`Command returned successfully: ${args.join(' ')}`);
    px.resolve(stdout);
  });
  return p;
};
