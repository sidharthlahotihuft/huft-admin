import { useState, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Search, RotateCcw, Eye, AlertTriangle, Clock, ChevronDown, ChevronUp } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose,
} from '@/components/ui/dialog'
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from '@/components/ui/sheet'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

// ─── Types ────────────────────────────────────────────────────────────────────

type Upload = {
  id: string
  store_id: string | null
  store_name: string | null
  uploaded_by_name: string | null
  filename: string
  tasks_created: number
  upload_type: 'single' | 'bulk'
  created_at: string
}

type TaskRow = {
  id: string
  customer_name: string | null
  customer_phone: string | null
  product_name: string | null
  product_weight: string | null
  task_type: string
  status: string
  due_date: string | null
  last_purchase_date: string | null
  followup_t_minus_4: string | null
  followup_t_minus_2: string | null
  predicted_finish_date: string | null
}

type CustomerGroup = {
  key: string
  name: string
  phone: string
  tasks: TaskRow[]
  types: string[]
}

function groupByCustomer(tasks: TaskRow[], prefix: string): CustomerGroup[] {
  const map = new Map<string, CustomerGroup>()
  for (const t of tasks) {
    const k = `${prefix}::${t.customer_phone ?? ''}::${t.customer_name ?? ''}`
    if (!map.has(k)) map.set(k, { key: k, name: t.customer_name ?? '–', phone: t.customer_phone ?? '', tasks: [], types: [] })
    const g = map.get(k)!
    g.tasks.push(t)
    if (!g.types.includes(t.task_type)) g.types.push(t.task_type)
  }
  return Array.from(map.values())
}

type StoreMin = { id: string; name: string }

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDateTime(iso: string) {
  const d    = new Date(iso)
  const date = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  const time = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })
  return `${date}, ${time}`
}

