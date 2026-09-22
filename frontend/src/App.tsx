import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Toaster } from 'sonner'
import { AuthProvider, useAuth } from '@/hooks/use-auth'
import { AppShell } from '@/components/app-shell'
import { ErrorBoundary } from '@/components/error-boundary'
import { BudgetsPage } from '@/pages/budgets'
import { DashboardPage } from '@/pages/dashboard'
import { LoginPage } from '@/pages/login'
import { SettingsPage } from '@/pages/settings'
import { TransactionsPage } from '@/pages/transactions'

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth()

  // Render nothing until the stored session has been read, or a refresh would
  // flash the login screen before landing back where the user was.
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-[13px] text-muted-foreground">
        Loading…
      </div>
    )
  }

  if (!session) return <Navigate to="/login" replace />
  return <>{children}</>
}

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            element={
              <RequireAuth>
                <AppShell />
              </RequireAuth>
            }
          >
            <Route index element={<DashboardPage />} />
            <Route path="/transactions" element={<TransactionsPage />} />
            <Route path="/budgets" element={<BudgetsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        <Toaster
          position="bottom-right"
          toastOptions={{
            style: {
              fontFamily: 'inherit',
              fontSize: '13px',
              borderRadius: '10px',
            },
          }}
        />
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  )
}
