import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { config } from '../config.js';

/**
 * Builds a Supabase client that acts as the end user, using the access token
 * minted during token verification. This is the only way this server reaches
 * expense data: every query runs under the same RLS policies as the browser
 * app, and a bug here cannot leak another user's rows.
 */
export function userClient(auth: AuthInfo): SupabaseClient {
  const accessToken = auth.extra?.supabaseAccessToken;
  if (typeof accessToken !== 'string') {
    throw new Error('Authenticated request is missing its Supabase session');
  }

  return createClient(config.supabase.url, config.supabase.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } }
  });
}

export function userId(auth: AuthInfo): string {
  const id = auth.extra?.userId;
  if (typeof id !== 'string') {
    throw new Error('Authenticated request is missing its user id');
  }
  return id;
}
