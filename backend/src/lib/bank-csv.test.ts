import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseBankCsv } from './bank-csv.js';

// An excerpt of a real RBC chequing export, with people's names replaced.
const STATEMENT = `2026-10-08,Point of Sale - Interac RETAIL PURCHASE 628114225859 FRESHSLICE PIZZ,11.29,
2026-10-07,Point of Sale - Interac RETAIL PURCHASE 628015761644 TIM HORTONS #99,12.14,
2026-10-05,Point of Sale - Visa Debit VISA DEBIT PURCHASE REVERSAL UBERONE CA/UBER 227807000739,,1.29
2026-10-05,Internet Banking E-TRANSFER 011805467141 JANE DOE,,950.00
2026-10-05,Internet Banking E-TRANSFER 106146770694 John,1500.00,
2026-10-05,Point of Sale - Interac RETAIL PURCHASE 137836543517 SQ *THE GOLDEN,3.41,
2026-10-02,Point of Sale - Interac RETAIL PURCHASE 3JNSC9AU0000 TST-chefhyve -,3.68,
2026-09-29,Branch Transaction SERVICE CHARGE DISCOUNT,,16.95
2026-09-29,Branch Transaction SERVICE CHARGE CAPPED MONTHLY FEE$16.95 RECORD-KEEPING N/A,16.95,
2026-09-25,Point of Sale - Visa Debit VISA DEBIT MERCHANDISE RET REV UBER CANADA/UBE 626721236753,39.04,
2026-09-25,Point of Sale - Visa Debit VISA DEBIT PURCHASE REVERSAL UBER CANADA/UBE 626721236753,,39.05
2026-09-25,Point of Sale - Visa Debit VISA DEBIT RETAIL PURCHASE UBER CANADA/UBE 626721236753,39.05,
2026-09-25,Point of Sale - Visa Debit VISA DEBIT RETAIL PURCHASE UBERONE CA/UBER 626721234857,1.29,
2026-09-23,Point of Sale - Visa Debit INTL VISA DEB RETAIL PURCHASE ANTHROPIC 626621440541 5.60 USD @ 1.444643,8.09,
2026-09-22,Point of Sale - Interac RETAIL PURCHASE 626504209893 ESSO 7-ELEVEN 3,111.70,
2026-09-22,Point of Sale - Visa Debit INT VISA DEB PURCHASE REVERSAL MOBI BY ROGERS T26265039096 15.00 CAD @ 1.000000,,15.00
2026-09-09,Point of Sale - Visa Debit VISA DEBIT RETAIL PURCHASE MOBI BY ROGERS 625216583811,15.00,
2026-09-08,Electronic Funds Transfer PREAUTHORIZED DEBIT 36264489 U of British Columbia,23877.96,
2026-09-08,Point of Sale - Visa Debit CORRECTION VECTEEZY 625115387068 25.00 USD @ 1.419200,,35.48
2026-09-08,Point of Sale - Visa Debit INTL VISA DEB RETAIL PURCHASE VECTEEZY 625115387068 25.00 USD @ 1.419200,35.48,
2026-08-14,Point of Sale - Visa Debit VISA DEBIT MERCHANDISE RET REV MOBI BY ROGERS 621919611216,3.33,
2026-08-14,Point of Sale - Visa Debit VISA DEBIT PURCHASE REVERSAL MOBI BY ROGERS 621919611216,,15.00
2026-08-10,Automated Banking Machine ATM WITHDRAWAL UNIVERSITY BLVD 1D2Y,40.00,
2026-08-10,Point of Sale - Interac RETAIL PURCHASE 622121281497 11185 MACS CONV,7.92,
2026-08-07,Point of Sale - Visa Debit VISA DEBIT RETAIL PURCHASE MOBI BY ROGERS 621919611216,15.00,
2026-08-07,Point of Sale - Visa Debit INT VISA DEB PURCHASE REVERSAL MOBI BY ROGERS T26219406452 15.00 CAD @ 1.000000,,15.00
2026-08-04,Branch Transaction CREDIT MEMO,,50005.57
2026-07-30,Point of Sale - Interac MDSE RETURN 621114341399 TIM HORTONS #29,,13.73
2026-07-30,Point of Sale - Interac RETAIL PURCHASE 621114340512 TIM HORTONS #29,13.73,
2026-07-02,Point of Sale - Interac RETAIL PURCHASE 3IQ064K60000 1832_YYZ_Relay,5.69,
2026-02-17,"Point of Sale - Visa Debit INTL VISA DEB RETAIL PURCHASE CURSOR, AI POWE 604700209523 31.73 CAD @ 1.000000",31.73,
2026-01-26,Point of Sale - Interac RETAIL PURCHASE 24OPQYD70000 chefhyve,18.57,
2026-01-26,Point of Sale - Interac RETAIL PURCHASE 24OPQYD70000 chefhyve,18.57,
2026-01-23,Point of Sa`;

const parsed = parseBankCsv(STATEMENT);
const rowFor = (needle: string) => parsed.rows.filter(row => row.raw.includes(needle));
const skippedFor = (needle: string) => parsed.skipped.filter(row => row.raw.includes(needle));

