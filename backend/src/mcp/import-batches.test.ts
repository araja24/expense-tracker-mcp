import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { ImportRow } from '../lib/bank-csv.js';
import { BATCH_TTL_MS, dropBatch, getBatch, rowIndex, rowKey, stageBatch } from './import-batches.js';

const row = (id: string, merchant = 'Safeway'): ImportRow => ({
  id,
  date: '2026-03-01',
  merchant,
  amount: 10,
  notes: null,
  raw: `raw ${id}`
});

test('appending to a batch skips rows it already holds', () => {
  const first = stageBatch('user-a', { rows: [row('bank:1'), row('bank:2')], skipped: [], alreadyImported: 1 });
  const again = stageBatch(
    'user-a',
    { rows: [row('bank:2'), row('bank:3')], skipped: [], alreadyImported: 2 },
    first.id
  );

  assert.equal(again.id, first.id);
  assert.deepEqual(again.rows.map(r => r.id), ['bank:1', 'bank:2', 'bank:3']);
  assert.equal(again.alreadyImported, 3);
  dropBatch(first.id);
});

test('a batch belongs to the user who staged it', () => {
  const batch = stageBatch('user-a', { rows: [row('bank:1')], skipped: [], alreadyImported: 0 });
  assert.throws(() => getBatch('user-b', batch.id), /No import batch/);
  assert.equal(getBatch('user-a', batch.id).id, batch.id);
  dropBatch(batch.id);
});

test('batches expire', () => {
  const start = Date.now();
  const batch = stageBatch('user-a', { rows: [row('bank:1')], skipped: [], alreadyImported: 0 }, undefined, start);
  assert.equal(getBatch('user-a', batch.id, start + BATCH_TTL_MS - 1).id, batch.id);
  assert.throws(() => getBatch('user-a', batch.id, start + BATCH_TTL_MS + 1), /expired/);
});

test('row keys map back to positions in the batch', () => {
  const batch = stageBatch('user-a', { rows: [row('bank:1'), row('bank:2')], skipped: [], alreadyImported: 0 });
  assert.equal(rowKey(1), 'r2');
  assert.equal(rowIndex(batch, 'r2'), 1);
  assert.equal(rowIndex(batch, 'R1'), 0);
  assert.equal(rowIndex(batch, 'r3'), null);
  assert.equal(rowIndex(batch, 'r0'), null);
  assert.equal(rowIndex(batch, 'Safeway'), null);
  dropBatch(batch.id);
});
