import * as XLSX from 'xlsx'
import { useRef, useState } from 'react'
import { useLocation, useOutletContext } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Users as UsersIcon, Search, Plus, Pencil, PowerOff,
  KeyRound, CheckCircle2,
  Upload, Download, Globe, Store as StoreIcon, AlertCircle, Eye, EyeOff,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from '@/components/ui/sheet'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose,
} from '@/components/ui/dialog'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import type { Staff } from '@/types'

// ── Types ─────────────────────────────────────────────────────────────────────

type RoleKey     = 'staff' | 'manager' | 'erp_admin' | 'training_admin' | 'super_admin'
type AccessLevel = 'single_store' | 'all_stores'

type StaffRow = {
  id: string
  store_id: string | null
  name: string
  phone: string | null
  email: string | null
  role: RoleKey
  access_level: AccessLevel
  account_type: string | null
  department: string | null
  is_active: boolean
  is_store_login: boolean
  created_at: string
  stores: { name: string; region: string } | null
}

type StoreMin   = { id: string; name: string; trainer_id: string | null }
type TrainerMin = { id: string; name: string }

type BulkStaffRow = {
  rowIndex: number
  name: string
  phone: string
  email: string
  password: string
  storeName: string
  storeId: string | null
  role: RoleKey
  accessLevel: AccessLevel
  department: string
  accountType: string
  errors: string[]
  importError?: string
}

// ── Constants ─────────────────────────────────────────────────────────────────

const ALL_STORES_ROLES: RoleKey[] = ['erp_admin', 'training_admin', 'super_admin']

const ROLE_TABS: Array<{ key: string; label: string }> = [
  { key: 'all',            label: 'All' },
  { key: 'store_staff',    label: 'Store Staff' },
  { key: 'corporate',      label: 'Corporate' },
  { key: 'manager',        label: 'Manager' },
  { key: 'erp_admin',      label: 'ERP Admin' },
  { key: 'training_admin', label: 'Training Admin' },
  { key: 'super_admin',    label: 'Super Admin' },
  { key: 'store_login',    label: 'Store Logins' },
]

const ROLE_LABELS: Record<RoleKey, string> = {
  staff: 'Staff', manager: 'Manager', erp_admin: 'ERP Admin', training_admin: 'Training Admin', super_admin: 'Super Admin',
}

const ROLE_BADGE: Record<RoleKey, string> = {
  staff:          'bg-gray-100 text-gray-600 border-gray-200',
  manager:        'bg-orange-50 text-orange-700 border-orange-200',
  erp_admin:      'bg-blue-50 text-blue-700 border-blue-200',
  training_admin: 'bg-orange-50 text-orange-700 border-orange-200',
  super_admin:    'bg-purple-50 text-purple-700 border-purple-200',
}

const VALID_ROLES = Object.keys(ROLE_LABELS) as RoleKey[]
const VALID_ACCESS: AccessLevel[] = ['single_store', 'all_stores']

const EMPTY_ADD_FORM = {
  name: '', phone: '', email: '', password: '',
  store_id: '', role: 'staff' as RoleKey, access_level: 'single_store' as AccessLevel,
  account_type: 'store', department: '',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function accessForRole(role: RoleKey): AccessLevel {
  return ALL_STORES_ROLES.includes(role) ? 'all_stores' : 'single_store'
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

async function parseFileToGrid(file: File): Promise<string[][]> {
  const buf  = await file.arrayBuffer()
  const wb   = XLSX.read(buf, { type: 'array', raw: false })
  const ws   = wb.Sheets[wb.SheetNames[0]]
  return XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, defval: '' }) as string[][]
}

function downloadStaffTemplate() {
  const ws = XLSX.utils.aoa_to_sheet([
    ['Name', 'Phone', 'Email', 'Password', 'Store', 'Role', 'Access Level', 'Department', 'Account Type'],
    ['Priya Sharma', '9876543210', 'priya@huft.in', 'password123', 'HUFT Saket',  'staff',     'single_store', 'Sales',      'store'],
    ['Rahul Gupta',  '9123456789', 'rahul@huft.in', 'password456', 'HUFT Bandra', 'manager',   'single_store', 'Operations', 'store'],
    ['Admin User',   '',           'admin@huft.in', 'password789', '',             'erp_admin', 'all_stores',   'Admin',      'corporate'],
  ])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Staff')
  XLSX.writeFile(wb, 'staff_template.xlsx')
}

