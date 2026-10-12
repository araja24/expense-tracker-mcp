/**
 * Turns a bank statement export (RBC-style: `date,description,debit,credit`,
 * no header) into the purchases worth recording as expenses.
 *
 * A raw statement is noisier than it looks. A refunded order shows up as a
 * purchase plus a reversal, a card correction as a charge plus a credit, and
 * the monthly fee as a charge plus a matching discount. Importing it line by
 * line would overstate spending, so lines are netted against each other first
 * and only what was actually spent comes out the other end.
 *
 * Pure and synchronous on purpose: no I/O, so it is trivial to test.
 */

export interface ImportRow {
  /** Stable across re-imports of the same line; stored as expenses.external_id. */
  id: string;
  date: string;
  merchant: string;
  /** Net amount spent, in the statement currency. Always > 0. */
  amount: number;
  /** e.g. "5.60 USD" for a foreign-currency charge. */
  notes: string | null;
  raw: string;
}

export type SkipReason = 'credit' | 'reversed' | 'fee-netted' | 'unreadable';

export interface SkippedRow {
  date: string;
  raw: string;
  /** Signed: positive for a debit, negative for a credit. */
  amount: number;
  reason: SkipReason;
}

export interface BankImport {
  rows: ImportRow[];
  skipped: SkippedRow[];
  /** Date range the statement covers, or null if it had no dated lines. */
  from: string | null;
  to: string | null;
}

interface Line {
  index: number;
  date: string;
  raw: string;
  /** Debit minus credit, in cents. */
  cents: number;
  id: string;
  channel: 'interac' | 'visa' | 'other';
  /** The bank's reference for the card transaction, when it has one. */
  ref: string | null;
  /** Merchant text as printed, before cleaning. */
  merchantRaw: string;
  isReturn: boolean;
  notes: string | null;
}

// ------------------------------------------------------------------- reading

