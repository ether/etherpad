'use strict';

import * as fs from 'fs';
import * as path from 'path';
import {nextRunId, todayIso} from './runDir';
import {loadSuppression, appendSuppression} from './suppression';
import {aggregate} from './aggregate';
import {classify} from './triage';
import {writeSummary} from './summary';
import {computeFingerprint} from './fingerprint';
import {Finding, Severity, SuppressionEntry} from './types';

const die = (msg: string): never => {
  process.stderr.write(`release-review-cli: ${msg}\n`);
  process.exit(2);
  throw new Error('unreachable');
};

const readJson = <T>(p: string): T => {
  if (!fs.existsSync(p)) die(`file not found: ${p}`);
  return JSON.parse(fs.readFileSync(p, 'utf8'));
};

const cmds: Record<string, (args: string[]) => void> = {
  'next-run-id': (args) => {
    const [baseDir, dateMaybe] = args;
    if (!baseDir) die('usage: next-run-id <baseDir> [date]');
    process.stdout.write(nextRunId(baseDir, dateMaybe || todayIso()) + '\n');
  },

  aggregate: (args) => {
    const [runDir, supPath, floor, repoRoot] = args;
    if (!runDir || !supPath || !floor || !repoRoot) die('usage: aggregate <runDir> <suppressionPath> <severityFloor> <repoRoot>');
    const fileLineCache = new Map<string, string[]>();
    const readLines = (file: string): string[] => {
      const abs = path.isAbsolute(file) ? file : path.join(repoRoot, file);
      if (!fileLineCache.has(abs)) {
        fileLineCache.set(
          abs,
          fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8').split('\n') : [],
        );
      }
      return fileLineCache.get(abs)!;
    };
    const enrich = (raw: any): Finding => {
      // Subagent JSON may be top-level array OR {findings: [...]}.
      if (raw.fingerprint) return raw;
      const lines = readLines(raw.file);
      const fp = computeFingerprint(raw.ruleId, raw.file, raw.line, lines);
      return {...raw, fingerprint: fp};
    };
    const findingsArrays: Finding[][] = [];
    for (const name of fs.readdirSync(runDir)) {
      if (!name.endsWith('.json') || name === 'merged.json' || name === 'triage.json') continue;
      const parsed = readJson<any>(path.join(runDir, name));
      const arr: any[] = Array.isArray(parsed) ? parsed : (parsed.findings ?? []);
      findingsArrays.push(arr.map(enrich));
    }
    const sup = loadSuppression(supPath);
    const merged = aggregate(findingsArrays, sup, floor as Severity);
    fs.writeFileSync(path.join(runDir, 'merged.json'), JSON.stringify(merged, null, 2));
    process.stdout.write(`wrote ${merged.length} findings to merged.json\n`);
  },

  triage: (args) => {
    const [runDir] = args;
    if (!runDir) die('usage: triage <runDir>');
    const merged = readJson<Finding[]>(path.join(runDir, 'merged.json'));
    const buckets = classify(merged);
    fs.writeFileSync(path.join(runDir, 'triage.json'), JSON.stringify(buckets, null, 2));
    process.stdout.write(`fixNow=${buckets.fixNow.length} issue=${buckets.issue.length} suppress=${buckets.suppress.length}\n`);
  },

  'append-suppression': (args) => {
    const [supPath, jsonEntry] = args;
    if (!supPath || !jsonEntry) die('usage: append-suppression <path> <jsonEntry>');
    const entry: SuppressionEntry = JSON.parse(jsonEntry);
    appendSuppression(supPath, entry);
    process.stdout.write('ok\n');
  },

  summary: (args) => {
    const [inputPath, outputPath] = args;
    if (!inputPath || !outputPath) die('usage: summary <inputJson> <outputMd>');
    writeSummary(readJson(inputPath), outputPath);
    process.stdout.write(`wrote ${outputPath}\n`);
  },
};

const main = (): void => {
  const [, , cmd, ...rest] = process.argv;
  const fn = cmd ? cmds[cmd] : undefined;
  if (!fn) die(`unknown command: ${cmd ?? '(none)'} (try: ${Object.keys(cmds).join(', ')})`);
  fn!(rest);
};

main();
