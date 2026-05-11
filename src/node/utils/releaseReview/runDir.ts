'use strict';

import * as fs from 'fs';
import * as path from 'path';

const RUN_RE = /^run-(\d{4}-\d{2}-\d{2})-(\d+)$/;

/** Today's date as YYYY-MM-DD in the local timezone. */
export const todayIso = (): string => {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

/**
 * Determine the next run-id for `date` (YYYY-MM-DD), based on existing run dirs
 * directly under `baseDir`. Returns "run-<date>-N" where N is the next free index
 * starting at 1 for a fresh day.
 */
export const nextRunId = (baseDir: string, date: string): string => {
  let maxN = 0;
  if (fs.existsSync(baseDir)) {
    for (const name of fs.readdirSync(baseDir)) {
      const m = RUN_RE.exec(name);
      if (m && m[1] === date) {
        const n = parseInt(m[2], 10);
        if (n > maxN) maxN = n;
      }
    }
  }
  return `run-${date}-${maxN + 1}`;
};

/** Create the run dir (idempotent) and return its absolute path. */
export const ensureRunDir = (baseDir: string, runId: string): string => {
  const p = path.join(baseDir, runId);
  fs.mkdirSync(p, {recursive: true});
  return p;
};
