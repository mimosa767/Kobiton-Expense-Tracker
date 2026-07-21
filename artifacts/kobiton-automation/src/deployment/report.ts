/**
 * Deploy run reporting: a console summary plus JSON (full detail) and CSV
 * (one row per device) serializers written under `--report-dir`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DeployRunResult, DeviceDeployResult } from './types';

/** Console summary in the spec's shape: per-device ✓/✗ lines, then the tally. */
export function toConsoleSummary(run: DeployRunResult): string {
  const lines: string[] = [];
  lines.push(
    `Deploy ${run.dryRun ? '(DRY-RUN) ' : ''}${run.app.appRef} → ${run.platform} ` +
      `— concurrency ${run.concurrency}, retries ${run.retries}`,
  );
  for (const r of run.results) {
    const mark = run.dryRun ? '•' : r.ok ? '✓' : '✗';
    const name = r.deviceName ?? r.udid ?? '(unknown device)';
    const detail = run.dryRun
      ? 'would deploy'
      : r.ok
        ? `installed${r.appState !== undefined ? `, state ${r.appState}` : ''} in ${r.totalMs}ms` +
          (r.attempts > 1 ? ` (${r.attempts} attempts)` : '')
        : `FAILED at ${r.failedStep ?? '?'} — ${r.error ?? 'unknown error'}`;
    lines.push(`  ${mark} ${name}${r.udid ? ` [${r.udid}]` : ''}: ${detail}`);
  }
  if (run.dryRun) {
    lines.push(`${run.results.length} device(s) would be targeted.`);
  } else {
    lines.push(`${run.successful} Successful / ${run.failed} Failed`);
  }
  return lines.join('\n');
}

export function toJson(run: DeployRunResult): string {
  return JSON.stringify(run, null, 2);
}

const CSV_COLUMNS = [
  'udid',
  'deviceName',
  'platform',
  'ok',
  'attempts',
  'failedStep',
  'installedVerified',
  'appState',
  'totalMs',
  'sessionName',
  'sessionId',
  'kobitonSessionId',
  'startedAt',
  'endedAt',
  'error',
] as const;

function csvCell(value: unknown): string {
  if (value === undefined || value === null) return '';
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(run: DeployRunResult): string {
  const rows = [CSV_COLUMNS.join(',')];
  for (const r of run.results) {
    rows.push(CSV_COLUMNS.map((c) => csvCell((r as unknown as Record<string, unknown>)[c])).join(','));
  }
  return rows.join('\n') + '\n';
}

/** Slug a timestamp for filenames: 2026-07-21T17:04:05.123Z → 2026-07-21T17-04-05. */
function stamp(iso: string): string {
  return iso.replace(/\.\d+Z$/, '').replace(/:/g, '-');
}

export interface WrittenReports {
  jsonPath: string;
  csvPath: string;
}

/** Write `deploy-<timestamp>.{json,csv}` into `dir` (created if missing). */
export function writeReports(run: DeployRunResult, dir: string): WrittenReports {
  mkdirSync(dir, { recursive: true });
  const base = `deploy-${stamp(run.startedAt)}`;
  const jsonPath = join(dir, `${base}.json`);
  const csvPath = join(dir, `${base}.csv`);
  writeFileSync(jsonPath, toJson(run));
  writeFileSync(csvPath, toCsv(run));
  return { jsonPath, csvPath };
}

export type { DeployRunResult, DeviceDeployResult };