function parseBulkStaffRow(
  row: string[],
  rowIndex: number,
  storesByName: Map<string, string>,
): BulkStaffRow {
  const name        = String(row[0] ?? '').trim()
  const phone       = String(row[1] ?? '').trim()
  const email       = String(row[2] ?? '').trim().toLowerCase()
  const password    = String(row[3] ?? '').trim()
  const storeName   = String(row[4] ?? '').trim()
  const roleRaw     = String(row[5] ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_')
  const accessRaw   = String(row[6] ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_')
  const department  = String(row[7] ?? '').trim()
  const accountType = String(row[8] ?? '').trim().toLowerCase() || 'store'
  const errors: string[] = []

  if (!name)                            errors.push('Name missing')
  if (!email)                           errors.push('Email missing')
  else if (!email.includes('@'))        errors.push('Email invalid')
  if (!password)                        errors.push('Password missing')
  else if (password.length < 8)         errors.push('Password too short (min 8)')

  let storeId: string | null = null
  if (storeName) {
    const match = storesByName.get(storeName.toLowerCase())
    if (match) storeId = match
    else errors.push(`Store "${storeName}" not found`)
  }

  let role: RoleKey = 'staff'
  if (roleRaw) {
    if (VALID_ROLES.includes(roleRaw as RoleKey)) role = roleRaw as RoleKey
    else errors.push(`Role "${roleRaw}" not valid`)
  }

  const derivedAccess = accessForRole(role)
  let accessLevel: AccessLevel = derivedAccess
  if (accessRaw && VALID_ACCESS.includes(accessRaw as AccessLevel)) {
    accessLevel = accessRaw as AccessLevel
  }

  if (accessLevel === 'single_store' && !storeId && !storeName) {
    errors.push('Store required for single_store access')
  }

  return { rowIndex, name, phone, email, password, storeName, storeId, role, accessLevel, department, accountType, errors }
}

// ── Queries ───────────────────────────────────────────────────────────────────

function useStaff() {
  return useQuery<StaffRow[]>({
    queryKey: ['staff_mgmt'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('staff')
        .select('*, stores!staff_store_id_fkey(name, region)')
        .order('created_at', { ascending: false })
      console.log('Staff data:', data, 'Error:', error)
      if (error) throw error
      return (data ?? []) as StaffRow[]
    },
    staleTime: 30_000,
  })
}

function useStores() {
  return useQuery<StoreMin[]>({
    queryKey: ['stores'],
    queryFn: async () => {
      const { data, error } = await supabase.from('stores').select('id, name, trainer_id').order('name')
      if (error) throw error
      return (data ?? []) as StoreMin[]
    },
    staleTime: 5 * 60_000,
  })
}

function useTrainers() {
  return useQuery<TrainerMin[]>({
    queryKey: ['trainers'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('staff').select('id, name').eq('role', 'training_admin').order('name')
      if (error) throw error
      return (data ?? []) as TrainerMin[]
    },
    staleTime: 5 * 60_000,
  })
}

// ── RoleBadge ─────────────────────────────────────────────────────────────────

function RoleBadge({ role, isStoreLogin }: { role: RoleKey; isStoreLogin?: boolean }) {
  if (isStoreLogin) {
    return (
      <Badge variant="outline" className="text-[10px] bg-gray-50 text-gray-500 border-gray-200">
        Store Account
      </Badge>
    )
  }
  return (
    <Badge variant="outline" className={cn('text-[10px]', ROLE_BADGE[role])}>
      {ROLE_LABELS[role]}
    </Badge>
  )
}

// ── AccessCell ────────────────────────────────────────────────────────────────

function AccessCell({ row }: { row: StaffRow }) {
  const isAll = row.access_level === 'all_stores' || ALL_STORES_ROLES.includes(row.role)
  return isAll
    ? <Badge variant="outline" className="text-[10px] bg-blue-50 text-blue-700 border-blue-200">All Stores</Badge>
    : <Badge variant="outline" className="text-[10px] bg-gray-50 text-gray-600 border-gray-200">Single Store</Badge>
}

// ── AccessLevelField ──────────────────────────────────────────────────────────

function AccessLevelField({ role, accessLevel, storeId, stores, onAccessLevelChange, onStoreChange, required }: {
  role: RoleKey; accessLevel: AccessLevel; storeId: string
  stores: StoreMin[]
  onAccessLevelChange: (v: AccessLevel) => void
  onStoreChange: (v: string) => void
  required?: boolean
}) {
  const isAutoAll = ALL_STORES_ROLES.includes(role)
  const showStore = !isAutoAll && accessLevel === 'single_store'

  return (
    <>
      <div className="space-y-1.5">
        <Label className="text-xs">Access Level</Label>
        {isAutoAll ? (
          <div className="flex items-center gap-2 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-700">
            <Globe className="h-3.5 w-3.5 shrink-0 text-blue-400" />
            Automatically set to All Stores for this role
          </div>
        ) : (
          <Select value={accessLevel} onValueChange={(v) => onAccessLevelChange(v as AccessLevel)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="single_store">Single Store</SelectItem>
              <SelectItem value="all_stores">All Stores</SelectItem>
            </SelectContent>
          </Select>
        )}
      </div>
      {showStore && (
        <div className="space-y-1.5">
          <Label className="text-xs">Store {required && <span className="text-red-500">*</span>}</Label>
          <Select value={storeId} onValueChange={onStoreChange}>
            <SelectTrigger><SelectValue placeholder="Select store" /></SelectTrigger>
            <SelectContent>
              {stores.map((st) => <SelectItem key={st.id} value={st.id}>{st.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      )}
    </>
  )
}

// ── StaffBulkDialog ───────────────────────────────────────────────────────────

function StaffBulkDialog({ accent, open, onOpenChange, stores, onImported }: {
  accent: string
  open: boolean
  onOpenChange: (v: boolean) => void
  stores: StoreMin[]
  onImported: () => void
}) {
  type Step = 'idle' | 'previewing' | 'importing' | 'done'
  const [step, setStep]                   = useState<Step>('idle')
  const [rows, setRows]                   = useState<BulkStaffRow[]>([])
  const [parseError, setParseError]       = useState<string | null>(null)
  const [progress, setProgress]           = useState(0)
  const [importedCount, setImportedCount] = useState(0)
  const [failedRows, setFailedRows]       = useState<Array<{ rowIndex: number; error: string }>>([])
  const fileRef                           = useRef<HTMLInputElement>(null)

  function reset() {
    setStep('idle'); setRows([]); setParseError(null)
    setProgress(0); setImportedCount(0); setFailedRows([])
  }

  function handleClose(v: boolean) { if (!v) reset(); onOpenChange(v) }

  async function handleFile(file: File) {
    setParseError(null)
    try {
      const grid     = await parseFileToGrid(file)
      const dataRows = grid.slice(1).filter((r) => r.some((c) => String(c).trim()))
      if (!dataRows.length) { setParseError('No data rows found.'); return }

      const storesByName = new Map(stores.map((s) => [s.name.toLowerCase(), s.id]))
      const parsed = dataRows.map((row, i) => parseBulkStaffRow(row, i + 2, storesByName))
      setRows(parsed)
      setStep('previewing')
    } catch (e) {
      setParseError(`Could not parse file: ${(e as Error).message}`)
    }
  }

  async function handleImport() {
    const valid = rows.filter((r) => r.errors.length === 0)
    if (!valid.length) return
    setProgress(0)
    setStep('importing')

    let imported = 0
    const failed: Array<{ rowIndex: number; error: string }> = []

    for (const row of valid) {
      const effectiveLevel = ALL_STORES_ROLES.includes(row.role) ? 'all_stores' : row.accessLevel
      try {
        const { error } = await supabase.from('staff').insert({
          name:         row.name,
          phone:        row.phone || null,
          email:        row.email,
          store_id:     effectiveLevel === 'single_store' ? row.storeId : null,
          role:         row.role,
          access_level: effectiveLevel,
          department:   row.department || null,
          account_type: row.accountType || 'store',
          is_active:    true,
          is_store_login: false,
        })
        if (error) throw error
        imported++
      } catch (e) {
        failed.push({ rowIndex: row.rowIndex, error: (e as Error).message })
      }
      setProgress((p) => p + 1)
    }

    setImportedCount(imported)
    setFailedRows(failed)
    setStep('done')
    if (imported > 0) {
      onImported()
      toast.success(`Imported ${imported} staff member${imported !== 1 ? 's' : ''}`)
    }
  }

  const validCount   = rows.filter((r) => r.errors.length === 0).length
  const invalidCount = rows.filter((r) => r.errors.length > 0).length

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="text-sm">Bulk Upload Staff</DialogTitle>
        </DialogHeader>

        {step === 'idle' && (
          <div className="space-y-4 py-1">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                Expected columns: <strong>Name</strong> | <strong>Phone</strong> | <strong>Email</strong> |{' '}
                <strong>Password</strong> | <strong>Store</strong> | <strong>Role</strong> | <strong>Access Level</strong> |{' '}
                <strong>Department</strong> | <strong>Account Type</strong>
              </p>
              <Button variant="outline" size="sm" onClick={downloadStaffTemplate} className="gap-1.5 text-xs">
                <Download className="h-3.5 w-3.5" /> Download Template
              </Button>
            </div>
            <div
              className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-gray-200 py-12 hover:border-gray-300"
              onClick={() => fileRef.current?.click()}
            >
              <Upload className="h-7 w-7 text-gray-300" />
              <p className="text-sm text-gray-500">
                Drop file here or <span className="font-medium" style={{ color: accent }}>browse</span>
              </p>
              <p className="text-xs text-muted-foreground">.xlsx or .csv accepted</p>
              <input ref={fileRef} type="file" accept=".xlsx,.csv" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = '' }} />
            </div>
            {parseError && (
              <p className="flex items-center gap-1.5 text-xs text-red-600">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" /> {parseError}
              </p>
            )}
          </div>
        )}

        {step === 'previewing' && (
          <div className="space-y-3 py-1">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                Found <strong>{rows.length}</strong> records
                {validCount > 0   && <span className="text-emerald-600"> · {validCount} valid</span>}
                {invalidCount > 0 && <span className="text-red-500"> · {invalidCount} with errors</span>}
              </p>
              <button onClick={reset}
                className="text-xs text-muted-foreground underline-offset-2 hover:underline">
                ← Change file
              </button>
            </div>
            <div className="max-h-64 overflow-auto rounded-lg border border-gray-100">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-gray-50">
                  <tr>
                    <th className="w-10 px-3 py-2 text-left font-medium text-gray-500">#</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-500">Name</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-500">Email</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-500">Store</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-500">Role</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-500">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {rows.slice(0, 50).map((row) => (
                    <tr key={row.rowIndex} className={cn(row.errors.length > 0 && 'bg-red-50/50')}>
                      <td className="px-3 py-1.5 text-muted-foreground">{row.rowIndex}</td>
                      <td className="px-3 py-1.5 text-gray-700">{row.name || <span className="text-red-400 italic">missing</span>}</td>
                      <td className="px-3 py-1.5 text-gray-700">{row.email || <span className="text-red-400 italic">missing</span>}</td>
                      <td className="px-3 py-1.5 text-gray-700">{row.storeName || <span className="text-muted-foreground">—</span>}</td>
                      <td className="px-3 py-1.5 text-gray-700">{row.role}</td>
                      <td className="px-3 py-1.5">
                        {row.errors.length > 0
                          ? <span className="text-red-600">{row.errors.join('; ')}</span>
                          : <span className="text-emerald-600 font-medium">✓</span>}
                      </td>
                    </tr>
                  ))}
                  {rows.length > 50 && (
                    <tr>
                      <td colSpan={6} className="px-3 py-2 text-center text-muted-foreground">
                        … and {rows.length - 50} more rows
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <DialogFooter>
              <Button variant="outline" size="sm" onClick={reset}>Cancel</Button>
              <Button size="sm" disabled={validCount === 0} onClick={handleImport}
                className="text-white hover:opacity-90" style={{ backgroundColor: accent }}>
                Import {validCount} member{validCount !== 1 ? 's' : ''}
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === 'importing' && (
          <div className="space-y-4 py-6">
            <p className="text-center text-sm text-gray-600">
              Creating accounts… {progress} / {validCount}
            </p>
            <Progress
              value={validCount > 0 ? Math.round((progress / validCount) * 100) : 0}
              className="mx-auto max-w-xs"
            />
            <p className="text-center text-xs text-muted-foreground">
              Each account is created individually — please don&apos;t close this window.
            </p>
          </div>
        )}

        {step === 'done' && (
          <div className="space-y-4 py-1">
            <div className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-3 text-xs text-emerald-700">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
              Imported {importedCount} of {validCount} member{validCount !== 1 ? 's' : ''}.
              {failedRows.length > 0 && ` ${failedRows.length} failed.`}
            </div>
            {failedRows.length > 0 && (
              <div className="max-h-32 overflow-auto rounded-lg border border-red-100 bg-red-50 p-3 space-y-1">
                {failedRows.map((f) => (
                  <p key={f.rowIndex} className="text-xs text-red-700">
                    Row {f.rowIndex}: {f.error}
                  </p>
                ))}
              </div>
            )}
            <DialogFooter>
              <Button size="sm" onClick={() => handleClose(false)}
                className="text-white hover:opacity-90" style={{ backgroundColor: accent }}>
                Done
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function StaffPage() {
  const { pathname } = useLocation()
  const queryClient  = useQueryClient()
  const accent = pathname.startsWith('/erp') ? '#E8642C' : '#E8642C'
  const { user: currentUser } = useOutletContext<{ user: Staff | null }>()
  const currentRole = currentUser?.role ?? 'staff'
  const isSuperAdmin = currentRole === 'super_admin'

  const { data: allStaff = [], isLoading } = useStaff()
  const { data: stores = [] }              = useStores()
  const { data: trainers = [] }            = useTrainers()

  // Role-scoped visibility: erp_admin sees erp_admin, training_admin sees training_admin, super_admin sees all
  const staff = allStaff.filter((s) => {
    if (isSuperAdmin) return true
    if (currentRole === 'erp_admin') return s.role === 'erp_admin' || s.is_store_login
    if (currentRole === 'training_admin') return s.role === 'training_admin'
    return true
  })

  // ── Filters ───────────────────────────────────────────────────────────────
  const [search, setSearch]             = useState('')
  const [storeFilter, setStoreFilter]   = useState('all')
  const [trainerFilter, setTrainerFilter] = useState('all')
  const [roleTab, setRoleTab]           = useState('all')

  // ── Add Staff dialog ──────────────────────────────────────────────────────
  const [addOpen, setAddOpen]   = useState(false)
  const [addForm, setAddForm]   = useState(EMPTY_ADD_FORM)
  const [showAddPw, setShowAddPw] = useState(false)
  const [adding, setAdding]     = useState(false)

  // ── Bulk upload ───────────────────────────────────────────────────────────
  const [bulkOpen, setBulkOpen] = useState(false)

  // ── Store Login dialog ────────────────────────────────────────────────────
  const [storeLoginOpen, setStoreLoginOpen]       = useState(false)
  const [storeLoginForm, setStoreLoginForm]       = useState({ name: '', email: '', password: '', store_id: '' })
  const [showStoreLoginPw, setShowStoreLoginPw]   = useState(false)
  const [addingStoreLogin, setAddingStoreLogin]   = useState(false)

  // ── Edit sheet ────────────────────────────────────────────────────────────
  const [editOpen, setEditOpen]             = useState(false)
  const [editStaff, setEditStaff]           = useState<StaffRow | null>(null)
  const [editName, setEditName]             = useState('')
  const [editPhone, setEditPhone]           = useState('')
  const [editEmail, setEditEmail]           = useState('')
  const [editRole, setEditRole]             = useState<RoleKey>('staff')
  const [editAccessLevel, setEditAccessLevel] = useState<AccessLevel>('single_store')
  const [editStoreId, setEditStoreId]       = useState('')
  const [editSaving, setEditSaving]         = useState(false)

  // ── Deactivate dialog ─────────────────────────────────────────────────────
  const [deactivateTarget, setDeactivateTarget] = useState<StaffRow | null>(null)
  const [deactivating, setDeactivating]         = useState(false)

  // ── Reset password ────────────────────────────────────────────────────────
  const [resettingId, setResettingId] = useState<string | null>(null)

  // ── Derived ───────────────────────────────────────────────────────────────
  const trainerStoreIds = trainerFilter === 'all'
    ? null
    : new Set(stores.filter((st) => st.trainer_id === trainerFilter).map((st) => st.id))

  const filtered = staff.filter((s) => {
    const q = search.trim().toLowerCase()
    const matchSearch  = !q || s.name.toLowerCase().includes(q)
    const matchStore   = storeFilter === 'all' || s.store_id === storeFilter
    const matchTrainer = !trainerStoreIds || (s.store_id != null && trainerStoreIds.has(s.store_id))
    let matchRole: boolean
    if (roleTab === 'all')             matchRole = true
    else if (roleTab === 'store_login') matchRole = s.is_store_login
    else if (roleTab === 'store_staff') matchRole = s.role === 'staff' && !s.is_store_login && s.account_type !== 'corporate'
    else if (roleTab === 'corporate')  matchRole = s.account_type === 'corporate'
    else                               matchRole = s.role === roleTab && !s.is_store_login
    return matchSearch && matchStore && matchTrainer && matchRole
  })

  const canSubmitAdd =
    !!addForm.name.trim() && !!addForm.email.trim() && addForm.password.length >= 8 &&
    (addForm.access_level === 'all_stores' || ALL_STORES_ROLES.includes(addForm.role) || !!addForm.store_id)

  const canSubmitEdit =
    !editSaving && !!editName.trim() &&
    (editAccessLevel === 'all_stores' || ALL_STORES_ROLES.includes(editRole) || !!editStoreId)

  // ── Helpers ───────────────────────────────────────────────────────────────
  function invalidateStaff() {
    queryClient.invalidateQueries({ queryKey: ['staff_mgmt'] })
    queryClient.invalidateQueries({ queryKey: ['staff_all_mgmt'] })
  }

  function setAddField<K extends keyof typeof EMPTY_ADD_FORM>(k: K, v: string) {
    setAddForm((f) => ({ ...f, [k]: v }))
  }

  function handleAddRoleChange(role: RoleKey) {
    const level = accessForRole(role)
    setAddForm((f) => ({ ...f, role, access_level: level, store_id: level === 'all_stores' ? '' : f.store_id }))
  }

  function handleAddAccessChange(level: AccessLevel) {
    setAddForm((f) => ({ ...f, access_level: level, store_id: level === 'all_stores' ? '' : f.store_id }))
  }

  function handleEditRoleChange(role: RoleKey) {
    const level = accessForRole(role)
    setEditRole(role); setEditAccessLevel(level)
    if (level === 'all_stores') setEditStoreId('')
  }

  function handleEditAccessChange(level: AccessLevel) {
    setEditAccessLevel(level)
    if (level === 'all_stores') setEditStoreId('')
  }

  function closeAddDialog() {
    setAddOpen(false); setAddForm(EMPTY_ADD_FORM); setShowAddPw(false)
  }

  function closeStoreLoginDialog() {
    setStoreLoginOpen(false)
    setStoreLoginForm({ name: '', email: '', password: '', store_id: '' })
    setShowStoreLoginPw(false)
  }

  async function handleStoreLoginSubmit(e: React.FormEvent) {
    e.preventDefault()
    const { name, email, password, store_id } = storeLoginForm
    if (!name.trim() || !email.trim() || password.length < 8 || !store_id) return
    setAddingStoreLogin(true)
    try {
      const body = {
        name:           name.trim(),
        email:          email.trim().toLowerCase(),
        password,
        store_id,
        role:           'staff',
        access_level:   'single_store',
        is_store_login: true,
      }
      const { data, error } = await supabase.functions.invoke('create-staff-user', { body })
      if (error) {
        console.error('create-staff-user invoke error:', error)
        throw error
      }
      if (data?.error) {
        console.error('create-staff-user response error:', data.error)
        throw new Error(String(data.error))
      }
      invalidateStaff()
      closeStoreLoginDialog()
      toast.success('Store login account created')
    } catch (e) {
      console.error('handleStoreLoginSubmit failed:', e)
      toast.error(`Failed to create store login: ${(e as Error).message}`)
    } finally {
      setAddingStoreLogin(false)
    }
  }

  function openEdit(s: StaffRow) {
    setEditStaff(s)
    setEditName(s.name)
    setEditPhone(s.phone ?? '')
    setEditEmail(s.email ?? '')
    setEditRole(s.role)
    setEditAccessLevel(s.access_level ?? accessForRole(s.role))
    setEditStoreId(s.store_id ?? '')
    setEditOpen(true)
  }

  // ── Mutations ─────────────────────────────────────────────────────────────
  async function handleAddStaff(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmitAdd) return
    setAdding(true)
    const effectiveLevel = ALL_STORES_ROLES.includes(addForm.role) ? 'all_stores' : addForm.access_level
    try {
      const body: Record<string, unknown> = {
        name:           addForm.name.trim(),
        phone:          addForm.phone.trim() || null,
        email:          addForm.email.trim().toLowerCase(),
        password:       addForm.password,
        role:           addForm.role,
        access_level:   effectiveLevel,
        account_type:   addForm.account_type || null,
        department:     addForm.department.trim() || null,
        is_store_login: false,
      }
      if (effectiveLevel === 'single_store') {
        body.store_id = addForm.store_id || null
      }
      const { data, error } = await supabase.functions.invoke('create-staff-user', { body })
      if (error) throw error
      if (data?.error) throw new Error(String(data.error))
      invalidateStaff()
      closeAddDialog()
      toast.success('Staff member added')
    } catch (e) {
      toast.error(`Failed to add staff: ${(e as Error).message}`)
    } finally { setAdding(false) }
  }

  async function handleEditSave() {
    if (!editStaff) return
    setEditSaving(true)
    const effectiveLevel = ALL_STORES_ROLES.includes(editRole) ? 'all_stores' : editAccessLevel
    try {
      const { error } = await supabase.from('staff')
        .update({
          name:         editName.trim(),
          phone:        editPhone.trim() || null,
          email:        editEmail.trim().toLowerCase() || null,
          role:         editRole,
          access_level: effectiveLevel,
          store_id:     effectiveLevel === 'single_store' ? editStoreId : null,
        })
        .eq('id', editStaff.id)
      if (error) throw error
      invalidateStaff(); setEditOpen(false)
      toast.success('Staff member updated')
    } catch (e) {
      toast.error(`Failed to update: ${(e as Error).message}`)
    } finally { setEditSaving(false) }
  }

  async function handleResetPassword(s: StaffRow) {
    if (!s.email) { toast.error('No email on record for this staff member'); return }
    setResettingId(s.id)
    try {
      const { error: fnErr } = await supabase.functions.invoke('reset-staff-password', { body: { user_id: s.id } })
      if (fnErr) {
        const { error: authErr } = await supabase.auth.resetPasswordForEmail(s.email)
        if (authErr) throw authErr
      }
      toast.success(`Password reset email sent to ${s.email}`)
    } catch (e) {
      toast.error(`Reset failed: ${(e as Error).message}`)
    } finally { setResettingId(null) }
  }

  async function handleDeactivate() {
    if (!deactivateTarget) return
    setDeactivating(true)
    try {
      const { error } = await supabase.from('staff').update({ is_active: false }).eq('id', deactivateTarget.id)
      if (error) throw error
      invalidateStaff(); setDeactivateTarget(null)
      toast.success(`${deactivateTarget.name} has been deactivated`)
    } catch (e) {
      toast.error(`Failed to deactivate: ${(e as Error).message}`)
    } finally { setDeactivating(false) }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-lg font-bold text-gray-900">Staff</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Manage staff accounts, roles, and store assignments
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setBulkOpen(true)} className="gap-1.5">
            <Upload className="h-4 w-4" /> Bulk Upload
          </Button>
          <Button variant="outline" onClick={() => setStoreLoginOpen(true)} className="gap-1.5">
            <StoreIcon className="h-4 w-4" /> Add Store Login
          </Button>
          <Button onClick={() => setAddOpen(true)}
            className="gap-1.5 text-white hover:opacity-90" style={{ backgroundColor: accent }}>
            <Plus className="h-4 w-4" /> Add Staff Member
          </Button>
        </div>
      </div>

      {/* Role tabs */}
      <div className="inline-flex flex-wrap rounded-full bg-gray-100 p-0.5">
        {ROLE_TABS.map(({ key, label }) => (
          <button key={key} onClick={() => setRoleTab(key)}
            className={cn(
              'rounded-full px-4 py-1.5 text-xs font-semibold transition-all',
              roleTab === key ? 'text-white shadow-sm' : 'text-gray-500 hover:text-gray-700',
            )}
            style={roleTab === key ? { backgroundColor: accent } : undefined}>
            {label}
          </button>
        ))}
      </div>

      {/* Search + store + trainer filters */}
      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name…" className="pl-8" />
        </div>
        <Select value={storeFilter} onValueChange={setStoreFilter}>
          <SelectTrigger className="w-48"><SelectValue placeholder="All Stores" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Stores</SelectItem>
            {stores.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
          </SelectContent>
        </Select>
        {trainers.length > 0 && (
          <Select value={trainerFilter} onValueChange={setTrainerFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="All Trainers" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Trainers</SelectItem>
              {trainers.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Table */}
      <Card>
        <CardContent className="px-0 pb-1">
          {isLoading ? (
            <p className="py-12 text-center text-sm text-muted-foreground">Loading…</p>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16">
              <UsersIcon className="h-8 w-8 text-gray-300" />
              <p className="text-sm text-gray-500">
                {staff.length === 0 ? 'No staff members yet.' : 'No staff match your filters.'}
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-5">Name</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Store</TableHead>
                  <TableHead>Access</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="pr-5 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="pl-5">
                      <div className="flex items-center gap-1.5">
                        {s.is_store_login && (
                          <StoreIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        )}
                        <div>
                          <p className="font-medium text-gray-900">{s.name}</p>
                          {s.email && <p className="text-[11px] text-muted-foreground">{s.email}</p>}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{s.phone ?? '–'}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{s.stores?.name ?? '–'}</TableCell>
                    <TableCell><AccessCell row={s} /></TableCell>
                    <TableCell><RoleBadge role={s.role} isStoreLogin={s.is_store_login} /></TableCell>
                    <TableCell className="text-xs text-muted-foreground">{fmtDate(s.created_at)}</TableCell>
                    <TableCell className="pr-5 text-right">
                      <div className="flex items-center justify-end gap-0.5">
                        <Button variant="ghost" size="icon-sm" title="Edit role / store"
                          onClick={() => openEdit(s)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon-sm" title="Send password reset email"
                          disabled={resettingId === s.id} onClick={() => handleResetPassword(s)}>
                          <KeyRound className={cn('h-3.5 w-3.5', resettingId === s.id && 'animate-pulse')} />
                        </Button>
                        <Button variant="ghost" size="icon-sm" title="Deactivate"
                          className="text-red-400 hover:bg-red-50 hover:text-red-600"
                          onClick={() => setDeactivateTarget(s)}>
                          <PowerOff className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* ── Bulk Upload Dialog ──────────────────────────────────────────── */}
      <StaffBulkDialog
        accent={accent}
        open={bulkOpen}
        onOpenChange={setBulkOpen}
        stores={stores}
        onImported={invalidateStaff}
      />

      {/* ── Store Login Dialog ─────────────────────────────────────────── */}
      <Dialog open={storeLoginOpen} onOpenChange={(open) => { if (!open) closeStoreLoginDialog() }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm">Create Store Login</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleStoreLoginSubmit} className="space-y-4 py-1">
            <div className="space-y-1.5">
              <Label className="text-xs">Store <span className="text-red-500">*</span></Label>
              <Select value={storeLoginForm.store_id} onValueChange={(v) => setStoreLoginForm((f) => ({ ...f, store_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Select store" /></SelectTrigger>
                <SelectContent>
                  {stores.map((st) => <SelectItem key={st.id} value={st.id}>{st.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Name <span className="text-red-500">*</span></Label>
              <Input
                value={storeLoginForm.name}
                onChange={(e) => setStoreLoginForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. HUFT Saket Store"
                required
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Email <span className="text-red-500">*</span></Label>
              <Input
                value={storeLoginForm.email}
                onChange={(e) => setStoreLoginForm((f) => ({ ...f, email: e.target.value }))}
                placeholder="store.saket@headsupfortails.com"
                type="email"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Password <span className="text-red-500">*</span></Label>
              <div className="relative">
                <Input
                  value={storeLoginForm.password}
                  onChange={(e) => setStoreLoginForm((f) => ({ ...f, password: e.target.value }))}
                  type={showStoreLoginPw ? 'text' : 'password'}
                  placeholder="Min 8 characters"
                  required
                  className="pr-9"
                />
                <button type="button" tabIndex={-1} onClick={() => setShowStoreLoginPw((v) => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-gray-700">
                  {showStoreLoginPw ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              </div>
              {storeLoginForm.password.length > 0 && storeLoginForm.password.length < 8 && (
                <p className="text-[11px] text-red-500">Must be at least 8 characters</p>
              )}
            </div>
            <DialogFooter className="pt-2">
              <DialogClose asChild>
                <Button type="button" variant="outline" size="sm">Cancel</Button>
              </DialogClose>
              <Button
                type="submit"
                size="sm"
                disabled={
                  addingStoreLogin ||
                  !storeLoginForm.name.trim() ||
                  !storeLoginForm.email.trim() ||
                  storeLoginForm.password.length < 8 ||
                  !storeLoginForm.store_id
                }
                className="text-white hover:opacity-90"
                style={{ backgroundColor: accent }}
              >
                {addingStoreLogin ? 'Creating…' : 'Create Store Login'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Add Staff Dialog ────────────────────────────────────────────── */}
      <Dialog open={addOpen} onOpenChange={(open) => { if (!open) closeAddDialog() }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm">Add Staff Member</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleAddStaff} className="space-y-4 py-1">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Name <span className="text-red-500">*</span></Label>
                <Input value={addForm.name} onChange={(e) => setAddField('name', e.target.value)}
                  placeholder="Priya Sharma" required autoFocus />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Phone</Label>
                <Input value={addForm.phone} onChange={(e) => setAddField('phone', e.target.value)}
                  placeholder="9876543210" type="tel" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Email <span className="text-red-500">*</span></Label>
              <Input value={addForm.email} onChange={(e) => setAddField('email', e.target.value)}
                placeholder="priya@huft.in" type="email" required />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Password <span className="text-red-500">*</span></Label>
              <div className="relative">
                <Input
                  value={addForm.password}
                  onChange={(e) => setAddField('password', e.target.value)}
                  type={showAddPw ? 'text' : 'password'}
                  placeholder="Min 8 characters"
                  required
                  className="pr-9"
                />
                <button type="button" tabIndex={-1} onClick={() => setShowAddPw((v) => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-gray-700">
                  {showAddPw ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              </div>
              {addForm.password.length > 0 && addForm.password.length < 8 && (
                <p className="text-[11px] text-red-500">Must be at least 8 characters</p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Account Type</Label>
                <Select value={addForm.account_type} onValueChange={(v) => setAddField('account_type', v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="store">Store</SelectItem>
                    <SelectItem value="corporate">Corporate</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Department</Label>
                <Input value={addForm.department} onChange={(e) => setAddField('department', e.target.value)}
                  placeholder="e.g. Operations" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Role <span className="text-red-500">*</span></Label>
              <Select value={addForm.role} onValueChange={(v) => handleAddRoleChange(v as RoleKey)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.entries(ROLE_LABELS) as [RoleKey, string][])
                    .filter(([k]) => k !== 'super_admin' || isSuperAdmin)
                    .map(([k, label]) => (
                      <SelectItem key={k} value={k}>{label}</SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <AccessLevelField
              role={addForm.role} accessLevel={addForm.access_level} storeId={addForm.store_id}
              stores={stores} onAccessLevelChange={handleAddAccessChange}
              onStoreChange={(v) => setAddField('store_id', v)} required />
            <DialogFooter className="pt-2">
              <DialogClose asChild>
                <Button type="button" variant="outline" size="sm">Cancel</Button>
              </DialogClose>
              <Button type="submit" size="sm" disabled={adding || !canSubmitAdd}
                className="text-white hover:opacity-90" style={{ backgroundColor: accent }}>
                {adding ? 'Adding…' : 'Add Staff Member'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Edit Sheet ─────────────────────────────────────────────────── */}
      <Sheet open={editOpen} onOpenChange={(open) => { if (!open) setEditOpen(false) }}>
        <SheetContent side="right">
          <SheetHeader>
            <SheetTitle>Edit Staff Member</SheetTitle>
            {editStaff && <SheetDescription>{editStaff.name}</SheetDescription>}
          </SheetHeader>
          <div className="flex flex-col gap-5 px-4 pb-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Name <span className="text-red-500">*</span></Label>
                <Input value={editName} onChange={(e) => setEditName(e.target.value)}
                  placeholder="Priya Sharma" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Phone</Label>
                <Input value={editPhone} onChange={(e) => setEditPhone(e.target.value)}
                  placeholder="9876543210" type="tel" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Email</Label>
              <Input value={editEmail} onChange={(e) => setEditEmail(e.target.value)}
                placeholder="priya@huft.in" type="email" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Role</Label>
              <Select value={editRole} onValueChange={(v) => handleEditRoleChange(v as RoleKey)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.entries(ROLE_LABELS) as [RoleKey, string][])
                    .filter(([k]) => k !== 'super_admin' || isSuperAdmin)
                    .map(([k, label]) => (
                      <SelectItem key={k} value={k}>{label}</SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            {isSuperAdmin && editStaff?.role !== 'super_admin' && (
              <div className="rounded-lg border border-purple-100 bg-purple-50 px-3 py-2.5">
                <p className="mb-2 text-[11px] text-purple-700 font-medium">Super Admin Promotion</p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="w-full border-purple-200 text-purple-700 hover:bg-purple-100 text-xs"
                  onClick={() => handleEditRoleChange('super_admin')}
                >
                  Make Super Admin
                </Button>
              </div>
            )}
            <AccessLevelField
              role={editRole} accessLevel={editAccessLevel} storeId={editStoreId}
              stores={stores} onAccessLevelChange={handleEditAccessChange}
              onStoreChange={setEditStoreId} />
            <div className="flex gap-2 pt-1">
              <Button onClick={handleEditSave} disabled={!canSubmitEdit}
                className="flex-1 text-white hover:opacity-90" style={{ backgroundColor: accent }}>
                {editSaving ? 'Saving…' : 'Save Changes'}
              </Button>
              <Button variant="outline" onClick={() => setEditOpen(false)} disabled={editSaving}>
                Cancel
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* ── Deactivate Dialog ──────────────────────────────────────────── */}
      <Dialog open={deactivateTarget !== null}
        onOpenChange={(open) => { if (!open) setDeactivateTarget(null) }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm">Deactivate {deactivateTarget?.name}?</DialogTitle>
          </DialogHeader>
          <p className="py-1 text-xs text-muted-foreground">
            This staff member will be hidden from all views and won&apos;t be able to log in.
            Reversible directly in the database.
          </p>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" size="sm">Cancel</Button>
            </DialogClose>
            <Button size="sm" disabled={deactivating} onClick={handleDeactivate}
              className="bg-red-600 hover:bg-red-700 text-white">
              {deactivating ? 'Deactivating…' : 'Deactivate'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  )
}
