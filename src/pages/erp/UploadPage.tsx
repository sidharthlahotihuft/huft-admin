import * as XLSX from 'xlsx'
import { useState, useRef, useCallback, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import {
  Upload, FileText, CheckCircle2, XCircle, AlertTriangle,
  ClipboardList, Clock, RefreshCw, ChevronDown, ChevronUp, Download,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose,
} from '@/components/ui/dialog'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import { parseERPData, parseMultiSheetExcel } from '@/utils/erpParser'
import type { Task, ReplenishmentRule } from '@/types'
import { toast } from 'sonner'

// ─── Types ────────────────────────────────────────────────────────────────────

type UploadMode = 'single' | 'bulk'
type Step = 'idle' | 'detecting' | 'detected' | 'file-ready' | 'parsing' | 'preview' | 'pushing' | 'success'

type SheetMatch = {
  sheetName: string
  storeId: string | null
  storeName: string | null
  matched: boolean
}

type PreviewStore = {
  storeId: string
  storeName: string
  tasks: Partial<Task>[]
}

type StoreMin = { id: string; name: string }

// ─── Constants ────────────────────────────────────────────────────────────────

const TASK_TYPE_CFG: Record<string, { label: string; cls: string }> = {
  reorder:       { label: 'Reorder',       cls: 'bg-orange-50 text-orange-700 border-orange-200 hover:bg-orange-50' },
  winback:       { label: 'Win Back',       cls: 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-50' },
  pattern_break: { label: 'Pattern Break', cls: 'bg-red-50 text-red-700 border-red-200 hover:bg-red-50' },
}

const BATCH_SIZE = 50

// ─── Customer grouping ────────────────────────────────────────────────────────

type CustomerGroup = {
  key: string
  name: string
  phone: string
  tasks: Partial<Task>[]
  types: string[]
}

function groupByCustomer(tasks: Partial<Task>[], prefix: string): CustomerGroup[] {
  const map = new Map<string, CustomerGroup>()
  for (const t of tasks) {
    const k = `${prefix}::${t.customer_phone ?? ''}::${t.customer_name ?? ''}`
    if (!map.has(k)) map.set(k, { key: k, name: t.customer_name ?? '–', phone: t.customer_phone ?? '', tasks: [], types: [] })
    const g = map.get(k)!
    g.tasks.push(t)
    const type = t.task_type ?? 'reorder'
    if (!g.types.includes(type)) g.types.push(type)
  }
  return Array.from(map.values())
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatBytes(b: number) {
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  return `${(b / (1024 * 1024)).toFixed(1)} MB`
}

function fmtDate(iso: string | null | undefined) {
  if (!iso) return '–'
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

function todayStr() { return new Date().toISOString().split('T')[0] }

function RunsOutCell({ date }: { date: string | null | undefined }) {
  if (!date) return <span className="text-muted-foreground">–</span>
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1)
  const d = new Date(date); d.setHours(0, 0, 0, 0)
  if (d < today) return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-red-600">{fmtDate(date)}</span>
      <Badge variant="outline" className="border-red-200 bg-red-50 text-red-600 text-[10px] py-0">Overdue</Badge>
    </span>
  )
  if (d <= tomorrow) return <span className="text-amber-600">{fmtDate(date)}</span>
  return <span className="text-muted-foreground">{fmtDate(date)}</span>
}

// ─── Queries ──────────────────────────────────────────────────────────────────

function useTaskStats(storeId: string | null) {
  return useQuery({
    queryKey: ['task_stats_upload', storeId],
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let q: any = supabase.from('tasks').select('status, due_date')
      if (storeId) q = q.eq('store_id', storeId)
      const { data, error } = await q
      if (error) throw error
      const today = todayStr()
      const rows = (data ?? []) as Array<{ status: string; due_date: string | null }>
      return {
        pending:   rows.filter((r) => r.status === 'pending').length,
        dueToday:  rows.filter((r) => r.status === 'pending' && r.due_date === today).length,
        completed: rows.filter((r) => r.status === 'done').length,
        overdue:   rows.filter((r) => r.status === 'pending' && r.due_date != null && r.due_date < today).length,
      }
    },
    staleTime: 60_000,
  })
}

function useStores() {
  return useQuery<StoreMin[]>({
    queryKey: ['stores'],
    queryFn: async () => {
      const { data, error } = await supabase.from('stores').select('id, name').order('name')
      if (error) throw error
      return (data ?? []) as StoreMin[]
    },
    staleTime: 5 * 60_000,
  })
}

function useRules() {
  return useQuery<ReplenishmentRule[]>({
    queryKey: ['replenishment_rules_all'],
    queryFn: async () => {
      const { data, error } = await supabase.from('replenishment_rules').select('*')
      if (error) throw error
      return (data ?? []) as ReplenishmentRule[]
    },
    staleTime: 5 * 60_000,
  })
}

// ─── StatCard ─────────────────────────────────────────────────────────────────

function StatCard({ icon: Icon, label, value, iconBg }: {
  icon: React.ComponentType<{ className?: string }>
  label: string; value: number; iconBg: string
}) {
  return (
    <Card>
      <CardContent className="pb-4 pt-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">{label}</p>
            <p className="mt-1.5 text-2xl font-bold text-gray-900">{value.toLocaleString('en-IN')}</p>
          </div>
          <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${iconBg}`}>
            <Icon className="h-4 w-4 text-white" />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// ─── DropZone ─────────────────────────────────────────────────────────────────

function DropZone({ onFile, accept, file, disabled }: {
  onFile: (f: File) => void
  accept: string; file: File | null; disabled?: boolean
}) {
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const f = e.dataTransfer.files[0]
    if (f) onFile(f)
  }, [onFile])

  return (
    <div
      onClick={() => !disabled && inputRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); if (!disabled) setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      className={cn(
        'cursor-pointer rounded-xl border-2 border-dashed p-8 text-center transition-all',
        dragging  ? 'border-[#E8642C] bg-orange-50/50' : 'border-gray-200 bg-gray-50/30 hover:border-gray-300',
        disabled  && 'pointer-events-none opacity-40',
      )}
    >
      <input
        ref={inputRef} type="file" accept={accept} className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) { onFile(f); e.target.value = '' } }}
      />
      {file ? (
        <div className="flex flex-col items-center gap-1.5">
          <FileText className="h-8 w-8 text-[#E8642C]" />
          <p className="text-sm font-medium text-gray-800">{file.name}</p>
          <p className="text-xs text-muted-foreground">{formatBytes(file.size)}</p>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); inputRef.current?.click() }}
            className="mt-1 text-xs text-[#E8642C] hover:underline"
          >
            Change file
          </button>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-1.5">
          <Upload className="h-8 w-8 text-gray-300" />
          <p className="text-sm text-gray-600">
            Drop file here or <span className="font-medium text-[#E8642C]">browse</span>
          </p>
          <p className="text-xs text-muted-foreground">
            {accept.split(',').map((s) => s.replace('.', '').toUpperCase()).join(', ')} accepted
          </p>
        </div>
      )}
    </div>
  )
}

// ─── TaskTypeBadge ────────────────────────────────────────────────────────────

function TaskTypeBadge({ type }: { type: string }) {
  const cfg = TASK_TYPE_CFG[type] ?? { label: type, cls: 'bg-gray-50 text-gray-600 border-gray-200' }
  return <Badge variant="outline" className={cn('text-[10px]', cfg.cls)}>{cfg.label}</Badge>
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function ERPUploadPage() {
  const queryClient = useQueryClient()
  const [searchParams] = useSearchParams()

  const [mode, setMode] = useState<UploadMode>('single')
  const [selectedStoreId, setSelectedStoreId] = useState<string | null>(
    searchParams.get('store'),
  )
  const [file, setFile]       = useState<File | null>(null)
  const [step, setStep]       = useState<Step>('idle')
  const [sheetMatches, setSheetMatches]   = useState<SheetMatch[]>([])
  const [previewStores, setPreviewStores] = useState<PreviewStore[]>([])
  const [parseError, setParseError]       = useState<string | null>(null)

  const [pushOpen, setPushOpen]         = useState(false)
  const [upsertCounts, setUpsertCounts] = useState<{ toInsert: number; toUpdate: number } | null>(null)
  const [pushProgress, setPushProgress] = useState(0)
  const [pushTotal, setPushTotal]       = useState(0)
  const [successMsg, setSuccessMsg]     = useState<string | null>(null)

  const [adminId, setAdminId]     = useState<string | null>(null)
  const [adminName, setAdminName] = useState<string | null>(null)

  const [expandedCustomers, setExpandedCustomers] = useState<Set<string>>(() => new Set())

  function toggleCustomer(key: string) {
    setExpandedCustomers((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function downloadTemplate() {
    const headers = [
      'Customer Phone', 'Customer Name', 'Product Barcode', 'Product Name',
      'Order Count', 'Product Quantity', 'Total Price', 'Month', 'Store Code',
    ]
    const sample = [
      ['9717253226', 'Ankur', '8906186430377', "HUFT Sara's Wholesome Chicken & Turkey Grain Free Dog Wet Food 100gm", 3, 125, 13706.25, 'March 2026', 'HUFT-SAKET'],
      ['9868815207', 'Pragiti Narang', '064992182120', 'Orijen Original Dog Dry Food 11.4kg', 1, 1, 12999, 'March 2026', 'HUFT-GK2'],
    ]
    const ws = XLSX.utils.aoa_to_sheet([headers, ...sample])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'ERP Data')
    XLSX.writeFile(wb, 'HUFT_ERP_Upload_Template.xlsx')
  }

  const statsStoreId = mode === 'single' ? selectedStoreId : null
  const { data: stats }        = useTaskStats(statsStoreId)
  const { data: stores = [] }  = useStores()
  const { data: rules  = [] }  = useRules()

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return
      setAdminId(user.id)
      supabase.from('staff').select('name').eq('id', user.id).single()
        .then(({ data }) => setAdminName(data?.name ?? null))
    })
  }, [])

  // ── File handling ─────────────────────────────────────────────────────────

  async function handleFileSelected(f: File) {
    setFile(f)
    setParseError(null)
    setSheetMatches([])
    setPreviewStores([])

    if (mode === 'bulk') {
      setStep('detecting')
      try {
        const buf  = await f.arrayBuffer()
        const wb   = XLSX.read(buf, { type: 'array', bookSheets: true })
        const matches: SheetMatch[] = wb.SheetNames.map((name) => {
          const store = stores.find(
            (s) => s.name.trim().toLowerCase() === name.trim().toLowerCase(),
          )
          return { sheetName: name, storeId: store?.id ?? null, storeName: store?.name ?? null, matched: !!store }
        })
        setSheetMatches(matches)
        setStep('detected')
      } catch (e) {
        setParseError(`Could not read Excel file: ${(e as Error).message}`)
        setStep('idle')
      }
    } else {
      setStep('file-ready')
    }
  }

  function handleClear() {
    setFile(null)
    setStep('idle')
    setSheetMatches([])
    setPreviewStores([])
    setParseError(null)
    setPushProgress(0)
    setPushTotal(0)
    setUpsertCounts(null)
  }

  function switchMode(m: UploadMode) {
    setMode(m)
    handleClear()
  }

  // ── Upsert count pre-computation ─────────────────────────────────────────
  // Called right after parse so the preview banner and dialog already show
  // how many tasks are new vs refreshing an existing pending task.

  async function computeUpsertCounts(previews: PreviewStore[]) {
    try {
      const allTasks = previews.flatMap((s) => s.tasks)
      const storeIds = [...new Set(allTasks.map((t) => t.store_id).filter(Boolean))] as string[]
      if (!storeIds.length) return

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase as any)
        .from('tasks')
        .select('store_id, customer_phone, product_sku')
        .in('store_id', storeIds)
        .eq('status', 'pending')

      const existingKeys = new Set(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (data ?? []).map((r: any) =>
          `${r.store_id ?? ''}::${r.customer_phone ?? ''}::${r.product_sku ?? ''}`,
        ),
      )

      let toUpdate = 0
      let toInsert = 0
      for (const t of allTasks) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const sku = (t as any).product_sku ?? ''
        const key = `${t.store_id ?? ''}::${t.customer_phone ?? ''}::${sku}`
        if (t.customer_phone && sku && existingKeys.has(key)) toUpdate++
        else toInsert++
      }
      setUpsertCounts({ toInsert, toUpdate })
    } catch {
      // Non-critical; counts are informational only
    }
  }

  // ── Parsing ───────────────────────────────────────────────────────────────

  async function handleParse() {
    if (!file) return
    setStep('parsing')
    setParseError(null)

    try {
      if (mode === 'single') {
        if (!selectedStoreId) return
        let data: string | unknown[][]
        if (file.name.toLowerCase().endsWith('.csv')) {
          data = await file.text()
        } else {
          const buf   = await file.arrayBuffer()
          const wb    = XLSX.read(buf, { type: 'array', cellDates: true })
          const sheet = wb.Sheets[wb.SheetNames[0]]
          data = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
            header: 1, defval: '', raw: false,
          }) as unknown[][]
        }
        const tasks     = parseERPData(data, selectedStoreId, rules)
        const storeName = stores.find((s) => s.id === selectedStoreId)?.name ?? selectedStoreId
        const singlePreview = tasks.length ? [{ storeId: selectedStoreId, storeName, tasks }] : []
        setPreviewStores(singlePreview)
        if (!tasks.length) {
          setParseError('No tasks generated — check that the file format matches expected ERP structure.')
          setStep('file-ready')
          return
        }
        await computeUpsertCounts(singlePreview)
      } else {
        const storeMap: Record<string, string> = {}
        for (const m of sheetMatches) if (m.matched && m.storeId) storeMap[m.sheetName] = m.storeId
        const tasksByStore = await parseMultiSheetExcel(file, storeMap, rules)
        const previews: PreviewStore[] = Object.entries(tasksByStore)
          .filter(([, tasks]) => tasks.length > 0)
          .map(([storeId, tasks]) => ({
            storeId,
            storeName: stores.find((s) => s.id === storeId)?.name ?? storeId,
            tasks,
          }))
        setPreviewStores(previews)
        if (!previews.length) {
          setParseError('No tasks generated from any matched sheet.')
          setStep('detected')
          return
        }
        await computeUpsertCounts(previews)
      }
      setStep('preview')
    } catch (e) {
      setParseError(`Parse failed: ${(e as Error).message}`)
      setStep(mode === 'bulk' ? 'detected' : 'file-ready')
    }
  }

  // ── Push ──────────────────────────────────────────────────────────────────

  async function handlePush() {
    setPushOpen(false)
    setStep('pushing')

    const allTasks = previewStores.flatMap((s) => s.tasks)
    setPushTotal(allTasks.length)
    setPushProgress(0)

    try {
      let totalProcessed = 0

      for (const ps of previewStores) {
        if (!ps.tasks.length) continue

        // 1. Create erp_uploads record first — tasks FK requires a real id
        const { data: uploadRow, error: uploadError } = await supabase
          .from('erp_uploads')
          .insert({
            store_id:         ps.storeId,
            store_name:       ps.storeName,
            uploaded_by:      adminId,
            uploaded_by_name: adminName,
            filename:         file?.name ?? 'unknown',
            tasks_created:    ps.tasks.length,
            upload_type:      mode,
          })
          .select('id')
          .single()
        if (uploadError) throw uploadError
        const uploadId = uploadRow.id

        // 2. Fetch existing pending tasks for this store to build update/insert split
        const { data: existingPending, error: fetchError } = await supabase
          .from('tasks')
          .select('id, customer_phone, product_sku')
          .eq('store_id', ps.storeId)
          .eq('status', 'pending')
        if (fetchError) throw fetchError

        const pendingMap = new Map(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (existingPending ?? []).map((r: any) => [
            `${r.customer_phone ?? ''}::${r.product_sku ?? ''}`,
            r.id as string,
          ]),
        )

        const toUpdate: Array<{ id: string; patch: Record<string, unknown> }> = []
        const toInsert: Partial<Task>[] = []

        for (const task of ps.tasks) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const sku    = (task as any).product_sku ?? ''
          const key    = `${task.customer_phone ?? ''}::${sku}`
          const existId = (task.customer_phone && sku) ? pendingMap.get(key) : undefined

          if (existId) {
            // Pending task exists → refresh dates/priority, preserve status & notes
            toUpdate.push({
              id: existId,
              patch: {
                due_date:               task.due_date,
                priority:               task.priority,
                predicted_finish_date:  task.predicted_finish_date,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                followup_t_minus_4:     (task as any).followup_t_minus_4,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                followup_t_minus_2:     (task as any).followup_t_minus_2,
                upload_batch_id:        uploadId,
              },
            })
          } else {
            // No pending task (either new customer-product or previous cycle is done)
            toInsert.push({ ...task, upload_batch_id: uploadId })
          }
        }

        // 3a. Update existing pending tasks (parallel within each batch)
        for (let i = 0; i < toUpdate.length; i += BATCH_SIZE) {
          const batch = toUpdate.slice(i, i + BATCH_SIZE)
          const results = await Promise.all(
            batch.map(({ id, patch }) => supabase.from('tasks').update(patch).eq('id', id)),
          )
          const err = results.find((r) => r.error)?.error
          if (err) throw err
          totalProcessed += batch.length
          setPushProgress(totalProcessed)
        }

        // 3b. Insert brand-new tasks
        for (let i = 0; i < toInsert.length; i += BATCH_SIZE) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const batch = toInsert.slice(i, i + BATCH_SIZE) as any[]
          const { error } = await supabase.from('tasks').insert(batch)
          if (error) throw error
          totalProcessed += batch.length
          setPushProgress(totalProcessed)
        }
      }

      const uniqueCustomers = new Set(allTasks.map((t) => t.customer_phone)).size
      const storeNames      = previewStores.map((s) => s.storeName).join(', ')
      const inserted        = upsertCounts?.toInsert ?? allTasks.length
      const refreshed       = upsertCounts?.toUpdate ?? 0
      setSuccessMsg(
        `Pushed to ${storeNames}: ${inserted} new task${inserted !== 1 ? 's' : ''} added, ` +
        `${refreshed} existing task${refreshed !== 1 ? 's' : ''} refreshed` +
        ` — ${uniqueCustomers} customers total.`,
      )
      setStep('success')
      queryClient.invalidateQueries({ queryKey: ['task_stats_upload'] })
      queryClient.invalidateQueries({ queryKey: ['tasks'] })
      queryClient.invalidateQueries({ queryKey: ['erp_uploads'] })
    } catch (e) {
      toast.error(`Push failed: ${(e as Error).message}`)
      setStep('preview')
    }
  }

  // ── Derived ───────────────────────────────────────────────────────────────

  const allPreviewTasks  = previewStores.flatMap((s) => s.tasks)
  const uniqueCustomers  = new Set(allPreviewTasks.map((t) => t.customer_phone)).size
  const anyMatchedSheets = sheetMatches.some((m) => m.matched)
  const canParse =
    (mode === 'single' && !!file && !!selectedStoreId && step === 'file-ready') ||
    (mode === 'bulk'   && step === 'detected' && anyMatchedSheets)

  const showUploadCard = ['idle', 'file-ready', 'detecting', 'detected'].includes(step)

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Parse ERP data and push follow-up tasks to store teams
      </p>

      {/* ── Template download ── */}
      {step !== 'success' && (
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-gray-800">Download Template</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Download and fill this template before uploading. Do not change column headers.
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={downloadTemplate} className="shrink-0 gap-2">
                <Download className="h-3.5 w-3.5" />
                Download Template
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Stat cards ── */}
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatCard icon={ClipboardList} label="Pending"   value={stats?.pending   ?? 0} iconBg="bg-[#E8642C]"    />
        <StatCard icon={Clock}         label="Due Today" value={stats?.dueToday  ?? 0} iconBg="bg-orange-400"   />
        <StatCard icon={CheckCircle2}  label="Completed" value={stats?.completed ?? 0} iconBg="bg-emerald-500"  />
        <StatCard icon={AlertTriangle} label="Overdue"   value={stats?.overdue   ?? 0} iconBg="bg-red-500"      />
      </div>

      {/* ── Mode toggle ── */}
      {step !== 'success' && (
        <div className="inline-flex rounded-full bg-gray-100 p-0.5">
          {(['single', 'bulk'] as const).map((m) => (
            <button
              key={m}
              onClick={() => switchMode(m)}
              className={cn(
                'rounded-full px-4 py-1.5 text-xs font-semibold transition-all',
                mode === m ? 'bg-[#E8642C] text-white shadow-sm' : 'text-gray-500 hover:text-gray-700',
              )}
            >
              {m === 'single' ? 'Single Store' : 'Bulk Upload (Multi-sheet Excel)'}
            </button>
          ))}
        </div>
      )}

      {/* ── Upload card ── */}
      {showUploadCard && (
        <Card>
          <CardContent className="space-y-5 pt-6 pb-6">
            {mode === 'single' ? (
              <>
                <div className="space-y-1.5">
                  <Label className="text-xs">Store</Label>
                  <Select value={selectedStoreId ?? ''} onValueChange={setSelectedStoreId}>
                    <SelectTrigger className="w-64">
                      <SelectValue placeholder="Select a store…" />
                    </SelectTrigger>
                    <SelectContent>
                      {stores.map((s) => (
                        <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <DropZone
                  file={file} accept=".csv,.xlsx"
                  onFile={handleFileSelected}
                  disabled={!selectedStoreId}
                />

                {parseError && (
                  <p className="flex items-center gap-1.5 text-xs text-red-600">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {parseError}
                  </p>
                )}

                {canParse && (
                  <Button onClick={handleParse} className="bg-[#E8642C] hover:bg-[#CF5826] text-white">
                    Parse &amp; Preview
                  </Button>
                )}
              </>
            ) : (
              <>
                <div className="flex items-start gap-2 rounded-lg bg-blue-50 px-3 py-2.5 text-xs text-blue-700">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-400" />
                  Upload one Excel file with multiple sheets.
                  Each sheet name must match a store name <em>exactly</em>.
                </div>

                <DropZone file={file} accept=".xlsx" onFile={handleFileSelected} />

                {step === 'detecting' && (
                  <p className="animate-pulse text-xs text-muted-foreground">Detecting sheets…</p>
                )}

                {step === 'detected' && sheetMatches.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-xs font-medium text-gray-700">Detected sheets:</p>
                    {sheetMatches.map((m) => (
                      <div key={m.sheetName} className="flex items-center gap-2 text-xs">
                        {m.matched
                          ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                          : <XCircle className="h-3.5 w-3.5 text-gray-300" />
                        }
                        <span className={m.matched ? 'font-medium text-gray-800' : 'text-muted-foreground'}>
                          "{m.sheetName}"
                        </span>
                        {m.matched
                          ? <span className="text-emerald-600">— matched to {m.storeName}</span>
                          : <span className="text-muted-foreground">— no matching store (will be skipped)</span>
                        }
                      </div>
                    ))}
                  </div>
                )}

                {parseError && (
                  <p className="flex items-center gap-1.5 text-xs text-red-600">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {parseError}
                  </p>
                )}

                {canParse && (
                  <Button onClick={handleParse} className="bg-[#E8642C] hover:bg-[#CF5826] text-white">
                    Parse All Sheets &amp; Preview
                  </Button>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Parsing spinner ── */}
      {step === 'parsing' && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-3 py-14">
            <RefreshCw className="h-6 w-6 animate-spin text-[#E8642C]" />
            <p className="text-sm font-medium text-gray-700">Parsing file…</p>
            <p className="text-xs text-muted-foreground">This may take a moment for large files</p>
          </CardContent>
        </Card>
      )}

      {/* ── Preview ── */}
      {step === 'preview' && previewStores.length > 0 && (
        <div className="space-y-4">
          <div className="rounded-lg border border-orange-200 bg-orange-50 px-4 py-2.5 text-sm text-orange-800">
            Found <strong>{allPreviewTasks.length}</strong> tasks across{' '}
            <strong>{previewStores.length}</strong> {previewStores.length === 1 ? 'store' : 'stores'} from{' '}
            <strong>{uniqueCustomers}</strong> customers
            {upsertCounts && (
              <span className="ml-2 text-xs text-orange-700">
                · <strong>{upsertCounts.toInsert}</strong> new · <strong>{upsertCounts.toUpdate}</strong> refreshing existing
              </span>
            )}
          </div>

          <Tabs defaultValue={previewStores[0]?.storeId}>
            <TabsList className="h-9 flex-wrap gap-1">
              {previewStores.map((ps) => (
                <TabsTrigger key={ps.storeId} value={ps.storeId} className="text-xs">
                  {ps.storeName} ({ps.tasks.length})
                </TabsTrigger>
              ))}
            </TabsList>

            {previewStores.map((ps) => {
              const groups = groupByCustomer(ps.tasks, ps.storeId)
              return (
                <TabsContent key={ps.storeId} value={ps.storeId} className="mt-3">
                  {ps.tasks.length === 0 ? (
                    <p className="py-8 text-center text-sm text-muted-foreground">No tasks generated</p>
                  ) : (
                    <div className="space-y-1.5">
                      <p className="text-xs text-muted-foreground">
                        <strong>{groups.length}</strong> customer{groups.length !== 1 ? 's' : ''}{' '}
                        · <strong>{ps.tasks.length}</strong> product{ps.tasks.length !== 1 ? 's' : ''}
                      </p>
                      <div className="max-h-[420px] overflow-auto space-y-2 pr-0.5">
                        {groups.map((group) => (
                          <div key={group.key} className="overflow-hidden rounded-lg border border-gray-200 bg-white">
                            {/* Customer header */}
                            <div
                              className="flex cursor-pointer items-start gap-3 px-4 py-3 hover:bg-gray-50"
                              onClick={() => toggleCustomer(group.key)}
                            >
                              <span className="mt-0.5 shrink-0">
                                {expandedCustomers.has(group.key)
                                  ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
                                  : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
                              </span>
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-3">
                                  <span className="font-semibold text-gray-900">{group.name}</span>
                                  <span className="text-sm text-gray-500">{group.phone}</span>
                                  <span className="text-sm text-gray-400">
                                    {group.tasks.length} product{group.tasks.length !== 1 ? 's' : ''}
                                  </span>
                                </div>
                                <div className="mt-1.5 flex flex-wrap gap-1">
                                  {group.types.map((type) => <TaskTypeBadge key={type} type={type} />)}
                                </div>
                              </div>
                            </div>
                            {/* Expanded product table */}
                            {expandedCustomers.has(group.key) && (
                              <div className="border-t border-gray-100">
                                <table className="w-full text-xs">
                                  <thead>
                                    <tr className="bg-gray-50">
                                      <th className="px-4 py-2 text-left font-medium text-gray-500">Product</th>
                                      <th className="px-3 py-2 text-left font-medium text-gray-500">Weight</th>
                                      <th className="px-3 py-2 text-left font-medium text-gray-500">Last Purchase</th>
                                      <th className="px-3 py-2 text-left font-medium text-gray-500">1st Follow-up</th>
                                      <th className="px-3 py-2 text-left font-medium text-gray-500">2nd Follow-up</th>
                                      <th className="px-4 py-2 text-left font-medium text-gray-500">Runs Out</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-gray-50">
                                    {group.tasks.map((t, i) => {
                                      const name = t.product_name ?? '–'
                                      const display = name.length > 30 ? name.slice(0, 30) + '…' : name
                                      return (
                                        <tr key={i} className="hover:bg-gray-50/50">
                                          <td className="px-4 py-2 text-muted-foreground" title={name}>{display}</td>
                                          <td className="px-3 py-2 text-muted-foreground">{t.product_weight ?? '–'}</td>
                                          <td className="px-3 py-2 text-muted-foreground">{fmtDate((t as any).last_purchase_date)}</td>
                                          <td className="px-3 py-2 text-muted-foreground">
                                            {(t as any).followup_t_minus_4
                                              ? <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3 shrink-0" />{fmtDate((t as any).followup_t_minus_4)}</span>
                                              : '–'}
                                          </td>
                                          <td className="px-3 py-2 text-muted-foreground">
                                            {(t as any).followup_t_minus_2
                                              ? <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3 shrink-0" />{fmtDate((t as any).followup_t_minus_2)}</span>
                                              : '–'}
                                          </td>
                                          <td className="px-4 py-2">
                                            <RunsOutCell date={t.predicted_finish_date} />
                                          </td>
                                        </tr>
                                      )
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </TabsContent>
              )
            })}
          </Tabs>

          <div className="flex items-center gap-3">
            <Button variant="outline" onClick={handleClear}>Clear</Button>
            <Button
              onClick={() => setPushOpen(true)}
              className="bg-emerald-600 hover:bg-emerald-700 text-white px-6"
            >
              Push to Store{previewStores.length > 1 ? 's' : ''} →
            </Button>
          </div>
        </div>
      )}

      {/* ── Pushing progress ── */}
      {step === 'pushing' && (
        <Card>
          <CardContent className="space-y-3 py-12">
            <p className="text-center text-sm font-medium text-gray-700">
              Inserting tasks… {pushProgress} / {pushTotal}
            </p>
            <Progress
              value={pushTotal > 0 ? Math.round((pushProgress / pushTotal) * 100) : 0}
              className="mx-auto max-w-xs"
            />
          </CardContent>
        </Card>
      )}

      {/* ── Success ── */}
      {step === 'success' && (
        <div className="space-y-4">
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-4">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
              <div>
                <p className="text-sm font-semibold text-emerald-800">Upload successful!</p>
                <p className="mt-0.5 text-xs text-emerald-700">{successMsg}</p>
              </div>
            </div>
          </div>
          <Button variant="outline" onClick={() => { handleClear(); setSuccessMsg(null) }}>
            Upload another file
          </Button>
        </div>
      )}

      {/* ── Push confirmation dialog ── */}
      <Dialog open={pushOpen} onOpenChange={setPushOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm">
              Confirm Push to Store{previewStores.length > 1 ? 's' : ''}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-1">
            <div className="space-y-1">
              <p className="text-xs font-medium text-gray-700">Pushing to:</p>
              {previewStores.map((ps) => (
                <div key={ps.storeId} className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-1.5 text-xs">
                  <span className="font-medium">{ps.storeName}</span>
                  <span className="text-muted-foreground">{ps.tasks.length} tasks</span>
                </div>
              ))}
              <p className="pt-1 text-xs text-muted-foreground">
                Total: <strong>{allPreviewTasks.length} tasks</strong> for {uniqueCustomers} customers
              </p>
            </div>

            <ul className="space-y-1.5 text-xs text-gray-700">
              <li className="flex items-center gap-2">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
                <strong>{upsertCounts?.toInsert ?? allPreviewTasks.length}</strong> new customers will be added
              </li>
              <li className="flex items-center gap-2">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-orange-400" />
                <strong>{upsertCounts?.toUpdate ?? 0}</strong> existing pending tasks will be refreshed
              </li>
              <li className="flex items-center gap-2">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-gray-300" />
                Completed tasks are preserved
              </li>
            </ul>
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" size="sm">Cancel</Button>
            </DialogClose>
            <Button size="sm" onClick={handlePush} className="bg-emerald-600 hover:bg-emerald-700 text-white">
              Confirm &amp; Push
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