function fmtDate(iso: string | null | undefined) {
  if (!iso) return '–'
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

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

function useUploads() {
  return useQuery<Upload[]>({
    queryKey: ['erp_uploads'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('erp_uploads')
        .select('*')
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as Upload[]
    },
    staleTime: 30_000,
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

function useBatchTasks(batchId: string | null) {
  return useQuery<TaskRow[]>({
    queryKey: ['batch_tasks', batchId],
    queryFn: async () => {
      if (!batchId) return []
      const { data, error } = await supabase
        .from('tasks')
        .select('id, customer_name, customer_phone, product_name, product_weight, task_type, status, due_date, last_purchase_date, followup_t_minus_4, followup_t_minus_2, predicted_finish_date')
        .eq('upload_batch_id', batchId)
        .order('due_date')
      if (error) throw error
      return (data ?? []) as TaskRow[]
    },
    enabled: !!batchId,
    staleTime: 10_000,
  })
}

function useRollbackStats(batchId: string | null) {
  return useQuery<{ pending: number; done: number; total: number }>({
    queryKey: ['rollback_stats', batchId],
    queryFn: async () => {
      if (!batchId) return { pending: 0, done: 0, total: 0 }
      const { data, error } = await supabase
        .from('tasks')
        .select('status')
        .eq('upload_batch_id', batchId)
      if (error) throw error
      const rows = (data ?? []) as Array<{ status: string }>
      return {
        pending: rows.filter((r) => r.status === 'pending').length,
        done:    rows.filter((r) => r.status === 'done').length,
        total:   rows.length,
      }
    },
    enabled: !!batchId,
    staleTime: 10_000,
  })
}

// ─── Small components ─────────────────────────────────────────────────────────

function TableSkeleton() {
  return (
    <div className="space-y-3 p-5">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="h-3 animate-pulse rounded bg-gray-100"
          style={{ width: `${[80, 60, 70, 55, 75][i]}%` }} />
      ))}
    </div>
  )
}

function TypeBadge({ type }: { type: 'single' | 'bulk' }) {
  return type === 'bulk'
    ? <Badge variant="outline" className="border-blue-200 bg-blue-50 text-blue-700 text-[10px]">Bulk</Badge>
    : <Badge variant="outline" className="border-gray-200 bg-gray-50 text-gray-600 text-[10px]">Single</Badge>
}

const TASK_TYPE_CFG: Record<string, { label: string; cls: string }> = {
  reorder:       { label: 'Reorder',       cls: 'border-orange-200 bg-orange-50 text-orange-700' },
  winback:       { label: 'Win Back',       cls: 'border-blue-200 bg-blue-50 text-blue-700'      },
  pattern_break: { label: 'Pattern Break', cls: 'border-red-200 bg-red-50 text-red-700'          },
}

function TaskTypeBadge({ type }: { type: string }) {
  const cfg = TASK_TYPE_CFG[type] ?? { label: type, cls: 'border-gray-200 bg-gray-50 text-gray-600' }
  return <Badge variant="outline" className={cn('text-[10px]', cfg.cls)}>{cfg.label}</Badge>
}

function StatusBadge({ status }: { status: string }) {
  return status === 'done'
    ? <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700 text-[10px]">Done</Badge>
    : <Badge variant="outline" className="border-orange-200 bg-orange-50 text-orange-700 text-[10px]">Pending</Badge>
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function UploadHistoryPage() {
  const queryClient = useQueryClient()

  const [storeFilter, setStoreFilter]     = useState('all')
  const [searchQuery, setSearchQuery]     = useState('')
  const [viewUploadId, setViewUploadId]   = useState<string | null>(null)
  const [taskStatusTab, setTaskStatusTab] = useState<'all' | 'pending' | 'done'>('all')
  const [rollbackUpload, setRollbackUpload] = useState<Upload | null>(null)
  const [rollingBack, setRollingBack]       = useState(false)

  const [expandedCustomers, setExpandedCustomers] = useState<Set<string>>(() => new Set())

  function toggleCustomer(key: string) {
    setExpandedCustomers((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const { data: uploads = [],   isLoading }      = useUploads()
  const { data: stores  = [] }                   = useStores()
  const { data: sheetTasks = [], isLoading: tasksLoading } = useBatchTasks(viewUploadId)
  const { data: rollbackStats, isLoading: statsLoading }   = useRollbackStats(rollbackUpload?.id ?? null)

  const filteredUploads = useMemo(() => {
    let result = uploads
    if (storeFilter !== 'all') {
      result = result.filter((u) => u.store_id === storeFilter)
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      result = result.filter(
        (u) => u.filename.toLowerCase().includes(q)
            || (u.uploaded_by_name ?? '').toLowerCase().includes(q),
      )
    }
    return result
  }, [uploads, storeFilter, searchQuery])

  const pendingCount = useMemo(() => sheetTasks.filter((t) => t.status === 'pending').length, [sheetTasks])
  const doneCount    = useMemo(() => sheetTasks.filter((t) => t.status === 'done').length,    [sheetTasks])

  const filteredTasks = useMemo(() => {
    if (taskStatusTab === 'pending') return sheetTasks.filter((t) => t.status === 'pending')
    if (taskStatusTab === 'done')    return sheetTasks.filter((t) => t.status === 'done')
    return sheetTasks
  }, [sheetTasks, taskStatusTab])

  const groupedCustomers = useMemo(
    () => groupByCustomer(filteredTasks, viewUploadId ?? ''),
    [filteredTasks, viewUploadId],
  )

  const viewUpload = useMemo(
    () => uploads.find((u) => u.id === viewUploadId) ?? null,
    [uploads, viewUploadId],
  )

  // ── Rollback ───────────────────────────────────────────────────────────────

  async function handleRollback() {
    if (!rollbackUpload) return

    const uploadId = rollbackUpload.id
    if (!uploadId) {
      toast.error('Upload ID missing — cannot rollback')
      return
    }

    console.log('Rolling back upload:', uploadId)
    setRollingBack(true)

    // First delete tasks linked to this upload
    const { error: tasksError } = await supabase
      .from('tasks').delete().eq('upload_batch_id', uploadId)

    if (tasksError) {
      toast.error(`Rollback failed: ${tasksError.message}`)
      setRollingBack(false)
      return
    }

    // Then delete the upload record itself
    const { error: uploadsError } = await supabase
      .from('erp_uploads').delete().eq('id', uploadId)

    if (uploadsError) {
      toast.error(`Failed to remove upload record: ${uploadsError.message}`)
      setRollingBack(false)
      return
    }

    const deleted = rollbackStats?.total ?? 0
    toast.success(`Rolled back "${rollbackUpload.filename}" — ${deleted} task${deleted !== 1 ? 's' : ''} deleted`)
    setRollingBack(false)
    setRollbackUpload(null)
    queryClient.invalidateQueries({ queryKey: ['erp_uploads'] })
    queryClient.invalidateQueries({ queryKey: ['tasks'] })
    queryClient.invalidateQueries({ queryKey: ['task_stats_upload'] })
  }

  // ──────────────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm text-muted-foreground">Track and manage all ERP data uploads</p>
      </div>

      {/* ── Filter bar ── */}
      <div className="flex flex-wrap items-center gap-3">
        <Select value={storeFilter} onValueChange={setStoreFilter}>
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Stores</SelectItem>
            {stores.map((s) => (
              <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="relative max-w-xs flex-1">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search filename or uploader…"
            className="h-9 pl-8 text-xs"
          />
        </div>
      </div>

      {/* ── History table ── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">Upload History</CardTitle>
        </CardHeader>
        <CardContent className="px-0 pb-1">
          {isLoading ? <TableSkeleton /> : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-5">Upload Date</TableHead>
                  <TableHead>Store</TableHead>
                  <TableHead>Filename</TableHead>
                  <TableHead>Tasks Created</TableHead>
                  <TableHead>Uploaded By</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="pr-5 w-40">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredUploads.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="py-16 text-center">
                      {uploads.length === 0 ? (
                        <div className="flex flex-col items-center gap-2.5">
                          <Clock className="h-8 w-8 text-gray-200" />
                          <p className="text-sm text-muted-foreground">
                            No uploads yet. Go to{' '}
                            <span className="font-medium text-gray-700">ERP Upload</span>{' '}
                            to push your first tasks.
                          </p>
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground">No uploads match your filters.</p>
                      )}
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredUploads.map((upload) => (
                    <TableRow key={upload.id} className="group">
                      <TableCell className="pl-5 text-xs text-muted-foreground whitespace-nowrap">
                        {fmtDateTime(upload.created_at)}
                      </TableCell>
                      <TableCell className="text-sm font-medium">
                        {upload.store_name ?? '–'}
                      </TableCell>
                      <TableCell
                        className="max-w-[180px] truncate text-xs text-muted-foreground"
                        title={upload.filename}
                      >
                        {upload.filename}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="border-gray-200 bg-gray-50 text-gray-700 text-[10px]">
                          {upload.tasks_created}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {upload.uploaded_by_name ?? '–'}
                      </TableCell>
                      <TableCell>
                        <TypeBadge type={upload.upload_type} />
                      </TableCell>
                      <TableCell className="pr-5">
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost" size="sm"
                            onClick={() => { setViewUploadId(upload.id); setTaskStatusTab('all') }}
                            className="h-7 gap-1.5 px-2.5 text-xs text-gray-500 hover:text-gray-900"
                          >
                            <Eye className="h-3.5 w-3.5" /> View Tasks
                          </Button>
                          <Button
                            variant="ghost" size="sm"
                            onClick={() => setRollbackUpload(upload)}
                            className="h-7 gap-1.5 px-2.5 text-xs text-red-500 hover:bg-red-50 hover:text-red-700"
                          >
                            <RotateCcw className="h-3.5 w-3.5" /> Rollback
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* ── View Tasks side sheet ── */}
      <Sheet open={!!viewUploadId} onOpenChange={(open) => { if (!open) setViewUploadId(null) }}>
        <SheetContent side="right" className="flex flex-col gap-0 p-0 sm:max-w-xl">
          <SheetHeader className="border-b px-5 py-4">
            <SheetTitle className="text-sm font-semibold truncate pr-8">
              Tasks — {viewUpload?.filename ?? ''}
            </SheetTitle>
            {viewUpload && (
              <p className="text-xs text-muted-foreground">
                {fmtDateTime(viewUpload.created_at)} · {viewUpload.store_name ?? '–'}
              </p>
            )}
          </SheetHeader>

          <div className="flex flex-col flex-1 overflow-hidden">
            {/* Status filter pills */}
            <div className="flex items-center gap-1.5 border-b px-5 py-2.5">
              {(['all', 'pending', 'done'] as const).map((tab) => {
                const count = tab === 'all' ? sheetTasks.length : tab === 'pending' ? pendingCount : doneCount
                return (
                  <button
                    key={tab}
                    onClick={() => setTaskStatusTab(tab)}
                    className={cn(
                      'rounded-full px-3 py-1 text-xs font-medium transition-colors',
                      taskStatusTab === tab
                        ? 'bg-gray-900 text-white'
                        : 'text-muted-foreground hover:text-gray-700',
                    )}
                  >
                    {tab.charAt(0).toUpperCase() + tab.slice(1)}
                    <span className="ml-1 opacity-60">({count})</span>
                  </button>
                )
              })}
            </div>

            {/* Tasks table */}
            <div className="flex-1 overflow-auto">
              {tasksLoading ? (
                <div className="space-y-3 p-5">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="h-3 animate-pulse rounded bg-gray-100"
                      style={{ width: `${[70, 85, 60, 75, 65, 80][i]}%` }} />
                  ))}
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-5">Customer</TableHead>
                      <TableHead>Product</TableHead>
                      <TableHead>Weight</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>1st Follow-up</TableHead>
                      <TableHead>2nd Follow-up</TableHead>
                      <TableHead className="pr-5">Runs Out</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredTasks.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={8} className="py-10 text-center text-sm text-muted-foreground">
                          No tasks found
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredTasks.map((task) => (
                        <TableRow key={task.id}>
                          <TableCell className="pl-5">
                            <p className="text-xs font-medium text-gray-900">{task.customer_name ?? '–'}</p>
                            {task.customer_phone && (
                              <p className="text-[10px] text-muted-foreground">{task.customer_phone}</p>
                            )}
                          </TableCell>
                          <TableCell
                            className="max-w-[120px] truncate text-xs text-muted-foreground"
                            title={task.product_name ?? ''}
                          >
                            {task.product_name ?? '–'}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">{task.product_weight ?? '–'}</TableCell>
                          <TableCell><TaskTypeBadge type={task.task_type} /></TableCell>
                          <TableCell><StatusBadge status={task.status} /></TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {task.followup_t_minus_4
                              ? <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3 shrink-0" />{fmtDate(task.followup_t_minus_4)}</span>
                              : '–'}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {task.followup_t_minus_2
                              ? <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3 shrink-0" />{fmtDate(task.followup_t_minus_2)}</span>
                              : '–'}
                          </TableCell>
                          <TableCell className="pr-5 text-xs">
                            <RunsOutCell date={task.predicted_finish_date} />
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              )}
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* ── Rollback confirmation dialog ── */}
      <Dialog
        open={!!rollbackUpload}
        onOpenChange={(open) => { if (!open && !rollingBack) setRollbackUpload(null) }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <AlertTriangle className="h-4 w-4 shrink-0 text-red-500" />
              Confirm Rollback
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-1">
            {/* Main warning */}
            <div className="rounded-lg border border-red-100 bg-red-50 px-4 py-3 space-y-1">
              <p className="text-xs font-medium text-red-800">
                This will delete{' '}
                <strong>{statsLoading ? '…' : (rollbackStats?.total ?? 0)}</strong>{' '}
                tasks generated from{' '}
                <strong className="break-all">{rollbackUpload?.filename}</strong>{' '}
                on {rollbackUpload ? fmtDateTime(rollbackUpload.created_at) : ''}.
              </p>
              <p className="text-xs text-red-700">This cannot be undone.</p>
            </div>

            {/* Pending / Done breakdown */}
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2.5 text-center">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Pending</p>
                <p className="mt-0.5 text-xl font-bold text-gray-900">
                  {statsLoading ? '…' : (rollbackStats?.pending ?? 0)}
                </p>
              </div>
              <div className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2.5 text-center">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Done</p>
                <p className="mt-0.5 text-xl font-bold text-gray-900">
                  {statsLoading ? '…' : (rollbackStats?.done ?? 0)}
                </p>
              </div>
            </div>

            {/* Extra warning when completed tasks exist */}
            {!statsLoading && !!rollbackStats?.done && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
                <p className="text-xs text-amber-800">
                  <strong>{rollbackStats.done}</strong> completed task
                  {rollbackStats.done !== 1 ? 's' : ''} will also be deleted.
                </p>
              </div>
            )}
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" size="sm" disabled={rollingBack}>Cancel</Button>
            </DialogClose>
            <Button
              size="sm"
              onClick={handleRollback}
              disabled={rollingBack || statsLoading}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {rollingBack ? 'Rolling back…' : 'Yes, rollback'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
