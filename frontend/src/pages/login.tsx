import * as React from 'react'
import { Navigate } from 'react-router-dom'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/use-auth'
import { TallyMark } from '@/components/app-shell'
import { GhostButton, PrimaryButton } from '@/components/tally'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type Mode = 'signin' | 'signup'

export function LoginPage() {
  const { session, loading } = useAuth()
  const [mode, setMode] = React.useState<Mode>('signin')
  const [email, setEmail] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [sentLink, setSentLink] = React.useState(false)

  if (loading) return null
  if (session) return <Navigate to="/" replace />

  async function withBusy(run: () => Promise<void>) {
    setBusy(true)
    try {
      await run()
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  const signInWithGoogle = () =>
    withBusy(async () => {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.origin },
      })
      if (error) throw error
    })

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    return withBusy(async () => {
      if (!email.trim()) throw new Error('Enter your email address')

      // No password given: fall back to a magic link rather than refusing.
      if (!password) {
        const { error } = await supabase.auth.signInWithOtp({
          email: email.trim(),
          options: { emailRedirectTo: window.location.origin },
        })
        if (error) throw error
        setSentLink(true)
        return
      }

      if (mode === 'signup') {
        const { error } = await supabase.auth.signUp({ email: email.trim(), password })
        if (error) throw error
        toast.success('Account created — check your email if confirmation is required.')
        return
      }

      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
      if (error) throw error
    })
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-[400px] rounded-xl border border-border bg-card p-7 shadow-[0_1px_2px_rgba(24,24,27,.04),0_8px_24px_rgba(24,24,27,.06)]">
        <div className="mb-5 flex items-center gap-2.5">
          <TallyMark />
          <span className="text-[17px] font-semibold tracking-[-0.02em] text-ink-strong">Tally</span>
        </div>

        <h1 className="text-[19px] font-semibold tracking-[-0.02em] text-ink-strong">
          {mode === 'signin' ? 'Welcome back' : 'Create your account'}
        </h1>
        <p className="mb-5 mt-1.5 text-[13.5px] font-medium leading-relaxed text-ink-muted">
          Track what you spend — in the app, or by telling your assistant.
        </p>

        {sentLink ? (
          <div className="rounded-lg bg-primary-tint px-4 py-3 text-[13px] leading-relaxed text-accent-foreground">
            Check <span className="font-semibold">{email}</span> for a sign-in link. You can close
            this tab once you have clicked it.
          </div>
        ) : (
          <>
            <GhostButton className="w-full" onClick={signInWithGoogle} disabled={busy}>
              <GoogleMark />
              Continue with Google
            </GhostButton>

            <div className="my-[18px] flex items-center gap-2.5 text-[11.5px] uppercase tracking-[0.06em] text-ink-subtle">
              <span className="h-px grow bg-border" />
              or
              <span className="h-px grow bg-border" />
            </div>

            <form onSubmit={submit} className="grid gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="password">
                  Password{' '}
                  <span className="font-medium text-ink-subtle">(leave blank for a magic link)</span>
                </Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                  placeholder="••••••••"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </div>

              <PrimaryButton type="submit" className="w-full" disabled={busy}>
                {busy ? 'Working…' : mode === 'signin' ? 'Sign in' : 'Create account'}
              </PrimaryButton>
            </form>

            <p className="mt-4 text-center text-[12.5px] font-medium text-ink-muted">
              {mode === 'signin' ? "Don't have an account?" : 'Already have an account?'}{' '}
              <button
                type="button"
                className="cursor-pointer font-semibold text-primary hover:text-primary-hover"
                onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')}
              >
                {mode === 'signin' ? 'Sign up' : 'Sign in'}
              </button>
            </p>
          </>
        )}
      </div>
    </div>
  )
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.76h3.57c2.08-1.92 3.28-4.74 3.28-8.09Z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.76c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.11a6.6 6.6 0 0 1 0-4.22V7.05H2.18a11 11 0 0 0 0 9.9l3.66-2.84Z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1a11 11 0 0 0-9.82 6.05l3.66 2.84c.87-2.6 3.3-4.51 6.16-4.51Z"
      />
    </svg>
  )
}
