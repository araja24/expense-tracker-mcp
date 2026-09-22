import * as React from 'react'
import { formatDistanceToNow, parseISO } from 'date-fns'
import { Check, CircleHelp, Copy, Link2, Plug, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { fetchMcpConnections, revokeMcpConnection } from '@/lib/api'
import { longDate } from '@/lib/format'
import type { McpConnection } from '@/lib/types'
import { cn } from '@/lib/utils'
import { GhostButton, Panel, PanelHead, PrimaryButton } from '@/components/tally'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'

/*
 * Render only knows the API's hostname once that service exists, and a
 * blueprint cannot concatenate a path onto it. So the host can be injected on
 * its own (via `fromService`) and the URL built here; an explicit full URL
 * still wins, for a custom domain or local work.
 */
const MCP_HOST = import.meta.env.VITE_MCP_SERVER_HOST
const MCP_URL =
  import.meta.env.VITE_MCP_SERVER_URL ??
  (MCP_HOST ? `https://${MCP_HOST}/mcp` : 'http://localhost:8787/mcp')

/** A client that has called in the last day is worth calling active. */
const ACTIVE_WINDOW_MS = 24 * 60 * 60 * 1000

function isActive(connection: McpConnection): boolean {
  if (!connection.last_used_at) return false
  return Date.now() - parseISO(connection.last_used_at).getTime() < ACTIVE_WINDOW_MS
}

/** Scope, in the words of what the client can actually do to your data. */
function capability(scope: string): string {
  const scopes = scope.split(/\s+/).filter(Boolean)
  if (scopes.includes('expenses:write')) return 'can log and read expenses'
  if (scopes.includes('expenses:read')) return 'can read expenses'
  return 'no access granted'
}

/** Recent use reads better relative; anything older is just a date. */
function lastUsedLabel(connection: McpConnection): string {
  if (!connection.last_used_at) return 'Never'
  const when = parseISO(connection.last_used_at)
  const age = Date.now() - when.getTime()
  if (age < 7 * 24 * 60 * 60 * 1000) return `${formatDistanceToNow(when)} ago`
  return longDate(connection.last_used_at.slice(0, 10))
}

/**
 * Monogram for each client. One letter is enough until two clients start with
 * the same one — "Claude" and "Cursor" both being C is exactly the case the
 * design shows, so the second grows to "Cu".
 */
function monograms(connections: McpConnection[]): Record<string, string> {
  const taken = new Set<string>()
  const result: Record<string, string> = {}

  for (const connection of connections) {
    const name = connection.client_name.trim() || '?'
    let mark = name[0]!.toUpperCase()
    for (let length = 2; taken.has(mark) && length <= name.length; length += 1) {
      mark = name[0]!.toUpperCase() + name.slice(1, length).toLowerCase()
    }
    taken.add(mark)
    result[connection.client_id] = mark
  }

  return result
}

export function ConnectAssistant() {
  const [connections, setConnections] = React.useState<McpConnection[] | null>(null)
  /** True when the RPCs are missing, i.e. migration 0004 has not been run. */
  const [unavailable, setUnavailable] = React.useState(false)
  const [loading, setLoading] = React.useState(true)
  const [copied, setCopied] = React.useState(false)
  const [guideOpen, setGuideOpen] = React.useState(false)

  const load = React.useCallback(async () => {
    try {
      const rows = await fetchMcpConnections()
      if (rows === null) {
        setUnavailable(true)
        setConnections([])
      } else {
        setUnavailable(false)
        setConnections(rows)
      }
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Could not load connected clients')
      setConnections([])
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void load()
  }, [load])

  async function copyUrl() {
    try {
      await navigator.clipboard.writeText(MCP_URL)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
      toast.success('Server URL copied')
    } catch {
      toast.error('Could not copy — select the URL and copy manually.')
    }
  }

  async function disconnect(connection: McpConnection) {
    const message = `Disconnect ${connection.client_name}? It will lose access immediately and has to be reconnected to log anything again.`
    if (!window.confirm(message)) return

    try {
      await revokeMcpConnection(connection.client_id)
      toast.success(`${connection.client_name} disconnected`)
      await load()
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Could not disconnect that client')
    }
  }

  const marks = monograms(connections ?? [])

  return (
    <>
      <Panel>
        <PanelHead
          icon={Plug}
          tint="#2563EB"
          title="Connect your AI assistant"
          titleBadge="MCP"
          description={
            <>
              Add Tally as a connector in any MCP client. Then write things like “I spent $12 on
              coffee at Blue Bottle” and the expense lands here, already categorised.
            </>
          }
        />

        <div className="flex flex-col gap-3 px-[22px] pb-5">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="mcp-url" className="text-[12.5px] font-semibold text-ink-strong">
              MCP server URL
            </label>
            <div className="flex items-center gap-2.5">
              <div className="flex h-11 min-w-0 grow items-center gap-2.5 rounded-lg border border-border bg-muted px-3">
                <Link2 className="size-4 shrink-0 text-ink-subtle" strokeWidth={1.9} />
                <input
                  id="mcp-url"
                  readOnly
                  value={MCP_URL}
                  onFocus={(event) => event.currentTarget.select()}
                  className="min-w-0 grow bg-transparent font-mono text-[13px] text-ink-strong outline-none"
                />
              </div>
              <PrimaryButton className="h-11 shrink-0" onClick={copyUrl}>
                {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                {copied ? 'Copied' : 'Copy URL'}
              </PrimaryButton>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="inline-flex items-center gap-2 text-[12.5px] font-medium text-ink-muted">
              <ShieldCheck className="size-4 shrink-0 text-positive-strong" strokeWidth={1.9} />
              No key to paste — you sign in to Tally when a client connects.
            </span>
            <GhostButton size="sm" onClick={() => setGuideOpen(true)}>
              <CircleHelp className="size-4 text-ink-muted" strokeWidth={1.9} />
              Setup guide
            </GhostButton>
          </div>
        </div>

        <div className="flex h-11 shrink-0 items-center gap-4 border-y border-border bg-muted px-[22px] text-[12px] font-semibold text-ink-label">
          <span className="min-w-0 grow">Connected clients</span>
          <span className="hidden w-[150px] shrink-0 sm:block">Connected</span>
          <span className="hidden w-[150px] shrink-0 sm:block">Last used</span>
          <span className="w-[110px] shrink-0" />
        </div>

        {loading ? (
          <div className="space-y-2 px-[22px] py-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : unavailable ? (
          <p className="px-[22px] py-5 text-[13px] font-medium leading-relaxed text-ink-muted">
            Connected clients cannot be listed yet — run{' '}
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[12px]">
              supabase/migrations/0004_mcp_connections.sql
            </code>{' '}
            to enable it. Connecting a client already works without this.
          </p>
        ) : connections && connections.length > 0 ? (
          connections.map((connection) => {
            const active = isActive(connection)
            return (
              <div
                key={connection.client_id}
                className="flex flex-wrap items-center gap-4 border-b border-divider px-[22px] py-3.5 last:border-b-0"
              >
                <span className="flex min-w-0 grow items-center gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-muted text-[12.5px] font-semibold text-ink-mid">
                    {marks[connection.client_id]}
                  </span>
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate text-[13.5px] font-semibold text-ink-strong">
                      {connection.client_name}
                    </span>
                    <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-ink-muted">
                      <span
                        className={cn(
                          'size-[7px] shrink-0 rounded-full',
                          active ? 'bg-positive-strong' : 'bg-ink-subtle',
                        )}
                        aria-hidden
                      />
                      {active ? 'Active' : 'Idle'} · {capability(connection.scope)}
                    </span>
                  </span>
                </span>

                <span className="tabular hidden w-[150px] shrink-0 text-[13px] font-medium text-ink-label sm:block">
                  {longDate(connection.connected_at.slice(0, 10))}
                </span>
                <span className="tabular hidden w-[150px] shrink-0 text-[13px] font-medium text-ink-label sm:block">
                  {lastUsedLabel(connection)}
                </span>

                <span className="flex w-[110px] shrink-0 justify-end">
                  <GhostButton
                    size="xs"
                    tone="danger"
                    className="border-danger-border hover:bg-danger-tint"
                    onClick={() => disconnect(connection)}
                  >
                    Disconnect
                  </GhostButton>
                </span>
              </div>
            )
          })
        ) : (
          <div className="flex flex-col items-start gap-3 px-[22px] py-6">
            <p className="text-[13px] font-medium leading-relaxed text-ink-muted">
              No clients connected yet. Copy the URL above into Claude, Cursor or any other MCP
              client — anything you connect shows up here, and you can cut it off from this list.
            </p>
            <GhostButton size="sm" onClick={() => setGuideOpen(true)}>
              <CircleHelp className="size-4 text-ink-muted" strokeWidth={1.9} />
              Show me how
            </GhostButton>
          </div>
        )}
      </Panel>

      <SetupGuideDialog open={guideOpen} onOpenChange={setGuideOpen} onCopyUrl={copyUrl} />
    </>
  )
}

const STEPS: { title: string; body: React.ReactNode }[] = [
  {
    title: 'Copy the server URL',
    body: (
      <>
        It is the address above. Everything Tally exposes to an assistant lives behind that one
        URL.
      </>
    ),
  },
  {
    title: 'Add it as a connector in your client',
    body: (
      <>
        In Claude: <span className="text-ink-strong">Settings → Connectors → Add custom
        connector</span>, then paste the URL. Other MCP clients have an equivalent screen — look for
        “custom connector” or “add MCP server”.
      </>
    ),
  },
  {
    title: 'Sign in when the browser opens',
    body: (
      <>
        The client sends you to Tally to approve access. Use the same account you are signed into
        here — there is no API key, and nothing to paste back.
      </>
    ),
  },
  {
    title: 'Just say what you bought',
    body: (
      <>
        “I spent $12 on coffee at Blue Bottle.” It gets logged and categorised straight away. You
        can also ask what you have spent, set budgets, or export a CSV.
      </>
    ),
  },
]

function SetupGuideDialog({
  open,
  onOpenChange,
  onCopyUrl,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCopyUrl: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Connect your AI assistant</DialogTitle>
          <DialogDescription>
            Four steps, about a minute. You will not need an API key.
          </DialogDescription>
        </DialogHeader>

        <ol className="flex flex-col gap-4">
          {STEPS.map((step, index) => (
            <li key={step.title} className="flex gap-3.5">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary-tint text-[12.5px] font-semibold text-accent-foreground">
                {index + 1}
              </span>
              <div className="flex min-w-0 flex-col gap-1 pt-0.5">
                <span className="text-[13.5px] font-semibold text-ink-strong">{step.title}</span>
                <span className="text-[13px] font-medium leading-[1.55] text-ink-muted">
                  {step.body}
                </span>
              </div>
            </li>
          ))}
        </ol>

        <div className="mt-5 rounded-lg border border-border bg-muted px-4 py-3">
          <p className="text-[12.5px] font-medium leading-relaxed text-ink-muted">
            <span className="font-semibold text-ink-strong">A connected client acts as you.</span>{' '}
            It sees the same expenses you do and nothing belonging to anyone else. Disconnect it
            from this page at any time and access stops immediately.
          </p>
        </div>

        <DialogFooter>
          <GhostButton onClick={() => onOpenChange(false)}>Close</GhostButton>
          <PrimaryButton
            onClick={() => {
              onCopyUrl()
              onOpenChange(false)
            }}
          >
            <Copy className="size-4" />
            Copy URL
          </PrimaryButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
