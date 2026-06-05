import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from '@/components/ui/sonner'
import AppShell from './components/layout/AppShell'
import { PORTALS } from './lib/portals'

// ERP portal
import ERPLoginPage          from './pages/erp/LoginPage'
import ERPOverviewPage       from './pages/erp/ERPOverviewPage'
import ERPUploadPage         from './pages/erp/UploadPage'
import ERPReorderSettings    from './pages/erp/ReorderSettingsPage'
import ERPUploadHistory      from './pages/erp/UploadHistoryPage'
import ERPStoresPage         from './pages/erp/StoresPage'
import ERPStaffPage          from './pages/erp/StaffPage'

// Roleplay portal
import RoleplayLoginPage     from './pages/roleplay/LoginPage'
import RoleplayOverviewPage  from './pages/roleplay/RoleplayOverviewPage'
import RoleplayReviewPage    from './pages/roleplay/ReviewPage'
import RoleplayThemesPage    from './pages/roleplay/ThemesPage'
import RoleplayStoresPage    from './pages/roleplay/StoresPage'
import RoleplayStaffPage     from './pages/roleplay/StaffPage'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Root → ERP login */}
        <Route path="/" element={<Navigate to="/erp-login" replace />} />

        {/* ── ERP Portal ─────────────────────────────────────────────────── */}
        <Route path="/erp-login" element={<ERPLoginPage />} />

        <Route element={<AppShell portal={PORTALS.erp} />}>
          <Route path="/erp"                  element={<Navigate to="/erp/overview" replace />} />
          <Route path="/erp/overview"         element={<ERPOverviewPage />} />
          <Route path="/erp/upload"           element={<ERPUploadPage />} />
          <Route path="/erp/reorder-settings" element={<ERPReorderSettings />} />
          <Route path="/erp/upload-history"   element={<ERPUploadHistory />} />
          <Route path="/erp/stores"           element={<ERPStoresPage />} />
          <Route path="/erp/staff"            element={<ERPStaffPage />} />
        </Route>

        {/* ── Roleplay Portal ─────────────────────────────────────────────── */}
        <Route path="/roleplay-login" element={<RoleplayLoginPage />} />

        <Route element={<AppShell portal={PORTALS.roleplay} />}>
          <Route path="/roleplay"             element={<Navigate to="/roleplay/overview" replace />} />
          <Route path="/roleplay/overview"    element={<RoleplayOverviewPage />} />
          <Route path="/roleplay/review"      element={<RoleplayReviewPage />} />
          <Route path="/roleplay/themes"      element={<RoleplayThemesPage />} />
          <Route path="/roleplay/stores"      element={<RoleplayStoresPage />} />
          <Route path="/roleplay/staff"       element={<RoleplayStaffPage />} />
        </Route>

        {/* Catch-all */}
        <Route path="*" element={<Navigate to="/erp-login" replace />} />
      </Routes>
      <Toaster richColors position="top-right" />
    </BrowserRouter>
  )
}
