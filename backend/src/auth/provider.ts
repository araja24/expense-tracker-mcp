import { createHash, randomBytes } from 'node:crypto';
import type { Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import type {
  AuthorizationParams,
  OAuthServerProvider
} from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import {
  InvalidGrantError,
  InvalidTokenError,
  ServerError
} from '@modelcontextprotocol/sdk/server/auth/errors.js';
import type {
  OAuthClientInformationFull,
  OAuthTokenRevocationRequest,
  OAuthTokens
} from '@modelcontextprotocol/sdk/shared/auth.js';

import { config } from '../config.js';
import { query, queryOne } from '../db.js';

/**
 * Tokens are stored as SHA-256 hashes: a dump of mcp_oauth.tokens must not be
 * enough to impersonate anyone. The tokens themselves are 32 bytes of CSPRNG
 * output, so a plain hash is sufficient — there is no low-entropy input to
 * protect against brute force.
 */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function newSecret(): string {
  return randomBytes(32).toString('base64url');
}

/** A client that talks to Supabase Auth without any user session attached. */
function authClient() {
  return createClient(config.supabase.url, config.supabase.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

// ---------------------------------------------------------------- client store

/**
 * Dynamic client registration (RFC 7591). MCP clients register themselves the
 * first time a user adds this connector, so there is nothing to configure by
 * hand on either side.
 */
class SupabaseClientsStore implements OAuthRegisteredClientsStore {
  async getClient(clientId: string): Promise<OAuthClientInformationFull | undefined> {
    const row = await queryOne<{
      client_id: string;
      client_name: string | null;
      redirect_uris: string[];
      token_endpoint_auth_method: string;
      grant_types: string[];
      scope: string;
      created_at: Date;
    }>('select * from mcp_oauth.clients where client_id = $1', [clientId]);

    if (!row) return undefined;

    return {
      client_id: row.client_id,
      client_name: row.client_name ?? undefined,
      redirect_uris: row.redirect_uris,
      token_endpoint_auth_method: row.token_endpoint_auth_method,
      grant_types: row.grant_types,
      response_types: ['code'],
      scope: row.scope,
      client_id_issued_at: Math.floor(row.created_at.getTime() / 1000)
    };
  }

  async registerClient(
    client: Omit<OAuthClientInformationFull, 'client_id' | 'client_id_issued_at'>
  ): Promise<OAuthClientInformationFull> {
    const clientId = randomBytes(16).toString('hex');
    const issuedAt = Math.floor(Date.now() / 1000);

    await query(
      `insert into mcp_oauth.clients
         (client_id, client_name, redirect_uris, token_endpoint_auth_method, grant_types, scope)
       values ($1, $2, $3, $4, $5, $6)`,
      [
        clientId,
        client.client_name ?? null,
        client.redirect_uris,
        // Public clients only: MCP clients cannot keep a secret, and PKCE is
        // what actually protects the exchange.
        'none',
        client.grant_types ?? ['authorization_code', 'refresh_token'],
        client.scope ?? config.scopes.join(' ')
      ]
    );

    return {
      ...client,
      client_id: clientId,
      client_id_issued_at: issuedAt,
      token_endpoint_auth_method: 'none',
      scope: client.scope ?? config.scopes.join(' ')
    };
  }
}

// ------------------------------------------------------------------- provider

export interface PendingAuthorization {
  id: string;
  client_id: string;
  redirect_uri: string;
  state: string | null;
  code_challenge: string;
  code_challenge_method: string;
  scope: string;
}

export class SupabaseOAuthProvider implements OAuthServerProvider {
  readonly clientsStore = new SupabaseClientsStore();

  /**
   * Step 1 of the flow. We cannot mint a code yet — nobody has logged in. Park
   * the request and send the browser to our own login page, which signs the
   * user into Supabase with the same Google/email account they use in the app.
   */
  async authorize(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    res: Response
  ): Promise<void> {
    const id = randomBytes(24).toString('base64url');
    const expiresAt = new Date(Date.now() + config.token.authCodeTtlSeconds * 1000);

    await query(
      `insert into mcp_oauth.pending_authorizations
         (id, client_id, redirect_uri, state, code_challenge, code_challenge_method, scope, expires_at)
       values ($1, $2, $3, $4, $5, 'S256', $6, $7)`,
      [
        id,
        client.client_id,
        params.redirectUri,
        params.state ?? null,
        params.codeChallenge,
        (params.scopes ?? config.scopes).join(' '),
        expiresAt
      ]
    );

    const loginUrl = new URL('/connect', config.publicUrl);
    loginUrl.searchParams.set('request', id);
    res.redirect(loginUrl.toString());
  }

  /**
   * Step 2, called by our own login page once Supabase has authenticated the
   * user. Turns a pending authorization plus a live Supabase session into an
   * authorization code, and returns where to send the browser next.
   */
  async completeAuthorization(
    pendingId: string,
    userId: string,
    supabaseRefreshToken: string
  ): Promise<string> {
    const pending = await queryOne<PendingAuthorization & { expires_at: Date }>(
      'select * from mcp_oauth.pending_authorizations where id = $1',
      [pendingId]
    );

    if (!pending) throw new InvalidGrantError('Unknown or already used authorization request');
    if (pending.expires_at.getTime() < Date.now()) {
      await query('delete from mcp_oauth.pending_authorizations where id = $1', [pendingId]);
      throw new InvalidGrantError('Authorization request expired — please try connecting again');
    }

    const code = newSecret();
    await query(
      `insert into mcp_oauth.auth_codes
         (code, client_id, user_id, redirect_uri, code_challenge, code_challenge_method,
          scope, supabase_refresh_token, expires_at)
       values ($1, $2, $3, $4, $5, 'S256', $6, $7, $8)`,
      [
        code,
        pending.client_id,
        userId,
        pending.redirect_uri,
        pending.code_challenge,
        pending.scope,
        supabaseRefreshToken,
        new Date(Date.now() + config.token.authCodeTtlSeconds * 1000)
      ]
    );

    // One-shot: the pending request cannot be replayed into a second code.
    await query('delete from mcp_oauth.pending_authorizations where id = $1', [pendingId]);

    const redirect = new URL(pending.redirect_uri);
    redirect.searchParams.set('code', code);
    if (pending.state) redirect.searchParams.set('state', pending.state);
    return redirect.toString();
  }

  /** PKCE: the SDK's token handler compares this against the code_verifier. */
  async challengeForAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string
  ): Promise<string> {
    const row = await queryOne<{ code_challenge: string; client_id: string }>(
      'select code_challenge, client_id from mcp_oauth.auth_codes where code = $1',
      [authorizationCode]
    );
    if (!row || row.client_id !== client.client_id) {
      throw new InvalidGrantError('Invalid authorization code');
    }
    return row.code_challenge;
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
    _codeVerifier?: string,
    redirectUri?: string
  ): Promise<OAuthTokens> {
    const row = await queryOne<{
      client_id: string;
      user_id: string;
      redirect_uri: string;
      scope: string;
      supabase_refresh_token: string;
      expires_at: Date;
      consumed_at: Date | null;
    }>('select * from mcp_oauth.auth_codes where code = $1', [authorizationCode]);

    if (!row || row.client_id !== client.client_id) {
      throw new InvalidGrantError('Invalid authorization code');
    }
    if (row.consumed_at) {
      // Replay of a used code. Treat the whole grant as compromised.
      await query('update mcp_oauth.tokens set revoked_at = now() where user_id = $1 and client_id = $2 and revoked_at is null', [
        row.user_id,
        row.client_id
      ]);
      throw new InvalidGrantError('Authorization code has already been used');
    }
    if (row.expires_at.getTime() < Date.now()) {
      throw new InvalidGrantError('Authorization code expired');
    }
    if (redirectUri !== undefined && redirectUri !== row.redirect_uri) {
      throw new InvalidGrantError('redirect_uri does not match the authorization request');
    }

    await query('update mcp_oauth.auth_codes set consumed_at = now() where code = $1', [
      authorizationCode
    ]);

    return this.issueTokens(row.client_id, row.user_id, row.scope, row.supabase_refresh_token);
  }

  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refreshToken: string,
    scopes?: string[]
  ): Promise<OAuthTokens> {
    const row = await queryOne<{
      id: string;
      client_id: string;
      user_id: string;
      scope: string;
      supabase_refresh_token: string;
      refresh_token_expires_at: Date | null;
      revoked_at: Date | null;
    }>('select * from mcp_oauth.tokens where refresh_token_hash = $1', [hashToken(refreshToken)]);

    if (!row || row.client_id !== client.client_id) {
      throw new InvalidGrantError('Invalid refresh token');
    }
    if (row.revoked_at) throw new InvalidGrantError('Refresh token has been revoked');
    if (row.refresh_token_expires_at && row.refresh_token_expires_at.getTime() < Date.now()) {
      throw new InvalidGrantError('Refresh token expired — reconnect the integration');
    }

    // Narrowing only: a refresh must never widen what the grant covers.
    const granted = row.scope.split(' ');
    const requested = scopes?.length ? scopes : granted;
    const widened = requested.filter(s => !granted.includes(s));
    if (widened.length > 0) {
      throw new InvalidGrantError(`Refresh cannot add scopes: ${widened.join(', ')}`);
    }

    // Rotate: the old refresh token stops working the moment a new one is out.
    await query('update mcp_oauth.tokens set revoked_at = now() where id = $1', [row.id]);

    return this.issueTokens(
      row.client_id,
      row.user_id,
      requested.join(' '),
      row.supabase_refresh_token
    );
  }

  /**
   * Verifies our own access token and, in the same step, produces a fresh
   * Supabase access token for the user behind it. Everything the tools then do
   * runs as that user under RLS — the MCP path has no more authority than the
   * browser path.
   */
  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const row = await queryOne<{
      id: string;
      client_id: string;
      user_id: string;
      scope: string;
      supabase_refresh_token: string;
      access_token_expires_at: Date;
      revoked_at: Date | null;
    }>('select * from mcp_oauth.tokens where access_token_hash = $1', [hashToken(token)]);

    if (!row) throw new InvalidTokenError('Unknown access token');
    if (row.revoked_at) throw new InvalidTokenError('Access token has been revoked');
    if (row.access_token_expires_at.getTime() < Date.now()) {
      throw new InvalidTokenError('Access token expired');
    }

    const { data, error } = await authClient().auth.refreshSession({
      refresh_token: row.supabase_refresh_token
    });

    if (error || !data.session) {
      // The Supabase session is gone (password change, sign-out everywhere,
      // expiry). Our grant is worthless without it, so drop it and make the
      // client re-authorize rather than fail every tool call from here on.
      //
      // Logged because the client only ever sees "authorization failed": this
      // revokes the grant half a second after it was issued, and without the
      // cause there is nothing in the logs to say why.
      console.error(
        `[tally] supabase session refresh failed for token ${row.id} — ${error?.message ?? 'no session returned'}`
      );
      await query('update mcp_oauth.tokens set revoked_at = now() where id = $1', [row.id]);
      throw new InvalidTokenError(
        'Your account session has ended. Reconnect the integration to continue.'
      );
    }

    // GoTrue rotates refresh tokens on every use — store the new one or the
    // next verification will fail.
    await query(
      'update mcp_oauth.tokens set supabase_refresh_token = $1, last_used_at = now() where id = $2',
      [data.session.refresh_token, row.id]
    );

    return {
      token,
      clientId: row.client_id,
      scopes: row.scope.split(' ').filter(Boolean),
      expiresAt: Math.floor(row.access_token_expires_at.getTime() / 1000),
      resource: new URL(config.publicUrl),
      extra: {
        userId: row.user_id,
        supabaseAccessToken: data.session.access_token
      }
    };
  }

  async revokeToken(
    client: OAuthClientInformationFull,
    request: OAuthTokenRevocationRequest
  ): Promise<void> {
    const hash = hashToken(request.token);
    await query(
      `update mcp_oauth.tokens
          set revoked_at = now()
        where client_id = $1
          and revoked_at is null
          and (access_token_hash = $2 or refresh_token_hash = $2)`,
      [client.client_id, hash]
    );
  }

  private async issueTokens(
    clientId: string,
    userId: string,
    scope: string,
    supabaseRefreshToken: string
  ): Promise<OAuthTokens> {
    const accessToken = newSecret();
    const refreshToken = newSecret();
    const now = Date.now();

    try {
      await query(
        `insert into mcp_oauth.tokens
           (client_id, user_id, access_token_hash, refresh_token_hash, scope,
            supabase_refresh_token, access_token_expires_at, refresh_token_expires_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          clientId,
          userId,
          hashToken(accessToken),
          hashToken(refreshToken),
          scope,
          supabaseRefreshToken,
          new Date(now + config.token.accessTokenTtlSeconds * 1000),
          new Date(now + config.token.refreshTokenTtlSeconds * 1000)
        ]
      );
    } catch (cause) {
      throw new ServerError(`Could not issue tokens: ${(cause as Error).message}`);
    }

    return {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: config.token.accessTokenTtlSeconds,
      refresh_token: refreshToken,
      scope
    };
  }
}

export const oauthProvider = new SupabaseOAuthProvider();