/** RFC 4180: quoted cells may hold commas, quotes ("") and newlines. */
function readCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text.charAt(i);
    if (quoted) {
      if (ch === '"') {
        if (text.charAt(i + 1) === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text.charAt(i + 1) === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }

  if (cell || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/** Money is handled in integer cents throughout, so netting never drifts. */
function toCents(value: string | undefined): number | null {
  const cleaned = (value ?? '').replace(/[$,\s]/g, '');
  if (cleaned === '') return 0;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : null;
}

/** cyrb53: a small, fast, well-distributed 53-bit string hash. */
function cyrb53(input: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}

// ---------------------------------------------------------------- describing

const INTERAC = /^Point of Sale - Interac (RETAIL PURCHASE|MDSE RETURN) (\S+) (.+)$/;

// Visa Debit lines put the reference after the merchant, optionally followed
// by the original foreign amount: "… VECTEEZY 625115387068 25.00 USD @ 1.4192".
const VISA =
  /^Point of Sale - Visa Debit (?:(?:INTL? )?VISA DEB(?:IT)? (?:RETAIL PURCHASE|PURCHASE REVERSAL|MERCHANDISE RET REV)|CORRECTION) (.+?) (T?\d{11,12})(?: ([\d.]+) ([A-Z]{3}) @ [\d.]+)?$/;

function describe(raw: string): Pick<Line, 'channel' | 'ref' | 'merchantRaw' | 'isReturn' | 'notes'> {
  const interac = INTERAC.exec(raw);
  if (interac) {
    return {
      channel: 'interac',
      ref: interac[2] ?? null,
      merchantRaw: interac[3] ?? raw,
      isReturn: interac[1] === 'MDSE RETURN',
      notes: null
    };
  }

  const visa = VISA.exec(raw);
  if (visa) {
    const currency = visa[4];
    return {
      channel: 'visa',
      ref: visa[2] ?? null,
      merchantRaw: visa[1] ?? raw,
      isReturn: false,
      notes: currency && currency !== 'CAD' ? `${visa[3]} ${currency}` : null
    };
  }

  return { channel: 'other', ref: null, merchantRaw: raw, isReturn: false, notes: null };
}

// ----------------------------------------------------------------- cleaning

const ACRONYMS = new Set(['CA', 'ICBC', 'UBC', 'USA', 'AI']);
const SMALL_WORDS = new Set(['of', 'and', 'the', 'to']);

function titleCase(text: string): string {
  return text
    .split(' ')
    .filter(Boolean)
    .map((word, i) => {
      const lower = word.toLowerCase();
      if (i > 0 && SMALL_WORDS.has(lower)) return lower;
      if (ACRONYMS.has(word)) return word;
      // Already mixed case ("LaunchGood", "chefhyve"): trust it, just capitalize.
      if (/[a-z]/.test(word)) return word.charAt(0).toUpperCase() + word.slice(1);
      // All-caps with no vowels reads as an abbreviation: KFC, AMZN, TLNK, YYZ.
      if (!/[AEIOU]/.test(word) && /[A-Z]/.test(word)) return word;
      // Capitalize each part of "7-ELEVEN" and "CANADA/UBE" too.
      return lower.replace(/(^|[-/])([a-z])/g, (_, edge: string, letter: string) => edge + letter.toUpperCase());
    })
    .join(' ');
}

function cleanMerchant(line: Pick<Line, 'raw' | 'channel' | 'merchantRaw'>): string {
  const { raw } = line;

  const transfer = /^Internet Banking E-TRANSFER \S+ (.+)$/.exec(raw);
  if (transfer) return `E-transfer to ${titleCase(transfer[1] ?? '')}`;
  if (/ATM WITHDRAWAL/.test(raw)) return 'ATM withdrawal';
  if (/SERVICE CHARGE/.test(raw)) return 'Bank service charge';
  const debit = /^Electronic Funds Transfer PREAUTHORIZED DEBIT \S+ (.+)$/.exec(raw);
  if (debit) return titleCase(debit[1] ?? '');

  let name =
    line.channel === 'other'
      ? raw.replace(
          /^(Point of Sale - (Interac|Visa Debit)|Internet Banking|Branch Transaction|Electronic Funds Transfer|Automated Banking Machine) /,
          ''
        )
      : line.merchantRaw;

  name = name
    .replace(/^(TST-|SQ \*|DD\/|NBX\*|WWW\.)/i, '')
    .replace(/^\d+[ _]/, '') // leading store numbers: "11185 MACS CONV", "1832_YYZ_Relay"
    .replace(/\/\d+$/, '') // "TLNK/0531758079"
    .replace(/_/g, ' ')
    .replace(/\*/g, ' ')
    .replace(/\s+#\d*.*$/, '') // "TIM HORTONS #99", "WALMART STORE #"
    .replace(/\s+[\d-]+$/, '') // "SUBWAY 72573", "KFC 300-001"
    .replace(/[\s.-]+$/, '') // "chefhyve -", "WWW.MASJIDOMAR."
    .replace(/\s+/g, ' ')
    .trim();

  return titleCase(name) || raw.slice(0, 200);
}

// ------------------------------------------------------------------- netting

function daysApart(a: string, b: string): number {
  return Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;
}

export function parseBankCsv(text: string): BankImport {
  const lines: Line[] = [];
  const skipped: SkippedRow[] = [];
  const seen = new Map<string, number>();
  let from: string | null = null;
  let to: string | null = null;

  const records = readCsv(text.replace(/^﻿/, ''));
  records.forEach((cells, index) => {
    const date = (cells[0] ?? '').trim();
    // Header rows, blank lines and anything else without a date are ignored.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;

    if (!from || date < from) from = date;
    if (!to || date > to) to = date;

    const raw = (cells[1] ?? '').trim();
    const debit = toCents(cells[2]);
    const credit = toCents(cells[3]);
    if (!raw || debit === null || credit === null || (debit === 0 && credit === 0)) {
      // Most often a line cut off mid-paste.
      skipped.push({ date, raw, amount: 0, reason: 'unreadable' });
      return;
    }

    // Two genuinely identical lines (same day, merchant, amount) must still get
    // distinct ids, or the second would be dropped as a duplicate.
    const key = `${date}|${raw}|${debit}|${credit}`;
    const occurrence = seen.get(key) ?? 0;
    seen.set(key, occurrence + 1);

    lines.push({
      index,
      date,
      raw,
      cents: debit - credit,
      id: `bank:${cyrb53(`${key}|${occurrence}`)}`,
      ...describe(raw)
    });
  });

  const skip = (line: Line, reason: SkipReason) =>
    skipped.push({ date: line.date, raw: line.raw, amount: line.cents / 100, reason });

  // A kept purchase, possibly reduced by the reversals netted against it.
  const kept: { line: Line; cents: number }[] = [];
  const credits: Line[] = [];

  // 1. Visa Debit reversals, corrections and "merchandise return reversals"
  //    carry the reference of the purchase they adjust, so group by it.
  //    (Interac references are terminal sequence numbers that repeat across
  //    months, so they are not trusted for this.)
  const groups = new Map<string, Line[]>();
  for (const line of lines) {
    if (line.channel === 'visa' && line.ref) {
      const group = groups.get(line.ref) ?? [];
      group.push(line);
      groups.set(line.ref, group);
    } else if (line.cents > 0) {
      kept.push({ line, cents: line.cents });
    } else {
      credits.push(line);
    }
  }

  for (const group of groups.values()) {
    const debits = group.filter(line => line.cents > 0);
    const hasCredit = group.some(line => line.cents < 0);

    if (!hasCredit) {
      for (const line of debits) kept.push({ line, cents: line.cents });
      continue;
    }

    // A reversal with no purchase in this file — most often a released
    // pre-authorization hold ("T…" references). It is a credit, nothing more.
    const primary = debits.sort((a, b) => a.date.localeCompare(b.date) || a.index - b.index)[0];
    if (!primary) {
      for (const line of group) skip(line, 'credit');
      continue;
    }

    const net = group.reduce((sum, line) => sum + line.cents, 0);
    if (net > 0) {
      kept.push({ line: primary, cents: net });
      for (const line of group) if (line !== primary) skip(line, 'reversed');
    } else {
      for (const line of group) skip(line, 'reversed');
    }
  }

  // 2. What is left over among the credits: Interac returns cancel the
  //    matching purchase, fee discounts cancel the fee, the rest is income.
  for (const credit of credits) {
    let match: { line: Line; cents: number } | undefined;

    if (credit.isReturn) {
      // Same merchant, same amount, within a few days.
      match = kept.find(
        entry =>
          entry.line.channel === 'interac' &&
          entry.line.merchantRaw === credit.merchantRaw &&
          entry.cents === -credit.cents &&
          daysApart(entry.line.date, credit.date) <= 3
      );
    } else if (/SERVICE CHARGE DISCOUNT/.test(credit.raw)) {
      match = kept.find(
        entry =>
          entry.line.date === credit.date &&
          /SERVICE CHARGE/.test(entry.line.raw) &&
          !/DISCOUNT/.test(entry.line.raw)
      );
    }

    if (!match) {
      skip(credit, 'credit');
      continue;
    }

    const reason: SkipReason = credit.isReturn ? 'reversed' : 'fee-netted';
    const net = match.cents + credit.cents;
    if (net > 0) {
      match.cents = net;
      skip(credit, reason);
    } else {
      kept.splice(kept.indexOf(match), 1);
      skip(match.line, reason);
      skip(credit, reason);
    }
  }

  // Newest first, then in statement order — the way the bank lists them.
  kept.sort((a, b) => b.line.date.localeCompare(a.line.date) || a.line.index - b.line.index);
  skipped.sort((a, b) => b.date.localeCompare(a.date));

  return {
    rows: kept.map(({ line, cents }) => ({
      id: line.id,
      date: line.date,
      merchant: cleanMerchant(line),
      amount: cents / 100,
      notes: line.notes,
      raw: line.raw
    })),
    skipped,
    from,
    to
  };
}
