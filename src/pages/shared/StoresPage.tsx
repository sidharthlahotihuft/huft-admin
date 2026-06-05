import * as XLSX from 'xlsx'
import { Fragment, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Store as StoreIcon, Search, Plus, Pencil, Trash2, ExternalLink,
  ChevronDown, ChevronUp, ClipboardList, Users as UsersIcon,
  AlertTriangle, Upload, Download, CheckCircle2, Eye, EyeOff, Copy,
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
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from '@/components/ui/sheet'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose,
} from '@/components/ui/dialog'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

// ── Types ─────────────────────────────────────────────────────────────────────

type StoreRow = {
  id: string; name: string; region: string; created_at: string
  trainer_id: string | null; trainer_name: string | null
}
type StaffRow    = { id: string; store_id: string; name: string; role: string; phone: string | null }
type TaskRow     = { id: string; store_id: string; status: string; due_date: string | null }
type TrainerMin  = { id: string; name: string; email?: string | null }

type BulkStoreRow = {
  rowIndex: number
  name: string
  region: string
  trainerEmail: string
  trainerId: string | null
  errors: string[]
}

// ── Constants ─────────────────────────────────────────────────────────────────

const REGIONS = ['Delhi', 'Bengaluru', 'Mumbai', 'Hyderabad', 'Chennai', 'Pune', 'Kolkata']

const ROLE_LABELS: Record<string, string> = {
  staff: 'Staff', manager: 'Manager', erp_admin: 'ERP Admin', training_admin: 'Training Admin',
}

// ── Queries ───────────────────────────────────────────────────────────────────

function useStores() {
  return useQuery<StoreRow[]>({
    queryKey: ['stores_mgmt'],
    queryFn: async () => {
      const { data, error } = await supabase.from('stores').select('*').order('name')
      if (error) throw error
      return (data ?? []) as StoreRow[]
    },
    staleTime: 30_000,
  })
}

function useTrainers() {
  return useQuery<TrainerMin[]>({
    queryKey: ['trainers'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('staff')
        .select('id, name, email')
        .or('role.eq.training_admin,department.eq.Training')
        .order('name')
      if (error) throw error
      return (data ?? []) as TrainerMin[]
    },
    staleTime: 5 * 60_000,
  })
}

function useAllStaff() {
  return useQuery<StaffRow[]>({
    queryKey: ['staff_all_mgmt'],
    queryFn: async () => {
      const { data, error } = await supabase.from('staff').select('id, store_id, name, role, phone')
      if (error) throw error
      return (data ?? []) as StaffRow[]
    },
    staleTime: 30_000,
  })
}

function useAllTasks() {
  return useQuery<TaskRow[]>({
    queryKey: ['tasks_mgmt'],
    queryFn: async () => {
      const { data, error } = await supabase.from('tasks').select('id, store_id, status, due_date')
      if (error) throw error
      return (data ?? []) as TaskRow[]
    },
    staleTime: 30_000,
  })
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function todayStr() { return new Date().toISOString().split('T')[0] }

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

async function parseFileToGrid(file: File): Promise<string[][]> {
  const buf  = await file.arrayBuffer()
  const wb   = XLSX.read(buf, { type: 'array', raw: false })
  const ws   = wb.Sheets[wb.SheetNames[0]]
  return XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, defval: '' }) as string[][]
}

function downloadStoresTemplate() {
  const ws = XLSX.utils.aoa_to_sheet([
    ['Store Name', 'Region', 'Trainer Email'],
    ['HUFT Saket',  'Delhi',  'trainer1@huft.in'],
    ['HUFT Bandra', 'Mumbai', ''],
  ])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Stores')
  XLSX.writeFile(wb, 'stores_template.xlsx')
}

// ── CredRow ───────────────────────────────────────────────────────────────────

