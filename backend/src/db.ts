import pg from 'pg';
import { config } from './config.js';

/**
 * Connection pool for the `mcp_oauth` schema only — OAuth clients, codes and
 * issued tokens. Expense data is never touched here; that goes through
 * supabase-js with the end user's token so RLS stays in charge.
 */
export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 10,
  idleTimeoutMillis: 30_000,
  // Supabase requires TLS; its pooler presents a certificate that does not
  // chain to a root in Node's default store.
  ssl: config.databaseUrl.includes('localhost') ? false : { rejectUnauthorized: false }
});

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = []
): Promise<T[]> {
  try {
    const result = await pool.query<T>(text, params);
    return result.rows;
  } catch (cause) {
    // The SDK's OAuth handlers catch provider errors and return a bare 500, so
    // without this a misconfigured DATABASE_URL looks like an unexplained
    // "Internal Server Error" with an empty log.
    const message = cause instanceof Error ? cause.message : String(cause);
    const firstLine = text.trim().split('\n')[0] ?? '';
    console.error(`[tally-mcp] database query failed: ${message} — ${firstLine}…`);
    throw cause;
  }
}

export async function queryOne<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = []
): Promise<T | undefined> {
  const rows = await query<T>(text, params);
  return rows[0];
}
