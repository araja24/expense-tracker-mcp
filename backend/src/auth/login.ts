import express from 'express';
import { createClient } from '@supabase/supabase-js';
import { config } from '../config.js';
import { oauthProvider } from './provider.js';
import { queryOne } from '../db.js';

/**
 * The consent/login leg of the OAuth flow. An MCP client sends the user here;
 * they sign in with the same Supabase account (Google, or email) that they use
 * in the web app, and we hand back an authorization code.
 *
 * The sign-in itself happens in the browser against Supabase directly, so this
 * server never sees a password.
 */
export const loginRouter = express.Router();

function escapeJs(value: string): string {
  return JSON.stringify(value);
}

function renderLoginPage(requestId: string, clientName: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Connect to Tally</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;600;700&display=swap" rel="stylesheet">
<style>
  :root {
    --bg: #F4F4F5; --surface: #FFFFFF; --border: #E4E4E7;
    --fg: #18181B; --muted: #71717A; --subtle: #A1A1AA;
    --primary: #2563EB; --primary-hover: #1D4ED8; --primary-tint: #EFF6FF;
    --danger: #B91C1C; --danger-tint: #FEF2F2;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
    padding: 24px; background: var(--bg); color: var(--fg);
    font-family: "Plus Jakarta Sans", ui-sans-serif, system-ui, sans-serif; font-weight: 500;
    -webkit-font-smoothing: antialiased;
  }
  .card {
    width: 100%; max-width: 400px; background: var(--surface);
    border: 1px solid var(--border); border-radius: 14px; padding: 28px;
    box-shadow: 0 1px 2px rgba(24,24,27,.04), 0 8px 24px rgba(24,24,27,.06);
  }
  .brand { display: flex; align-items: center; gap: 10px; margin-bottom: 20px; }
  .mark {
    width: 36px; height: 36px; border-radius: 10px; background: var(--primary);
    display: flex; align-items: center; justify-content: center;
  }
  .brand span { font-size: 17px; font-weight: 600; letter-spacing: -.02em; }
  h1 { font-size: 19px; font-weight: 600; letter-spacing: -.02em; margin: 0 0 6px; }
  p.lede { margin: 0 0 20px; font-size: 13.5px; color: var(--muted); line-height: 1.5; }
  .client { font-weight: 600; color: var(--fg); }
  label { display: block; font-size: 12.5px; font-weight: 600; margin: 0 0 6px; }
  input {
    width: 100%; height: 40px; padding: 0 12px; font: inherit; font-size: 13.5px;
    background: #FAFAFA; border: 1px solid var(--border); border-radius: 8px; color: var(--fg);
  }
  input:focus { outline: 2px solid var(--primary-tint); border-color: var(--primary); }
  button {
    width: 100%; height: 40px; font: inherit; font-size: 13.5px; font-weight: 600;
    border-radius: 8px; cursor: pointer; border: 1px solid transparent;
  }
  .primary { background: var(--primary); color: #fff; }
  .primary:hover { background: var(--primary-hover); }
  .secondary { background: var(--surface); color: var(--fg); border-color: var(--border); }
  .secondary:hover { background: #FAFAFA; }
  .stack > * + * { margin-top: 10px; }
  .divider {
    display: flex; align-items: center; gap: 10px; margin: 18px 0;
    font-size: 11.5px; color: var(--subtle); text-transform: uppercase; letter-spacing: .06em;
  }
  .divider::before, .divider::after { content: ""; height: 1px; background: var(--border); flex: 1; }
  .msg { margin-top: 14px; font-size: 12.5px; line-height: 1.5; padding: 10px 12px; border-radius: 8px; display: none; }
  .msg.error { display: block; background: var(--danger-tint); color: var(--danger); }
  .msg.info { display: block; background: var(--primary-tint); color: var(--primary-hover); }
  .scopes { margin: 0 0 20px; padding: 12px 14px; background: #FAFAFA; border: 1px solid var(--border); border-radius: 10px; }
  .scopes li { font-size: 12.5px; color: var(--muted); line-height: 1.7; }
  .scopes ul { margin: 0; padding-left: 18px; }
  .foot { margin-top: 18px; font-size: 11.5px; color: var(--subtle); line-height: 1.5; }
</style>
</head>
<body>
  <main class="card">
    <div class="brand">
      <div class="mark">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
          <path d="M5 3v18l2.5-1.5L10 21l2-1.5L14 21l2.5-1.5L19 21V3l-2.5 1.5L14 3l-2 1.5L10 3 7.5 4.5Z"/><path d="M9 9h6"/><path d="M9 13.5h4"/>
        </svg>
      </div>
      <span>Tally</span>
    </div>

    <h1>Connect your assistant</h1>
    <p class="lede"><span class="client" id="client-name"></span> wants to log and read expenses in your Tally account.</p>

    <div class="scopes">
      <ul>
        <li>Add, edit and delete your expenses</li>
        <li>Read your categories, budgets and summaries</li>
      </ul>
    </div>

    <div class="stack">
      <button class="secondary" id="google">Continue with Google</button>
      <div class="divider">or</div>
      <div>
        <label for="email">Email</label>
        <input id="email" type="email" autocomplete="email" placeholder="you@example.com">
      </div>
      <div>
        <label for="password">Password <span style="font-weight:500;color:var(--subtle)">(leave blank for a magic link)</span></label>
        <input id="password" type="password" autocomplete="current-password" placeholder="••••••••">
      </div>
      <button class="primary" id="signin">Sign in and connect</button>
    </div>

    <div class="msg" id="msg"></div>
    <p class="foot">You can disconnect at any time from Settings in the Tally web app.</p>
  </main>

<script type="module">
  import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

  const REQUEST_ID = ${escapeJs(requestId)};
  const CLIENT_NAME = ${escapeJs(clientName)};
  document.getElementById('client-name').textContent = CLIENT_NAME;

  const supabase = createClient(${escapeJs(config.supabase.url)}, ${escapeJs(config.supabase.anonKey)}, {
    auth: { persistSession: true, detectSessionInUrl: true, flowType: 'pkce' }
  });

  const msg = document.getElementById('msg');
  function show(kind, text) { msg.className = 'msg ' + kind; msg.textContent = text; }

  // Hands the Supabase session to our OAuth server, which turns it into an
  // authorization code and tells us where to send the browser next.
  async function finish(session) {
    show('info', 'Connecting…');
    const res = await fetch('/login/complete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        request: REQUEST_ID,
        access_token: session.access_token,
        refresh_token: session.refresh_token
      })
    });
    const body = await res.json();
    if (!res.ok) { show('error', body.error_description || body.error || 'Could not complete the connection.'); return; }
    // The local session existed only to complete this handshake.
    await supabase.auth.signOut({ scope: 'local' });
    window.location.href = body.redirect;
  }

  // Returning from the Google redirect: the session is already in the URL.
  const { data: { session } } = await supabase.auth.getSession();
  if (session) { finish(session); }

  document.getElementById('google').addEventListener('click', async () => {
    const redirectTo = new URL(window.location.href);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: redirectTo.toString() }
    });
    if (error) show('error', error.message);
  });

  document.getElementById('signin').addEventListener('click', async () => {
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;
    if (!email) { show('error', 'Enter your email address.'); return; }

    if (password) {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) { show('error', error.message); return; }
      finish(data.session);
    } else {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: window.location.href }
      });
      if (error) { show('error', error.message); return; }
      show('info', 'Check your email for a sign-in link, then come back to this page.');
    }
  });
