import * as React from 'react'

interface State {
  error: Error | null
}

/**
 * Without this, any render-time throw unmounts the whole tree and leaves a
 * blank page with nothing but a console trace. Showing the message on screen
 * is the difference between "the app is broken" and a reportable bug.
 */
export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  override state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  override componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[tally] render crashed', error, info.componentStack)
  }

  override render() {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="w-full max-w-lg rounded-xl border border-danger-border bg-card p-6">
          <h1 className="text-[17px] font-semibold text-ink-strong">Something broke</h1>
          <p className="mt-1.5 text-[13px] font-medium text-ink-muted">
            The page failed to render. The error is below, and the full stack is in the browser
            console.
          </p>

          <pre className="mt-4 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-danger-tint px-3 py-2.5 font-mono text-[12px] leading-relaxed text-danger-strong">
            {error.message}
            {error.stack ? `\n\n${error.stack}` : ''}
          </pre>

          <div className="mt-5 flex gap-2">
            <button
              type="button"
              onClick={() => this.setState({ error: null })}
              className="h-10 cursor-pointer rounded-lg border border-border bg-card px-3 text-[13.5px] font-medium text-ink-mid hover:bg-secondary"
            >
              Try again
            </button>
            <button
              type="button"
              onClick={() => {
                // A bad cached session is the usual cause, so offer the cure.
                try {
                  localStorage.clear()
                  sessionStorage.clear()
                } catch {
                  /* private mode — nothing to clear */
                }
                window.location.replace('/login')
              }}
              className="h-10 cursor-pointer rounded-lg border border-primary bg-primary px-3.5 text-[13.5px] font-semibold text-primary-foreground hover:bg-primary-hover"
            >
              Clear session and sign in again
            </button>
          </div>
        </div>
      </div>
    )
  }
}
