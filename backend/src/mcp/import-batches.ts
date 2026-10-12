import { randomBytes } from 'node:crypto';

import type { ImportRow, SkippedRow } from '../lib/bank-csv.js';

/**
 * Parsed statements waiting for the assistant to categorize them.
 *
 * Holding the rows here means the assistant sends a statement once, gets back
 * a short per-merchant summary, and answers with one category per merchant —
 * rather than echoing hundreds of rows (and their ids) back through a tool.
 *
 * In-process memory on purpose: the server runs as a single instance, and a
 * batch lost to a restart costs nothing more than parsing again.
 */

export interface Batch {
  id: string;
  userId: string;
  /** Position in this array is the row's short key: rows[0] is "r1". */
  rows: ImportRow[];
  skipped: SkippedRow[];
  /** Lines dropped at parse time because an earlier import already stored them. */
  alreadyImported: number;
  expiresAt: number;
}

export const BATCH_TTL_MS = 30 * 60_000;
const MAX_ROWS = 5_000;
const MAX_BATCHES_PER_USER = 5;

const batches = new Map<string, Batch>();

function sweep(now: number): void {
  for (const [id, batch] of batches) if (batch.expiresAt <= now) batches.delete(id);
}

export function rowKey(index: number): string {
  return `r${index + 1}`;
}

/** Inverse of rowKey; null for anything that is not a key into this batch. */
export function rowIndex(batch: Batch, key: string): number | null {
  const match = /^r(\d+)$/i.exec(key.trim());
  if (!match) return null;
  const index = Number(match[1]) - 1;
  return index >= 0 && index < batch.rows.length ? index : null;
}

/**
 * Starts a batch, or appends to an existing one so a long statement can arrive
 * in pieces. Rows already in the batch (same id) are not added twice.
 */
export function stageBatch(
  userId: string,
  parsed: { rows: ImportRow[]; skipped: SkippedRow[]; alreadyImported: number },
  batchId?: string,
  now = Date.now()
): Batch {
  sweep(now);

  let batch: Batch;
  if (batchId) {
    batch = getBatch(userId, batchId, now);
  } else {
    // Keep one user from piling up abandoned batches.
    const own = [...batches.values()]
      .filter(entry => entry.userId === userId)
      .sort((a, b) => a.expiresAt - b.expiresAt);
    for (const stale of own.slice(0, Math.max(own.length - MAX_BATCHES_PER_USER + 1, 0))) {
      batches.delete(stale.id);
    }

    batch = {
      id: randomBytes(5).toString('hex'),
      userId,
      rows: [],
      skipped: [],
      alreadyImported: 0,
      expiresAt: 0
    };
    batches.set(batch.id, batch);
  }

  const known = new Set(batch.rows.map(row => row.id));
  const fresh = parsed.rows.filter(row => !known.has(row.id));
  if (batch.rows.length + fresh.length > MAX_ROWS) {
    throw new Error(`A single import is capped at ${MAX_ROWS} rows — import this statement in smaller pieces.`);
  }

  batch.rows.push(...fresh);
  batch.skipped.push(...parsed.skipped);
  batch.alreadyImported += parsed.alreadyImported;
  batch.expiresAt = now + BATCH_TTL_MS;
  return batch;
}

export function getBatch(userId: string, batchId: string, now = Date.now()): Batch {
  sweep(now);
  const batch = batches.get(batchId);
  // Another user's batch is reported exactly like a missing one.
  if (!batch || batch.userId !== userId) {
    throw new Error(
      `No import batch "${batchId}" — it may have expired (they last 30 minutes). Call parse_bank_statement again without batch_id.`
    );
  }
  return batch;
}

export function dropBatch(batchId: string): void {
  batches.delete(batchId);
}
