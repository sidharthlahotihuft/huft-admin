import { useEffect } from 'react'
import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import Sidebar from './Sidebar'
import { useUser } from '@/lib/userContext'
import type { PortalConfig } from '@/lib/portals'

interface AppShellProps {
  portal: PortalConfig
}

export default function AppShell({ portal }: AppShellProps) {
  const navigate  = useNavigate()
  const location  = useLocation()
  const { user, loading } = useUser()

  useEffect(() => {
    document.title = `${portal.name} — HUFT`
  }, [portal.name])

  // Only redirect once the session check is complete and there is no user.
  // The 500 ms delay gives Supabase time to restore the session from localStorage
  // before the redirect fires on a hard refresh.
  useEffect(() => {
    if (!loading && !user) {
      const timer = setTimeout(() => {
        navigate(portal.loginPath, { replace: true })
      }, 500)
      return () => clearTimeout(timer)
    }
  }, [loading, user, navigate, portal.loginPath])

  // Derive page title from path
  const segments    = location.pathname.split('/').filter(Boolean)
  const pageSegments = segments.slice(1)
  const titleize    = (s: string) =>
    s.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  const pageTitle   = titleize(pageSegments[pageSegments.length - 1] ?? 'overview')

  // Show spinner while session is hydrating OR while navigating away after logout
  if (loading || !user) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <div className="text-sm text-gray-400">Loading…</div>
      </div>
    )
  }

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      <Sidebar portal={portal} />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* ── Top header ───────────────────────────────────────────────────── */}
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-gray-200 bg-white px-6">
          <h1 className="text-sm font-semibold text-gray-900">{pageTitle}</h1>

          <Button
            variant="outline"
            size="sm"
            onClick={() => window.location.reload()}
            className="gap-2 text-gray-600"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </Button>
        </header>

        {/* ── Page content ─────────────────────────────────────────────────── */}
        <main className="flex-1 overflow-y-auto px-6 pb-6 pt-8">
          <Outlet context={{ user }} />
        </main>
      </div>
    </div>
  )
}