test('reads quoted descriptions containing commas', () => {
  const [cursor] = rowFor('CURSOR, AI POWE');
  assert.equal(cursor?.amount, 31.73);
  assert.equal(cursor?.notes, null, 'CAD charges carry no FX note');
});

test('drops a purchase cancelled by its correction', () => {
  assert.equal(rowFor('VECTEEZY').length, 0);
  assert.deepEqual(
    skippedFor('VECTEEZY').map(row => row.reason),
    ['reversed', 'reversed']
  );
});

test('nets a purchase, reversal and re-charge to what was finally paid', () => {
  const uber = rowFor('UBER CANADA/UBE');
  assert.equal(uber.length, 1);
  assert.equal(uber[0]?.amount, 39.04);
  assert.equal(uber[0]?.merchant, 'Uber Canada/Ube');
});

test('nets a reversal posted a week after the purchase', () => {
  const mobi = rowFor('621919611216');
  assert.equal(mobi.length, 1);
  assert.equal(mobi[0]?.amount, 3.33);
  assert.equal(mobi[0]?.date, '2026-08-07');
});

test('released pre-auth holds are credits and never cancel real charges', () => {
  assert.equal(rowFor('625216583811')[0]?.amount, 15);
  assert.ok(skippedFor('T26265039096').every(row => row.reason === 'credit'));
  assert.ok(skippedFor('T26219406452').every(row => row.reason === 'credit'));
});

test('an Interac return cancels the matching purchase', () => {
  assert.equal(rowFor('TIM HORTONS #29').length, 0);
  assert.equal(skippedFor('TIM HORTONS #29').length, 2);
});

test('the monthly fee and its discount cancel out', () => {
  assert.equal(rowFor('SERVICE CHARGE').length, 0);
  assert.ok(skippedFor('SERVICE CHARGE').every(row => row.reason === 'fee-netted'));
});

test('income and unmatched refunds are skipped as credits', () => {
  for (const needle of ['CREDIT MEMO', 'JANE DOE', 'UBERONE CA/UBER 227807000739']) {
    assert.equal(skippedFor(needle)[0]?.reason, 'credit', needle);
  }
  // The refund had a different reference, so the original charge stays.
  assert.equal(rowFor('626721234857')[0]?.amount, 1.29);
});

test('keeps transfers out, ATM withdrawals and pre-authorized debits', () => {
  assert.equal(rowFor('E-TRANSFER 106146770694')[0]?.merchant, 'E-transfer to John');
  assert.equal(rowFor('ATM WITHDRAWAL')[0]?.merchant, 'ATM withdrawal');
  const tuition = rowFor('U of British Columbia')[0];
  assert.equal(tuition?.merchant, 'U of British Columbia');
  assert.equal(tuition?.amount, 23877.96);
});

test('moves the foreign amount into notes', () => {
  const anthropic = rowFor('ANTHROPIC 626621440541')[0];
  assert.equal(anthropic?.amount, 8.09);
  assert.equal(anthropic?.notes, '5.60 USD');
});

test('cleans merchant names', () => {
  const names = (needle: string) => rowFor(needle)[0]?.merchant;
  assert.equal(names('TIM HORTONS #99'), 'Tim Hortons');
  assert.equal(names('FRESHSLICE PIZZ'), 'Freshslice Pizz');
  assert.equal(names('SQ *THE GOLDEN'), 'The Golden');
  assert.equal(names('TST-chefhyve -'), 'Chefhyve');
  assert.equal(names('ESSO 7-ELEVEN 3'), 'Esso 7-Eleven');
  assert.equal(names('11185 MACS CONV'), 'Macs Conv');
  assert.equal(names('1832_YYZ_Relay'), 'YYZ Relay');
  assert.equal(names('CURSOR, AI POWE'), 'Cursor, AI Powe');
});

test('ids are stable across parses and distinct for identical lines', () => {
  const again = parseBankCsv(STATEMENT);
  assert.deepEqual(
    again.rows.map(row => row.id),
    parsed.rows.map(row => row.id)
  );

  const twins = rowFor('24OPQYD70000');
  assert.equal(twins.length, 2);
  assert.notEqual(twins[0]?.id, twins[1]?.id);
  assert.ok(parsed.rows.every(row => /^bank:[0-9a-f]+$/.test(row.id)));
});

test('reports a line cut off mid-paste, and the date range', () => {
  assert.equal(parsed.skipped.find(row => row.reason === 'unreadable')?.date, '2026-01-23');
  assert.equal(parsed.from, '2026-01-23');
  assert.equal(parsed.to, '2026-10-08');
});

test('ignores a header row and a byte-order mark', () => {
  const withHeader = parseBankCsv(
    '﻿Date,Description,Debit,Credit\n2026-03-01,Point of Sale - Interac RETAIL PURCHASE 000001437147 SAFEWAY #4931,53.32,\n'
  );
  assert.equal(withHeader.rows.length, 1);
  assert.equal(withHeader.rows[0]?.merchant, 'Safeway');
});
