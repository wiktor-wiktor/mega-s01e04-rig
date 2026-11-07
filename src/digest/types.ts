export type RunStatus = 'ok' | 'retry' | 'fail';

export type StatusCounts = {
  ok: number;
  retry: number;
  fail: number;
};

/** One job's valid log entries, aggregated for a single night. */
export type DigestRow = {
  job: string;
  /** Owner on the chronologically latest entry, including an explicit null. */
  owner: string | null;
  /** All valid entries for this job, including retries and failures. */
  runs: number;
  retries: number;
  /** Retained even if the job's latest status is ok. */
  fails: number;
  lastStatus: RunStatus;
  /** Latest supplied error, retained after recovery; null if none was supplied. */
  lastError: string | null;
  /** Chronologically earliest timestamp, with the original log offset retained. */
  firstAt: string;
  /** Chronologically latest timestamp, with the original log offset retained. */
  lastAt: string;
};

export type NightDigest = {
  /** One row per job, sorted by job in ascending order. */
  rows: DigestRow[];
  /** Nonempty log lines rejected during JSON parsing or entry validation. */
  badLines: number;
  /** Counts of valid log entries across the night, not counts of jobs. */
  counts: StatusCounts;
};

/**
 * Contract for the synchronous readNight export in ./reader.ts.
 * Read runsDir/<night>.jsonl, where night is a YYYY-MM-DD string.
 * Return null for a missing file; an empty file returns empty rows, zero badLines,
 * and zero status counts. Bad lines are counted without discarding valid entries.
 * Compare timestamps chronologically, preserving their original strings. For equal
 * timestamps, later file order wins when choosing owner, lastStatus, or lastError.
 * lastError comes from the latest entry that supplies an error, even after recovery.
 */
export type ReadNight = (runsDir: string, night: string) => NightDigest | null;
