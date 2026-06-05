import type { ComponentType } from 'react'
import {
  LayoutDashboard,
  Upload,
  Settings,
  Clock,
  Store,
  Users,
  Video,
  BookOpen,
  ClipboardList,
  TrendingUp,
} from 'lucide-react'

export type Portal = 'erp' | 'roleplay'

export type NavItem = {
  icon: ComponentType<{ className?: string }>
  label: string
  path: string
}

export type Feature = {
  icon: ComponentType<{ className?: string }>
  title: string
  desc: string
}

export type PortalConfig = {
  id: Portal
  name: string
  subtitle: string
  tagline: string
  emoji: string
  accentColor: string
  loginGradient: string
  navItems: NavItem[]
  allowedRoles: readonly string[]
  loginPath: string
  overviewPath: string
  features: Feature[]
}

export const PORTALS: Record<Portal, PortalConfig> = {
  erp: {
    id: 'erp',
    name: 'The Den',
    subtitle: 'Store Operations Portal',
    tagline: 'Upload ERP data, track follow-ups, and manage your store teams.',
    emoji: '🏪',
    accentColor: '#E8642C',
    loginGradient: 'linear-gradient(145deg, #E8642C 0%, #BF4D1E 100%)',
    navItems: [
      { icon: LayoutDashboard, label: 'Overview',          path: '/erp/overview' },
      { icon: Upload,          label: 'ERP Upload',        path: '/erp/upload' },
      { icon: Settings,        label: 'Reorder Settings',  path: '/erp/reorder-settings' },
      { icon: Clock,           label: 'Upload History',    path: '/erp/upload-history' },
      { icon: Store,           label: 'Stores',            path: '/erp/stores' },
      { icon: Users,           label: 'Staff',             path: '/erp/staff' },
    ],
    allowedRoles: ['manager', 'erp_admin', 'super_admin'],
    loginPath: '/erp-login',
    overviewPath: '/erp/overview',
    features: [
      { icon: Upload,          title: 'ERP Upload',        desc: 'Import and process store order data' },
      { icon: Settings,        title: 'Reorder Settings',  desc: 'Configure replenishment rules per product' },
      { icon: ClipboardList,   title: 'Track Tasks',       desc: 'Monitor pending and completed reorders' },
    ],
  },
  roleplay: {
    id: 'roleplay',
    name: 'The Playbook',
    subtitle: 'Training & Coaching Portal',
    tagline: 'Create training themes, review roleplays, and coach your team.',
    emoji: '📖',
    accentColor: '#E8642C',
    loginGradient: 'linear-gradient(145deg, #E8642C 0%, #BF4D1E 100%)',
    navItems: [
      { icon: LayoutDashboard, label: 'Overview',          path: '/roleplay/overview' },
      { icon: Video,           label: 'Roleplay Review',   path: '/roleplay/review' },
      { icon: BookOpen,        label: 'Theme Manager',     path: '/roleplay/themes' },
      { icon: Store,           label: 'Stores',            path: '/roleplay/stores' },
      { icon: Users,           label: 'Staff',             path: '/roleplay/staff' },
    ],
    allowedRoles: ['manager', 'training_admin', 'super_admin'],
    loginPath: '/roleplay-login',
    overviewPath: '/roleplay/overview',
    features: [
      { icon: Video,           title: 'Review Roleplays',  desc: 'AI-scored staff training submissions' },
      { icon: BookOpen,        title: 'Manage Themes',     desc: 'Create and activate training scenarios' },
      { icon: TrendingUp,      title: 'Track Progress',    desc: 'Monitor staff training performance' },
    ],
  },
}
