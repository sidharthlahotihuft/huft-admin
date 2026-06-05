import { NavLink, useNavigate } from 'react-router-dom'
import { LogOut } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useUser } from '@/lib/userContext'
import type { PortalConfig } from '@/lib/portals'

interface SidebarProps {
  portal: PortalConfig
}

export default function Sidebar({ portal }: SidebarProps) {
  const navigate = useNavigate()
  const { user } = useUser() ?? {}

  const initials = user?.name
    ? user.name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2)
    : 'AD'

  const handleLogout = async () => {
    await supabase.auth.signOut()
    navigate(portal.loginPath, { replace: true })
  }

  return (
    <aside className="flex h-screen w-60 shrink-0 flex-col" style={{ backgroundColor: '#1A1A2E' }}>
      {/* ── Logo ─────────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 border-b border-white/10 px-4 py-5">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-xl"
          style={{ backgroundColor: portal.accentColor }}
        >
          {portal.emoji}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-bold leading-none text-white">{portal.name}</p>
          <p className="mt-0.5 text-[11px] text-white/45">{portal.subtitle}</p>
        </div>
      </div>

      {/* ── Navigation ───────────────────────────────────────────────────────── */}
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-4">
        {portal.navItems.filter(({ path }) => {
          const role = user?.role
          const isAdminPage = path.endsWith('/staff') || path.endsWith('/stores')
          if (!isAdminPage) return true
          return role === 'super_admin' || role === 'training_admin' || role === 'erp_admin'
        }).map(({ icon: Icon, label, path }) => (
          <NavLink
            key={path}
            to={path}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                isActive
                  ? 'text-white'
                  : 'text-white/55 hover:bg-white/6 hover:text-white/90'
              }`
            }
            style={({ isActive }) =>
              isActive ? { backgroundColor: portal.accentColor } : {}
            }
          >
            <Icon className="h-4 w-4 shrink-0" />
            {label}
          </NavLink>
        ))}
      </nav>

      {/* ── User + Logout ─────────────────────────────────────────────────────── */}
      <div className="border-t border-white/10 px-3 py-4">
        <div className="mb-3 flex items-center gap-3 rounded-lg px-2 py-1.5">
          <div
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
            style={{ backgroundColor: portal.accentColor }}
          >
            {initials}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-white">
              {user?.name ?? 'Admin'}
            </p>
            <p className="truncate text-[11px] text-white/45">
              {user?.store?.name ?? portal.name}
            </p>
          </div>
        </div>
        <button
          onClick={handleLogout}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-white/50 transition-colors hover:bg-white/6 hover:text-white/80"
        >
          <LogOut className="h-4 w-4 shrink-0" />
          Logout
        </button>
      </div>
    </aside>
  )
}
