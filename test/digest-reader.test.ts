import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/reader.js';

const night = '2026-10-28';
const entry = { at: '2026-10-28T23:00:00+01:00', job: 'job', status: 'ok', owner: 'rook' };
let runsDir: string;

beforeEach(() => { runsDir = mkdtempSync(join(tmpdir(), 'rig-digest-')); });
afterEach(() => { rmSync(runsDir, { recursive: true, force: true }); });

function writeEntries(entries: unknown[]) {
  writeFileSync(join(runsDir, `${night}.jsonl`), entries.map(value => JSON.stringify(value)).join('\n'));
}

describe('readNight', () => {
  it('reads the supplied night without changing its fixtures', () => {
    const digest = readNight('runs', night);
    expect(digest?.badLines).toBe(1);
    expect(digest?.counts).toEqual({ ok: 10, retry: 4, fail: 1 });
    expect(digest?.rows.map(row => row.job)).toEqual([
      'digest/render', 'fixtures/refresh', 'lane/sync', 'notes/backup', 'rig/rotate-logs',
    ]);
    expect(digest?.rows[0]).toEqual({
      job: 'digest/render', owner: null, runs: 1, retries: 0, fails: 0,
      lastStatus: 'ok', lastError: null,
      firstAt: '2026-10-29T05:41:09+01:00', lastAt: '2026-10-29T05:41:09+01:00',
    });
    expect(digest?.rows[1]).toMatchObject({ runs: 4, retries: 3, fails: 0, lastStatus: 'ok', lastError: 'upstream 503' });
    expect(digest?.rows[2]).toMatchObject({ runs: 8, retries: 1, lastError: 'lock held' });
    expect(digest?.rows[3]).toMatchObject({ fails: 1, lastStatus: 'fail', lastError: 'quota exceeded' });
  });

  it('distinguishes missing and empty nights, ignoring whitespace-only lines', () => {
    expect(readNight(runsDir, night)).toBeNull();
    for (const contents of ['', '\n  \r\n\t\n']) {
      writeFileSync(join(runsDir, `${night}.jsonl`), contents);
      expect(readNight(runsDir, night)).toEqual({ rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 } });
    }
  });

  it('compares timestamps chronologically across offsets and preserves the latest supplied error', () => {
    writeEntries([
      { ...entry, at: '2026-10-29T02:00:00+03:00', status: 'retry', error: 'old error' },
      { ...entry, at: '2026-10-29T01:00:00Z', owner: null },
      { ...entry, at: '2026-10-29T01:30:00+02:00', status: 'fail', error: 'latest error' },
      { ...entry, at: '2026-10-28T22:30:00Z', status: 'retry', error: 'earliest error' },
    ]);
    expect(readNight(runsDir, night)).toEqual({
      rows: [{ job: 'job', owner: null, runs: 4, retries: 2, fails: 1,
        lastStatus: 'ok', lastError: 'latest error',
        firstAt: '2026-10-28T22:30:00Z', lastAt: '2026-10-29T01:00:00Z' }],
      badLines: 0, counts: { ok: 1, retry: 2, fail: 1 },
    });
  });

  it('uses later file order for equal instants, including empty supplied errors and null owners', () => {
    writeEntries([
      { ...entry, at: '2026-10-28T23:00:00+01:00', status: 'fail', error: 'first' },
      { ...entry, at: '2026-10-28T22:00:00Z', status: 'retry', error: '' },
      { ...entry, at: '2026-10-29T00:00:00+02:00', owner: null },
    ]);
    expect(readNight(runsDir, night)?.rows[0]).toEqual({
      job: 'job', owner: null, runs: 3, retries: 1, fails: 1,
      lastStatus: 'ok', lastError: '', firstAt: entry.at, lastAt: '2026-10-29T00:00:00+02:00',
    });
  });

  it('counts invalid records once each and continues to valid records', () => {
    const invalid: unknown[] = [
      null, [], 42, 'text', {},
      { ...entry, status: 'pending' }, { ...entry, job: '' }, { ...entry, job: 1 },
      { ...entry, owner: undefined }, { ...entry, owner: 1 },
      { ...entry, error: null }, { ...entry, error: {} },
      { ...entry, at: 'not a timestamp' }, { ...entry, at: 42 },
      { ...entry, at: '2026-10-28' }, { ...entry, at: '2026-02-30T12:00:00Z' },
    ];
    writeFileSync(join(runsDir, `${night}.jsonl`), [
      JSON.stringify({ ...entry, job: 'z-last' }), '{broken',
      ...invalid.map(value => JSON.stringify(value)), '',
      JSON.stringify({ ...entry, job: '__proto__', owner: null }),
    ].join('\r\n'));
    expect(readNight(runsDir, night)).toMatchObject({
      badLines: invalid.length + 1, counts: { ok: 2, retry: 0, fail: 0 },
      rows: [{ job: '__proto__', owner: null, lastError: null }, { job: 'z-last' }],
    });
  });

  it('rejects path traversal and propagates filesystem failures other than a missing file', () => {
    writeEntries([entry]);
    mkdirSync(join(runsDir, 'nested'));
    expect(readNight(join(runsDir, 'nested'), `../${night}`)).toBeNull();
    expect(readNight(runsDir, `${night}/../${night}`)).toBeNull();
    expect(readNight(runsDir, `${night}\n`)).toBeNull();
    mkdirSync(join(runsDir, '2026-10-29.jsonl'));
    expect(() => readNight(runsDir, '2026-10-29')).toThrow();
  });
});
