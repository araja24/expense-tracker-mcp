import * as React from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import {
  ArrowLeftRight,
  ChevronsUpDown,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings as SettingsIcon,
  Wallet,
} from 'lucide-react'
import { useAuth } from '@/hooks/use-auth'
import { initials } from '@/lib/format'
import { cn } from '@/lib/utils'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/transactions', label: 'Transactions', icon: ArrowLeftRight, end: false },
  { to: '/budgets', label: 'Budgets', icon: Wallet, end: false },
  { to: '/settings', label: 'Settings', icon: SettingsIcon, end: false },
]

export function TallyMark({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-primary',
        className,
      )}
    >
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#fff"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M5 3v18l2.5-1.5L10 21l2-1.5L14 21l2.5-1.5L19 21V3l-2.5 1.5L14 3l-2 1.5L10 3 7.5 4.5Z" />
        <path d="M9 9h6" />
        <path d="M9 13.5h4" />
      </svg>
    </div>
  )
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { user, profile, signOut } = useAuth()
  const navigate = useNavigate()
  return (
    <div className="flex h-full flex-col border-r border-sidebar-border bg-sidebar px-3 pb-3.5 pt-[18px]">
      <div className="flex items-center gap-2.5 px-1.5">
        <TallyMark />
        <span className="text-[17px] font-semibold tracking-[-0.02em] text-ink-strong">Tally</span>
      </div>

      <nav className="mt-5 flex flex-col gap-0.5 px-0.5">
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                'flex h-10 items-center gap-2.5 rounded-lg px-2.5 text-[13.5px] transition-colors',
                isActive
                  ? 'bg-sidebar-accent font-semibold text-sidebar-accent-foreground'
                  : 'font-medium text-sidebar-foreground hover:bg-secondary hover:text-ink-strong',
              )
            }
          >
            {({ isActive }) => (
              <>
                <Icon
                  className={cn(
                    'size-[18px]',
                    isActive ? 'text-sidebar-accent-foreground' : 'text-ink-subtle',
                  )}
                  strokeWidth={1.75}
                />
                {label}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="grow" />

      <div className="mx-0.5 border-t border-sidebar-border pt-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg p-2 text-left transition-colors hover:bg-secondary"
            >
              <span className="flex size-[34px] shrink-0 items-center justify-center rounded-full bg-sidebar-accent text-[12.5px] font-semibold text-sidebar-accent-foreground">
                {initials(profile?.display_name, user?.email ?? '?')}
              </span>
              <span className="flex min-w-0 grow flex-col gap-px">
                <span className="truncate text-[13px] font-semibold text-ink-strong">
                  {profile?.display_name ?? user?.email?.split('@')[0] ?? 'Account'}
                </span>
                <span className="truncate text-[11.5px] font-medium text-ink-muted">
                  {user?.email}
                </span>
              </span>
              <ChevronsUpDown className="size-4 shrink-0 text-ink-subtle" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="top" className="w-56">
            <DropdownMenuLabel>{user?.email}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => navigate('/settings')}>
              <SettingsIcon />
              Settings
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onSelect={() => void signOut()}>
              <LogOut />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}

export function AppShell() {
  const [mobileOpen, setMobileOpen] = React.useState(false)

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="hidden w-64 shrink-0 lg:block">
        <div className="fixed inset-y-0 w-64">
          <Sidebar />
        </div>
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close navigation"
            className="absolute inset-0 bg-foreground/25"
            onClick={() => setMobileOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 w-64">
            <Sidebar onNavigate={() => setMobileOpen(false)} />
          </div>
        </div>
      )}

      <div className="flex min-w-0 grow flex-col">
        <div className="flex h-14 items-center gap-3 border-b border-border bg-card px-4 lg:hidden">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="flex size-8 cursor-pointer items-center justify-center rounded-lg text-ink-muted hover:bg-secondary"
          >
            <Menu className="size-4" />
            <span className="sr-only">Open navigation</span>
          </button>
          <TallyMark className="size-7 rounded-lg" />
          <span className="text-[15px] font-semibold">Tally</span>
        </div>

        <main className="flex min-w-0 grow flex-col">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
