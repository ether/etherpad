'use strict';

// Tracks the in-flight batch of install/uninstall operations and decides when
// to fire the "all tasks finished" side effect (reload settings, restart
// server). Extracted so it can be unit-tested without dragging in the
// LinkInstaller circular import.
//
// Crucial invariant: onFinished MUST NOT run when every task in the batch
// failed — that path is reachable now that install() correctly propagates
// errors to its callback. Restarting the server on a failed install would
// disconnect every connected pad for no reason.
export class InstallerTaskQueue {
  private tasks = 0;
  private anyTaskSucceeded = false;

  constructor(private readonly onFinished: () => unknown) {}

  wrap(cb: Function | null): (...args: unknown[]) => void {
    this.tasks++;
    return (...args: unknown[]) => {
      if (!args[0]) this.anyTaskSucceeded = true;
      if (cb) cb(...args);
      this.tasks--;
      if (this.tasks === 0) {
        const shouldFinish = this.anyTaskSucceeded;
        this.anyTaskSucceeded = false;
        if (shouldFinish) this.onFinished();
      }
    };
  }
}