function CredRow({ label, value, secret }: { label: string; value: string; secret?: boolean }) {
  const [revealed, setRevealed] = useState(false)
  const [copied, setCopied]     = useState(false)

  async function copy() {
    await navigator.clipboard.writeText(value)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="flex items-center gap-2">
      <span className="w-16 shrink-0 text-xs font-medium text-gray-400">{label}</span>
      <span className="flex-1 truncate font-mono text-xs text-gray-800">
        {secret && !revealed ? '••••••••' : value}
      </span>
      <div className="flex shrink-0 items-center gap-1">
        {secret && (
          <button type="button" onClick={() => setRevealed((v) => !v)}
            className="text-muted-foreground hover:text-gray-700">
            {revealed ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
          </button>
        )}
        <button type="button" onClick={copy}
          className="text-muted-foreground hover:text-gray-700">
          {copied ? <CheckCircle2 className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
        </button>
      </div>
    </div>
  )
}

// ── StatCard ──────────────────────────────────────────────────────────────────

function StatCard({ icon: Icon, label, value, accent }: {
  icon: React.ComponentType<{ className?: string }>
  label: string; value: number; accent: string
}) {
  return (
    <Card>
      <CardContent className="pb-4 pt-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">{label}</p>
            <p className="mt-1.5 text-2xl font-bold text-gray-900">{value.toLocaleString('en-IN')}</p>
          </div>
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
            style={{ backgroundColor: accent }}>
            <Icon className="h-4 w-4 text-white" />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// ── StoreForm ─────────────────────────────────────────────────────────────────

function StoreForm({ accent, initial, trainers, onSave, onClose, saving }: {
  accent: string
  initial?: { name: string; region: string; trainerId?: string | null }
  trainers?: TrainerMin[]
  onSave: (name: string, region: string, trainerId: string | null) => Promise<void>
  onClose: () => void
  saving: boolean
}) {
  const [name, setName]         = useState(initial?.name ?? '')
  const [region, setRegion]     = useState(initial?.region ?? '')
  const [trainerId, setTrainerId] = useState<string>(initial?.trainerId || 'none')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || !region.trim()) return
    await onSave(name.trim(), region.trim(), trainerId === 'none' ? null : trainerId)
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5 px-4 pb-4">
      <div className="space-y-1.5">
        <Label className="text-xs">Store Name <span className="text-red-500">*</span></Label>
        <Input value={name} onChange={(e) => setName(e.target.value)}
          placeholder="e.g. HUFT Indiranagar" required autoFocus />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Region <span className="text-red-500">*</span></Label>
        <Input value={region} onChange={(e) => setRegion(e.target.value)}
          list="region-suggestions" placeholder="e.g. Bengaluru" required />
        <datalist id="region-suggestions">
          {REGIONS.map((r) => <option key={r} value={r} />)}
        </datalist>
        <p className="text-[11px] text-muted-foreground">Suggestions: {REGIONS.join(' · ')}</p>
      </div>
      {trainers && (
        <div className="space-y-1.5">
          <Label className="text-xs">Assigned Trainer</Label>
          <Select value={trainerId} onValueChange={setTrainerId}>
            <SelectTrigger>
              <SelectValue placeholder="Unassigned" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Unassigned</SelectItem>
              {trainers.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      )}
      <div className="flex gap-2 pt-1">
        <Button type="submit" disabled={saving || !name.trim() || !region.trim()}
          className="flex-1 text-white hover:opacity-90" style={{ backgroundColor: accent }}>
          {saving ? 'Saving…' : initial ? 'Save Changes' : 'Add Store'}
        </Button>
        <Button type="button" variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
      </div>
    </form>
  )
}

// ── StoreBulkDialog ───────────────────────────────────────────────────────────

function StoreBulkDialog({ accent, open, onOpenChange, onImported, trainers }: {
  accent: string
  open: boolean
  onOpenChange: (v: boolean) => void
  onImported: () => void
  trainers: TrainerMin[]
}) {
  type Step = 'idle' | 'previewing' | 'importing' | 'done'
  const [step, setStep]               = useState<Step>('idle')
  const [rows, setRows]               = useState<BulkStoreRow[]>([])
  const [parseError, setParseError]   = useState<string | null>(null)
  const [progress, setProgress]       = useState(0)
  const [importedCount, setImportedCount] = useState(0)
  const fileRef                       = useRef<HTMLInputElement>(null)

  function reset() {
    setStep('idle'); setRows([]); setParseError(null)
    setProgress(0); setImportedCount(0)
  }

  function handleClose(v: boolean) { if (!v) reset(); onOpenChange(v) }

  async function handleFile(file: File) {
    setParseError(null)
    try {
      const grid     = await parseFileToGrid(file)
      const dataRows = grid.slice(1).filter((r) => r.some((c) => String(c).trim()))
      if (!dataRows.length) { setParseError('No data rows found.'); return }

      const trainersByEmail = new Map(trainers.map((t) => [t.name.toLowerCase(), t.id]))
      // also build email map from supabase if available, for now use trainer name as fallback
      const parsed: BulkStoreRow[] = dataRows.map((row, i) => {
        const name         = String(row[0] ?? '').trim()
        const region       = String(row[1] ?? '').trim()
        const trainerEmail = String(row[2] ?? '').trim().toLowerCase()
        const errors: string[] = []
        if (!name)   errors.push('Store Name missing')
        if (!region) errors.push('Region missing')
        let trainerId: string | null = null
        if (trainerEmail) {
          const found = trainers.find((t) => t.email?.toLowerCase() === trainerEmail)
          if (found) trainerId = found.id
          else errors.push(`Trainer with email "${trainerEmail}" not found`)
        }
        return { rowIndex: i + 2, name, region, trainerEmail, trainerId, errors }
      })
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
    try {
      const BATCH = 50
      let imported = 0
      for (let i = 0; i < valid.length; i += BATCH) {
        const batch = valid.slice(i, i + BATCH).map((r) => {
          const trainer = r.trainerId ? trainers.find((t) => t.id === r.trainerId) : null
          return { name: r.name, region: r.region, trainer_id: r.trainerId ?? null, trainer_name: trainer?.name ?? null }
        })
        const { error } = await supabase.from('stores').insert(batch)
        if (error) throw error
        imported += batch.length
        setProgress(imported)
      }
      setImportedCount(imported)
      setStep('done')
      onImported()
    } catch (e) {
      toast.error(`Import failed: ${(e as Error).message}`)
      setStep('previewing')
    }
  }

  const validCount   = rows.filter((r) => r.errors.length === 0).length
  const invalidCount = rows.filter((r) => r.errors.length > 0).length

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-sm">Bulk Upload Stores</DialogTitle>
        </DialogHeader>

        {step === 'idle' && (
          <div className="space-y-4 py-1">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                Expected columns: <strong>Store Name</strong> | <strong>Region</strong> | <strong>Trainer Email</strong>
              </p>
              <Button variant="outline" size="sm" onClick={downloadStoresTemplate}
                className="gap-1.5 text-xs">
                <Download className="h-3.5 w-3.5" /> Download Template
              </Button>
            </div>
            <div
              className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-gray-200 py-12 hover:border-gray-300"
              onClick={() => fileRef.current?.click()}
            >
              <Upload className="h-7 w-7 text-gray-300" />
              <p className="text-sm text-gray-500">
                Drop file here or{' '}
                <span className="font-medium" style={{ color: accent }}>browse</span>
              </p>
              <p className="text-xs text-muted-foreground">.xlsx or .csv accepted</p>
              <input ref={fileRef} type="file" accept=".xlsx,.csv" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = '' }} />
            </div>
            {parseError && (
              <p className="flex items-center gap-1.5 text-xs text-red-600">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {parseError}
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
                    <th className="px-3 py-2 text-left font-medium text-gray-500">Store Name</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-500">Region</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-500">Trainer Email</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-500">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {rows.slice(0, 50).map((row) => (
                    <tr key={row.rowIndex}
                      className={cn(row.errors.length > 0 && 'bg-red-50/50')}>
                      <td className="px-3 py-1.5 text-muted-foreground">{row.rowIndex}</td>
                      <td className="px-3 py-1.5 text-gray-700">{row.name || <span className="text-red-400 italic">missing</span>}</td>
                      <td className="px-3 py-1.5 text-gray-700">{row.region || <span className="text-red-400 italic">missing</span>}</td>
                      <td className="px-3 py-1.5 text-gray-700">{row.trainerEmail || <span className="text-muted-foreground">—</span>}</td>
                      <td className="px-3 py-1.5">
                        {row.errors.length > 0
                          ? <span className="text-red-600">{row.errors.join('; ')}</span>
                          : <span className="text-emerald-600 font-medium">✓</span>}
                      </td>
                    </tr>
                  ))}
                  {rows.length > 50 && (
                    <tr>
                      <td colSpan={5} className="px-3 py-2 text-center text-muted-foreground">
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
                Import {validCount} store{validCount !== 1 ? 's' : ''}
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === 'importing' && (
          <div className="space-y-4 py-6">
            <p className="text-center text-sm text-gray-600">
              Importing… {progress} / {validCount}
            </p>
            <Progress
              value={validCount > 0 ? Math.round((progress / validCount) * 100) : 0}
              className="mx-auto max-w-xs"
            />
          </div>
        )}

        {step === 'done' && (
          <div className="space-y-4 py-1">
            <div className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-3 text-xs text-emerald-700">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
              Successfully imported {importedCount} store{importedCount !== 1 ? 's' : ''}.
            </div>
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

export default function StoresPage() {
  const { pathname } = useLocation()
  const navigate     = useNavigate()
  const queryClient  = useQueryClient()

  const accent = pathname.startsWith('/erp') ? '#E8642C' : '#E8642C'
  const today  = todayStr()
  const isErp  = pathname.startsWith('/erp')

  const { data: stores = [], isLoading } = useStores()
  const { data: staff  = [] }            = useAllStaff()
  const { data: tasks  = [] }            = useAllTasks()
  const { data: trainers = [] }          = useTrainers()

  // ── UI state ─────────────────────────────────────────────────────────────
  const [search, setSearch]               = useState('')
  const [regionFilter, setRegionFilter]   = useState('all')
  const [trainerFilter, setTrainerFilter] = useState('all')
  const [expandedId, setExpandedId]       = useState<string | null>(null)

  const [sheetMode, setSheetMode] = useState<'add' | 'edit' | null>(null)
  const [editStore, setEditStore] = useState<StoreRow | null>(null)
  const [saving, setSaving]       = useState(false)

  const [deleteTarget, setDeleteTarget] = useState<StoreRow | null>(null)
  const [deleting, setDeleting]         = useState(false)

  const [bulkOpen, setBulkOpen] = useState(false)

  // ── Store Login dialog ────────────────────────────────────────────────────
  const [storeLoginOpen, setStoreLoginOpen]     = useState(false)
  const [storeLoginStep, setStoreLoginStep]     = useState<'form' | 'success'>('form')
  const [storeLoginForm, setStoreLoginForm]     = useState({ store_id: '', display_name: '', email: '', password: '' })
  const [showSlPw, setShowSlPw]                 = useState(false)
  const [storeLoginAdding, setStoreLoginAdding] = useState(false)
  const [storeLoginCreds, setStoreLoginCreds]   = useState<{ name: string; email: string; password: string } | null>(null)

  const canSubmitStoreLogin =
    !!storeLoginForm.store_id && !!storeLoginForm.display_name.trim() &&
    !!storeLoginForm.email.trim() && storeLoginForm.password.length >= 8

  function closeStoreLoginDialog() {
    setStoreLoginOpen(false); setStoreLoginStep('form')
    setStoreLoginForm({ store_id: '', display_name: '', email: '', password: '' })
    setShowSlPw(false); setStoreLoginCreds(null)
  }

  function handleStoreLoginStoreChange(storeId: string) {
    const store = stores.find((s) => s.id === storeId)
    setStoreLoginForm((f) => ({
      ...f,
      store_id:     storeId,
      display_name: f.display_name || (store?.name ?? ''),
    }))
  }

  async function handleStoreLoginSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmitStoreLogin) return
    setStoreLoginAdding(true)
    try {
      const { data, error } = await supabase.functions.invoke('create-staff-user', {
        body: {
          name:           storeLoginForm.display_name.trim(),
          phone:          null,
          email:          storeLoginForm.email.trim().toLowerCase(),
          password:       storeLoginForm.password,
          store_id:       storeLoginForm.store_id,
          role:           'staff',
          access_level:   'single_store',
          is_store_login: true,
        },
      })
      if (error) throw error
      if (data?.error) throw new Error(String(data.error))
      setStoreLoginCreds({
        name:     storeLoginForm.display_name.trim(),
        email:    storeLoginForm.email.trim().toLowerCase(),
        password: storeLoginForm.password,
      })
      setStoreLoginStep('success')
    } catch (e) {
      toast.error(`Failed to create store login: ${(e as Error).message}`)
    } finally { setStoreLoginAdding(false) }
  }

  // ── Derived ───────────────────────────────────────────────────────────────
  const allRegions = [...new Set(stores.map((s) => s.region).filter(Boolean))].sort() as string[]

  const filtered = stores.filter((s) => {
    const q = search.trim().toLowerCase()
    const matchSearch  = !q || s.name.toLowerCase().includes(q) || s.region.toLowerCase().includes(q)
    const matchRegion  = regionFilter === 'all' || s.region === regionFilter
    const matchTrainer = trainerFilter === 'all' || s.trainer_id === trainerFilter
    return matchSearch && matchRegion && matchTrainer
  })

  const totalPending = tasks.filter((t) => t.status === 'pending').length

  const deleteStaffCount   = deleteTarget ? staff.filter((s) => s.store_id === deleteTarget.id).length : 0
  const deletePendingCount = deleteTarget ? tasks.filter((t) => t.store_id === deleteTarget.id && t.status === 'pending').length : 0

  // ── Mutations ─────────────────────────────────────────────────────────────
  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['stores_mgmt'] })
    queryClient.invalidateQueries({ queryKey: ['stores'] })
  }

  async function handleAddStore(name: string, region: string, trainerId: string | null) {
    setSaving(true)
    const trainer = trainers.find((t) => t.id === trainerId) ?? null
    try {
      const { error } = await supabase.from('stores').insert({
        name, region,
        trainer_id:   trainerId,
        trainer_name: trainer?.name ?? null,
      })
      if (error) throw error
      invalidate()
      setSheetMode(null)
      toast.success('Store added successfully')
    } catch (e) {
      toast.error(`Failed to add store: ${(e as Error).message}`)
    } finally { setSaving(false) }
  }

  async function handleEditStore(name: string, region: string, trainerId: string | null) {
    if (!editStore) return
    setSaving(true)
    const trainer = trainers.find((t) => t.id === trainerId) ?? null
    try {
      const { error } = await supabase.from('stores').update({
        name, region,
        trainer_id:   trainerId,
        trainer_name: trainer?.name ?? null,
      }).eq('id', editStore.id)
      if (error) throw error
      invalidate()
      setSheetMode(null); setEditStore(null)
      toast.success('Store updated successfully')
    } catch (e) {
      toast.error(`Failed to update store: ${(e as Error).message}`)
    } finally { setSaving(false) }
  }

  async function handleDeleteStore() {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      const { error } = await supabase.from('stores').delete().eq('id', deleteTarget.id)
      if (error) throw error
      invalidate()
      setDeleteTarget(null)
      if (expandedId === deleteTarget.id) setExpandedId(null)
      toast.success('Store deleted')
    } catch (e) {
      toast.error(`Delete failed: ${(e as Error).message}`)
    } finally { setDeleting(false) }
  }

  function openEdit(store: StoreRow) { setEditStore(store); setSheetMode('edit') }
  function closeSheet() { setSheetMode(null); setEditStore(null) }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-lg font-bold text-gray-900">Stores</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">Manage your HUFT store locations</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setBulkOpen(true)} className="gap-1.5">
            <Upload className="h-4 w-4" /> Bulk Upload
          </Button>
          <Button variant="outline" onClick={() => setStoreLoginOpen(true)} className="gap-1.5">
            <StoreIcon className="h-4 w-4" /> Store Login
          </Button>
          <Button onClick={() => setSheetMode('add')}
            className="gap-1.5 text-white hover:opacity-90" style={{ backgroundColor: accent }}>
            <Plus className="h-4 w-4" /> Add Store
          </Button>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-4">
        <StatCard icon={StoreIcon}     label="Total Stores"  value={stores.length} accent={accent} />
        <StatCard icon={UsersIcon}     label="Total Staff"   value={staff.length}  accent={accent} />
        <StatCard icon={ClipboardList} label="Pending Tasks" value={totalPending}  accent={accent} />
      </div>

      {/* Search + region + trainer filters */}
      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or region…" className="pl-8" />
        </div>
        <Select value={regionFilter} onValueChange={setRegionFilter}>
          <SelectTrigger className="w-44"><SelectValue placeholder="All Regions" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Regions</SelectItem>
            {allRegions.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
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

      {/* Stores table */}
      <Card>
        <CardContent className="px-0 pb-1">
          {isLoading ? (
            <p className="py-12 text-center text-sm text-muted-foreground">Loading…</p>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16">
              <StoreIcon className="h-8 w-8 text-gray-300" />
              <p className="text-sm text-gray-500">
                {stores.length === 0 ? 'No stores yet. Add your first store.' : 'No stores match your search.'}
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8 pl-5" />
                  <TableHead>Store Name</TableHead>
                  <TableHead>Region</TableHead>
                  <TableHead>Staff</TableHead>
                  <TableHead>Assigned Trainer</TableHead>
                  <TableHead>Pending Tasks</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="pr-5 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((store) => {
                  const storeStaff = staff.filter((s) => s.store_id === store.id)
                  const storeTasks = tasks.filter((t) => t.store_id === store.id)
                  const pending    = storeTasks.filter((t) => t.status === 'pending').length
                  const done       = storeTasks.filter((t) => t.status === 'done').length
                  const overdue    = storeTasks.filter((t) => t.status === 'pending' && t.due_date != null && t.due_date < today).length
                  const isExpanded = expandedId === store.id

                  return (
                    <Fragment key={store.id}>
                      <TableRow className="cursor-pointer hover:bg-gray-50"
                        onClick={() => setExpandedId(isExpanded ? null : store.id)}>
                        <TableCell className="pl-5 w-8">
                          {isExpanded
                            ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
                            : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
                        </TableCell>
                        <TableCell className="font-medium text-gray-900">{store.name}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-[10px] text-gray-600 border-gray-200">
                            {store.region}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">{storeStaff.length}</TableCell>
                        <TableCell className="text-sm">
                          {store.trainer_name
                            ? store.trainer_name
                            : <span className="text-xs text-gray-400">Unassigned</span>}
                        </TableCell>
                        <TableCell>
                          {pending > 0
                            ? <span className="text-sm font-semibold" style={{ color: accent }}>{pending}</span>
                            : <span className="text-sm text-muted-foreground">0</span>}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{fmtDate(store.created_at)}</TableCell>
                        <TableCell className="pr-5 text-right">
                          <div className="flex items-center justify-end gap-0.5"
                            onClick={(e) => e.stopPropagation()}>
                            <Button variant="ghost" size="icon-sm" title="Edit store"
                              onClick={() => openEdit(store)}>
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            {isErp && (
                              <Button variant="ghost" size="icon-sm" title="View tasks"
                                onClick={() => navigate(`/erp/upload?store=${store.id}`)}>
                                <ExternalLink className="h-3.5 w-3.5" />
                              </Button>
                            )}
                            <Button variant="ghost" size="icon-sm" title="Delete store"
                              className="text-red-400 hover:bg-red-50 hover:text-red-600"
                              onClick={() => setDeleteTarget(store)}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>

                      {isExpanded && (
                        <TableRow className="bg-gray-50/60 hover:bg-gray-50/60">
                          <TableCell colSpan={8} className="px-8 pb-5 pt-0">
                            <div className="grid grid-cols-2 gap-8 pt-4">
                              <div>
                                <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                                  Staff ({storeStaff.length})
                                </p>
                                {storeStaff.length === 0 ? (
                                  <p className="text-xs text-muted-foreground">No staff assigned</p>
                                ) : (
                                  <table className="w-full text-xs">
                                    <thead>
                                      <tr className="border-b border-gray-100 text-left">
                                        <th className="pb-1.5 font-medium text-gray-400">Name</th>
                                        <th className="pb-1.5 font-medium text-gray-400">Role</th>
                                        <th className="pb-1.5 font-medium text-gray-400">Phone</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100">
                                      {storeStaff.map((s) => (
                                        <tr key={s.id}>
                                          <td className="py-1.5 font-medium text-gray-700">{s.name}</td>
                                          <td className="py-1.5 text-muted-foreground">{ROLE_LABELS[s.role] ?? s.role}</td>
                                          <td className="py-1.5 text-muted-foreground">{s.phone ?? '–'}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                )}
                              </div>
                              <div>
                                <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                                  Task Summary
                                </p>
                                <div className="flex flex-wrap gap-5">
                                  {[
                                    { label: 'Pending', val: pending, color: 'bg-orange-400' },
                                    { label: 'Done',    val: done,    color: 'bg-emerald-500' },
                                    { label: 'Overdue', val: overdue, color: 'bg-red-500' },
                                  ].map(({ label, val, color }) => (
                                    <div key={label} className="flex items-center gap-2">
                                      <span className={cn('inline-block h-2 w-2 rounded-full', color)} />
                                      <span className="text-xs text-gray-600">
                                        {label} <strong className="text-gray-900">{val}</strong>
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Add / Edit sheet */}
      <Sheet open={sheetMode !== null} onOpenChange={(open) => { if (!open) closeSheet() }}>
        <SheetContent side="right">
          <SheetHeader>
            <SheetTitle>{sheetMode === 'add' ? 'Add Store' : 'Edit Store'}</SheetTitle>
          </SheetHeader>
          {sheetMode !== null && (
            <StoreForm
              accent={accent}
              initial={editStore
                ? { name: editStore.name, region: editStore.region, trainerId: editStore.trainer_id }
                : undefined}
              trainers={trainers}
              onSave={sheetMode === 'add' ? handleAddStore : handleEditStore}
              onClose={closeSheet}
              saving={saving}
            />
          )}
        </SheetContent>
      </Sheet>

      {/* Delete confirmation dialog */}
      <Dialog open={deleteTarget !== null} onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm">Delete &ldquo;{deleteTarget?.name}&rdquo;?</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1">
            {deleteStaffCount > 0 && (
              <div className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2.5 text-xs text-amber-800">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                This store has <strong>{deleteStaffCount} staff member{deleteStaffCount !== 1 ? 's' : ''}</strong> assigned to it.
              </div>
            )}
            {deletePendingCount > 0 && (
              <div className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2.5 text-xs text-red-800">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-500" />
                This store has <strong>{deletePendingCount} active task{deletePendingCount !== 1 ? 's' : ''}</strong> pending.
              </div>
            )}
            <p className="text-xs text-muted-foreground">This action cannot be undone.</p>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" size="sm">Cancel</Button>
            </DialogClose>
            <Button size="sm" onClick={handleDeleteStore} disabled={deleting}
              className="bg-red-600 hover:bg-red-700 text-white">
              {deleting ? 'Deleting…' : 'Delete Store'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk upload dialog */}
      <StoreBulkDialog
        accent={accent}
        open={bulkOpen}
        onOpenChange={setBulkOpen}
        onImported={invalidate}
        trainers={trainers}
      />

      {/* ── Store Login Dialog ──────────────────────────────────────── */}
      <Dialog open={storeLoginOpen} onOpenChange={(open) => { if (!open) closeStoreLoginDialog() }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm">
              {storeLoginStep === 'form' ? 'Create Store Login' : 'Store Login Created'}
            </DialogTitle>
          </DialogHeader>

          {storeLoginStep === 'form' ? (
            <form onSubmit={handleStoreLoginSubmit} className="space-y-4 py-1">
              <div className="space-y-1.5">
                <Label className="text-xs">Account Type</Label>
                <div className="flex items-center gap-2 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-xs text-gray-600">
                  <StoreIcon className="h-3.5 w-3.5 text-gray-400" />
                  Store Login — shared account for an entire store
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Store <span className="text-red-500">*</span></Label>
                <Select value={storeLoginForm.store_id} onValueChange={handleStoreLoginStoreChange}>
                  <SelectTrigger><SelectValue placeholder="Select store" /></SelectTrigger>
                  <SelectContent>
                    {stores.map((st) => <SelectItem key={st.id} value={st.id}>{st.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Display Name <span className="text-red-500">*</span></Label>
                <Input
                  value={storeLoginForm.display_name}
                  onChange={(e) => setStoreLoginForm((f) => ({ ...f, display_name: e.target.value }))}
                  placeholder="e.g. HUFT Saket"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Email <span className="text-red-500">*</span></Label>
                <Input
                  value={storeLoginForm.email}
                  onChange={(e) => setStoreLoginForm((f) => ({ ...f, email: e.target.value }))}
                  placeholder="saket@huft.com"
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
                    type={showSlPw ? 'text' : 'password'}
                    placeholder="Min 8 characters"
                    required
                    className="pr-9"
                  />
                  <button type="button" tabIndex={-1} onClick={() => setShowSlPw((v) => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-gray-700">
                    {showSlPw ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </div>
                {storeLoginForm.password.length > 0 && storeLoginForm.password.length < 8 && (
                  <p className="text-[11px] text-red-500">Must be at least 8 characters</p>
                )}
              </div>
              <div className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-[11px] text-muted-foreground">
                Role: <strong>Staff</strong> · Access: <strong>Single Store</strong> · is_store_login: <strong>true</strong>
              </div>
              <DialogFooter className="pt-2">
                <DialogClose asChild>
                  <Button type="button" variant="outline" size="sm">Cancel</Button>
                </DialogClose>
                <Button type="submit" size="sm" disabled={storeLoginAdding || !canSubmitStoreLogin}
                  className="text-white hover:opacity-90" style={{ backgroundColor: accent }}>
                  {storeLoginAdding ? 'Creating…' : 'Create Store Login'}
                </Button>
              </DialogFooter>
            </form>
          ) : (
            <div className="space-y-4 py-1">
              <div className="flex items-start gap-2 rounded-lg bg-emerald-50 px-3 py-2.5 text-xs text-emerald-700">
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
                Store login created. Share these credentials — they won&apos;t be shown again.
              </div>
              <div className="space-y-3 rounded-lg border border-gray-100 bg-gray-50 p-3.5">
                <CredRow label="Name"     value={storeLoginCreds?.name ?? ''} />
                <CredRow label="Email"    value={storeLoginCreds?.email ?? ''} />
                <CredRow label="Password" value={storeLoginCreds?.password ?? ''} secret />
              </div>
              <DialogFooter>
                <Button size="sm" onClick={closeStoreLoginDialog}
                  className="text-white hover:opacity-90" style={{ backgroundColor: accent }}>Done</Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

    </div>
  )
}
