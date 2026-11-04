'use strict';

// Child process for takeOverSignal.test.ts. Simulates #8421: a SIGTERM arrives while the event
// loop is blocked by synchronous startup work, and then the existing listener is replaced.
import {takeOverSignal} from '../../../node/utils/takeOverSignal';

const early = () => {};
process.on('SIGTERM', early);
setTimeout(() => {
  process.kill(process.pid, 'SIGTERM');
  const t = Date.now();
  while (Date.now() - t < 200); // Busy-wait so the signal is caught but not yet dispatched.
  takeOverSignal('SIGTERM', () => {
    process.stdout.write('handled\n');
    process.exit(0);
  });
  setTimeout(() => {
    process.stdout.write('lost\n');
    process.exit(1);
  }, 3000);
}, 50);