</script>
</body>
</html>`;
}

loginRouter.get('/login', async (req, res) => {
  const requestId = typeof req.query.request === 'string' ? req.query.request : '';
  if (!requestId) {
    res.status(400).type('text/plain').send('Missing authorization request.');
    return;
  }

  const pending = await queryOne<{ client_id: string; expires_at: Date }>(
    'select client_id, expires_at from mcp_oauth.pending_authorizations where id = $1',
    [requestId]
  );

  if (!pending || pending.expires_at.getTime() < Date.now()) {
    res
      .status(400)
      .type('text/plain')
      .send('This connection request has expired. Start again from your assistant.');
    return;
  }

  const client = await oauthProvider.clientsStore.getClient(pending.client_id);
  const clientName = client?.client_name ?? 'An MCP client';

  res
    .type('html')
    // The page is per-request and carries an authorization id; never cache it.
    .set('Cache-Control', 'no-store')
    .send(renderLoginPage(requestId, clientName));
});

loginRouter.post('/login/complete', async (req, res) => {
  const { request, access_token: accessToken, refresh_token: refreshToken } = req.body ?? {};

  if (
    typeof request !== 'string' ||
    typeof accessToken !== 'string' ||
    typeof refreshToken !== 'string'
  ) {
    res.status(400).json({ error: 'invalid_request' });
    return;
  }

  // Trust nothing from the page: confirm the token really is a Supabase
  // session and find out who it belongs to.
  const supabase = createClient(config.supabase.url, config.supabase.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { data, error } = await supabase.auth.getUser(accessToken);

  if (error || !data.user) {
    res.status(401).json({ error: 'invalid_grant', error_description: 'Sign-in could not be verified.' });
    return;
  }

  try {
    const redirect = await oauthProvider.completeAuthorization(request, data.user.id, refreshToken);
    res.json({ redirect });
  } catch (cause) {
    res.status(400).json({
      error: 'invalid_grant',
      error_description: cause instanceof Error ? cause.message : 'Could not complete authorization.'
    });
  }
});
