import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DigestRow, NightDigest, ReadNight, RunStatus } from './types.js';

type Entry = {
  at: string;
  job: string;
  status: RunStatus;
  owner: string | null;
  error?: string;
};

function isEntry(value: unknown): value is Entry {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Record<string, unknown>;
  if (typeof entry.at !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(entry.at)
    || !Number.isFinite(Date.parse(entry.at))) return false;
  // Date.parse normalizes some nonexistent dates, such as February 30.
  const calendarDate = new Date(`${entry.at.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(calendarDate.getTime())
    || calendarDate.toISOString().slice(0, 10) !== entry.at.slice(0, 10)) return false;
  return typeof entry.job === 'string' && entry.job.trim().length > 0
    && (entry.status === 'ok' || entry.status === 'retry' || entry.status === 'fail')
    && (entry.owner === null || typeof entry.owner === 'string')
    && (!Object.hasOwn(entry, 'error') || typeof entry.error === 'string');
}

/** Read and aggregate a night without letting malformed log lines hide valid work. */
export const readNight: ReadNight = (runsDir, night) => {
  // A night is a filename component, never a caller-controlled path.
  if (night.length !== 10 || !/^\d{4}-\d{2}-\d{2}$/.test(night)) return null;
  let contents: string;
  try {
    contents = readFileSync(join(runsDir, `${night}.jsonl`), 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }

  const digest: NightDigest = { rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 } };
  const jobs = new Map<string, { row: DigestRow; first: number; last: number; lastError: number }>();
  for (const line of contents.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      digest.badLines += 1;
      continue;
    }
    if (!isEntry(value)) {
      digest.badLines += 1;
      continue;
    }
    const entry = value;
    const at = Date.parse(entry.at);
    digest.counts[entry.status] += 1;
    const existing = jobs.get(entry.job);
    if (!existing) {
      jobs.set(entry.job, {
        row: {
          job: entry.job, owner: entry.owner, runs: 1,
          retries: Number(entry.status === 'retry'), fails: Number(entry.status === 'fail'),
          lastStatus: entry.status, lastError: entry.error ?? null,
          firstAt: entry.at, lastAt: entry.at,
        },
        first: at, last: at, lastError: entry.error === undefined ? -Infinity : at,
      });
      continue;
    }
    const { row } = existing;
    row.runs += 1;
    row.retries += Number(entry.status === 'retry');
    row.fails += Number(entry.status === 'fail');
    if (at < existing.first) {
      existing.first = at;
      row.firstAt = entry.at;
    }
    if (at >= existing.last) {
      existing.last = at;
      row.lastAt = entry.at;
      row.owner = entry.owner;
      row.lastStatus = entry.status;
    }
    if (entry.error !== undefined && at >= existing.lastError) {
      existing.lastError = at;
      row.lastError = entry.error;
    }
  }
  digest.rows = [...jobs.values()].map(({ row }) => row)
    .sort((a, b) => a.job < b.job ? -1 : a.job > b.job ? 1 : 0);
  return digest;
};
