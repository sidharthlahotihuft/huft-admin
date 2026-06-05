import { useEffect, useState } from 'react'
import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import Sidebar from './Sidebar'
import { supabase } from '@/lib/supabase'
import type { Staff } from '@/types'
import type { PortalConfig } from '@/lib/portals'

interface AppShellProps {
  portal: PortalConfig
}

export default function AppShell({ portal }: AppShellProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const [user, setUser] = useState<Staff | null>(null)
  const [authChecked, setAuthChecked] = useState(false)

  useEffect(() => {
    document.title = `${portal.name} — HUFT`
  }, [portal.name])

  useEffect(() => {
    let cancelled = false

    async function checkAuth() {
      const { data: { session } } = await supabase.auth.getSession()

      if (!session) {
        navigate(portal.loginPath, { replace: true })
        return
      }

      const { data: staffData, error: staffError } = await supabase
        .from('staff')
        .select('*')
        .eq('id', session.user.id)
        .single()

      if (!staffData || staffError) {
        navigate(portal.loginPath, { replace: true })
        return
      }

      let store = null
      if (staffData.store_id) {
        const { data: storeData } = await supabase
          .from('stores')
          .select('*')
          .eq('id', staffData.store_id)
          .single()
        store = storeData
      }

      if (!cancelled) {
        setUser({ ...staffData, store: store ?? undefined } as Staff)
        setAuthChecked(true)
      }
    }

    checkAuth()
    return () => { cancelled = true }
  }, [navigate, portal])

  // Derive page title + breadcrumbs from path
  // e.g. /erp/reorder-settings → ['erp', 'reorder-settings'] → 'Reorder Settings'
  const segments = location.pathname.split('/').filter(Boolean)
  const pageSegments = segments.slice(1) // drop portal prefix ('erp' / 'roleplay')
  const titleize = (s: string) =>
    s.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  const pageTitle = titleize(pageSegments[pageSegments.length - 1] ?? 'overview')

  if (!authChecked) {
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
