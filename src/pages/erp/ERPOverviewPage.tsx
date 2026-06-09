import { useState, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import * as XLSX from 'xlsx'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  PieChart, Pie, Cell, Legend, ResponsiveContainer,
} from 'recharts'
import { ClipboardList, Clock, CheckCircle2, AlertTriangle, RefreshCw, Download } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import type { ComponentType } from 'react'

// ─── Types ────────────────────────────────────────────────────────────────────

type Filter = 'today' | 'week' | 'month'
type DateRange = { from: string; to: string }

type TaskMin = {
  id: string; store_id: string
  status: 'pending' | 'done' | 'skipped'
  due_date: string | null; task_type: string; updated_at: string | null
  customer_name: string; customer_phone: string | null
  notes: string | null; product_name: string | null; created_at: string
  call_outcome: string | null
  snoozed_until: string | null
}
type StoreMin = { id: string; name: string }

// ─── Filter config ────────────────────────────────────────────────────────────

const FILTERS: Filter[] = ['today', 'week', 'month']
const FILTER_LABELS: Record<Filter, string> = { today: 'Today', week: 'This Week', month: 'This Month' }

// ─── Date helpers ─────────────────────────────────────────────────────────────

function getDateRange(filter: Filter): DateRange {
  const now = new Date()
  const todayStr = now.toISOString().split('T')[0]
  if (filter === 'today') return { from: todayStr, to: todayStr }
  if (filter === 'week') {
    const day = now.getDay()
    const mon = new Date(now)
    mon.setDate(now.getDate() - (day === 0 ? 6 : day - 1))
    mon.setHours(0, 0, 0, 0)
    const sun = new Date(mon); sun.setDate(mon.getDate() + 6)
    return { from: mon.toISOString().split('T')[0], to: sun.toISOString().split('T')[0] }
  }
  return {
    from: new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0],
    to: new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0],
  }
}

function todayStr() { return new Date().toISOString().split('T')[0] }
function fmtTime(ts: number) {
  if (!ts) return ''
  return new Date(ts).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
}
function fmtDate(iso: string | null) {
  if (!iso) return '–'
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

// ─── Queries ──────────────────────────────────────────────────────────────────

function useTasks(filter: Filter) {
  return useQuery<TaskMin[]>({
    queryKey: ['tasks', filter],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tasks')
        .select('id, store_id, status, due_date, task_type, updated_at, customer_name, customer_phone, notes, product_name, created_at, call_outcome, snoozed_until')
      if (error) throw error
      return (data ?? []) as TaskMin[]
    },
    staleTime: 60_000,
  })
}
function useStores() {
  return useQuery<StoreMin[]>({
    queryKey: ['stores'],
    queryFn: async () => {
      const { data, error } = await supabase.from('stores').select('id, name')
      if (error) throw error
      return (data ?? []) as StoreMin[]
    },
    staleTime: 5 * 60_000,
  })
}

// ─── Range predicates ─────────────────────────────────────────────────────────

function inDueDateRange(t: TaskMin, range: DateRange) {
  return t.due_date != null && t.due_date >= range.from && t.due_date <= range.to
}
function inUpdatedRange(t: TaskMin, range: DateRange) {
  if (!t.updated_at) return false
  const d = t.updated_at.split('T')[0]
  return d >= range.from && d <= range.to
}
function taskInPeriod(t: TaskMin, range: DateRange): boolean {
  if (t.status === 'pending') return inDueDateRange(t, range)
  if (t.status === 'done')    return inUpdatedRange(t, range)
  return false
}

// ─── Outcome helpers ──────────────────────────────────────────────────────────

const NEGATIVE_KEYWORDS = [
  'no_answer', 'no answer', 'not_interested', 'not interested',
  'wrong_number', 'wrong number', 'call_later', 'call later',
]

function hasNegativeOutcome(notes: string | null): boolean {
  if (!notes) return false
  const n = notes.toLowerCase()
  return NEGATIVE_KEYWORDS.some((k) => n.includes(k))
}

function parseOutcome(notes: string | null, callOutcome?: string | null): string {
  if (callOutcome && callOutcome.trim()) return callOutcome
  if (!notes || !notes.trim()) return 'Other'
  const n = notes.toLowerCase()
  if (n.includes('not interested'))     return 'Not interested'
  if (n.includes('will purchase soon')) return 'Will purchase soon'
  if (n.includes('purchased'))          return 'Purchased'
  if (n.includes('call unanswered'))    return 'Call unanswered'
  if (n.includes('call back'))          return 'Call back'
  if (n.includes('interested'))         return 'Purchased'
  if (n.includes('already bought'))     return 'Purchased'
  if (n.includes('no answer'))          return 'Call unanswered'
  if (n.includes('wrong number'))       return 'Call unanswered'
  if (n.includes('call later'))         return 'Call back'
  return 'Other'
}

const OUTCOME_COLOR: Record<string, string> = {
  'Purchased':          '#10B981',
  'Will purchase soon': '#3B82F6',
  'Not interested':     '#EF4444',
  'Call unanswered':    '#9CA3AF',
  'Call back':          '#F59E0B',
  'Other':              '#D1D5DB',
}
const OUTCOME_BADGE: Record<string, string> = {
  'Purchased':          'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-50',
  'Will purchase soon': 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-50',
  'Not interested':     'bg-red-50 text-red-700 border-red-200 hover:bg-red-50',
  'Call unanswered':    'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-50',
  'Call back':          'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-50',
  'Other':              'bg-gray-50 text-gray-500 border-gray-100 hover:bg-gray-50',
}

// ─── Task type display config ──────────────────────────────────────────────────

const TYPE_LABEL: Record<string, string> = {
  reorder: 'Reorder', winback: 'Win Back', pattern_break: 'Pattern Break', other: 'Other',
}
const TYPE_BADGE: Record<string, string> = {
  reorder:       'bg-orange-50 text-orange-700 border-orange-200 hover:bg-orange-50',
  winback:       'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-50',
  pattern_break: 'bg-red-50 text-red-700 border-red-200 hover:bg-red-50',
  other:         'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-50',
}

// ─── Existing pie config ──────────────────────────────────────────────────────

const PIE_CFG: Record<string, { label: string; color: string }> = {
  reorder:       { label: 'Reorder',       color: '#F97316' },
  winback:       { label: 'Win Back',       color: '#FB923C' },
  pattern_break: { label: 'Pattern Break',  color: '#FDBA74' },
  other:         { label: 'Other',          color: '#9CA3AF' },
}
const OTHER_TYPES = new Set(['checkin', 'upsell', 'high_value', 'cart_growth'])

// ─── UI primitives ────────────────────────────────────────────────────────────

function KpiCard({ icon: Icon, label, value, sub, iconBg }: {
  icon: ComponentType<{ className?: string }>; label: string
  value: string | number; sub: string; iconBg: string
}) {
  return (
    <Card>
      <CardContent className="pb-5 pt-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">{label}</p>
            <p className="mt-2 text-3xl font-bold tracking-tight text-gray-900">{value}</p>
            <p className="mt-1 text-xs text-muted-foreground">{sub}</p>
          </div>
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${iconBg}`}>
            <Icon className="h-5 w-5 text-white" />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function ProgressRing({ pct }: { pct: number }) {
  const r = 34
  const circ = 2 * Math.PI * r
  const offset = circ - (Math.min(pct, 100) / 100) * circ
  const color = pct >= 70 ? '#10B981' : pct >= 40 ? '#F59E0B' : '#EF4444'
  const textCls = pct >= 70 ? 'text-emerald-600' : pct >= 40 ? 'text-amber-500' : 'text-red-500'
  return (
    <div className="relative flex h-[84px] w-[84px] shrink-0 items-center justify-center">
      <svg width={84} height={84} className="absolute inset-0 -rotate-90">
        <circle cx={42} cy={42} r={r} fill="none" stroke="#f3f4f6" strokeWidth={7} />
        <circle cx={42} cy={42} r={r} fill="none" stroke={color} strokeWidth={7}
          strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 0.4s ease' }} />
      </svg>
      <span className={cn('text-xl font-bold', textCls)}>{pct}%</span>
    </div>
  )
}

function SkeletonBlock({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-gray-100', className)} />
}
function InsightSkeleton() {
  return (
    <div className="space-y-2.5 p-5">
      {[3, 5, 4, 5, 3].map((w, i) => (
        <SkeletonBlock key={i} className={`h-3.5 w-${w}/6`} />
      ))}
    </div>
  )
}

function EmptyChart() {
  return <div className="flex h-[240px] items-center justify-center text-sm text-muted-foreground">No data yet</div>
}
function EmptyRow({ cols, message }: { cols: number; message: string }) {
  return (
    <TableRow>
      <TableCell colSpan={cols} className="py-8 text-center text-sm text-muted-foreground">{message}</TableCell>
    </TableRow>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function ERPOverviewPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [filter, setFilter] = useState<Filter>('today')
  const [trendPeriod, setTrendPeriod] = useState<'weekly' | 'monthly'>('weekly')
  const [isDownloadingTrend, setIsDownloadingTrend] = useState(false)

  const { data: tasks = [], dataUpdatedAt: tasksTs, isLoading: tL } = useTasks(filter)
  const { data: stores = [], isLoading: sL } = useStores()
  const today = useMemo(todayStr, [])
  const range = useMemo(() => getDateRange(filter), [filter])
  const isLoading = tL || sL

  // ── KPI 1 & 4: filter-independent ──
  const totalPending = useMemo(() => tasks.filter((t) => t.status === 'pending').length, [tasks])
  const overdue = useMemo(
    () => tasks.filter((t) => t.status === 'pending' && t.due_date != null && t.due_date < today).length,
    [tasks, today],
  )

  // ── KPI 2 & 3: period-scoped ──
  const dueInPeriod = useMemo(
    () => tasks.filter((t) => t.status === 'pending' && inDueDateRange(t, range)).length,
    [tasks, range],
  )
  const completedInPeriod = useMemo(
    () => tasks.filter((t) => t.status === 'done' && inUpdatedRange(t, range)).length,
    [tasks, range],
  )

  // ── Bar chart: pending in period per store, top 10 ──
  const barData = useMemo(() => {
    const nameMap = new Map(stores.map((s) => [s.id, s.name]))
    const counts = new Map<string, number>()
    for (const t of tasks) {
      if (t.status === 'pending' && inDueDateRange(t, range))
        counts.set(t.store_id, (counts.get(t.store_id) ?? 0) + 1)
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1]).slice(0, 10)
      .map(([id, pending]) => ({ name: nameMap.get(id) ?? id.slice(0, 8), pending }))
  }, [tasks, stores, range])

  // ── Pie chart: task type breakdown, pending in period ──
  const pieData = useMemo(() => {
    const bucket: Record<string, number> = { reorder: 0, winback: 0, pattern_break: 0, other: 0 }
    for (const t of tasks) {
      if (!(t.status === 'pending' && inDueDateRange(t, range))) continue
      if (t.task_type in bucket && t.task_type !== 'other') bucket[t.task_type]++
      else if (OTHER_TYPES.has(t.task_type)) bucket.other++
    }
    return Object.entries(bucket).filter(([, v]) => v > 0)
      .map(([k, v]) => ({ name: PIE_CFG[k]?.label ?? k, value: v, color: PIE_CFG[k]?.color ?? '#9CA3AF' }))
  }, [tasks, range])

  // ── Stores table ──
  const storeRows = useMemo(() =>
    stores
      .map((s) => {
        const st = tasks.filter((t) => t.store_id === s.id)
        return {
          ...s,
          pending: st.filter((t) => t.status === 'pending' && inDueDateRange(t, range)).length,
          done:    st.filter((t) => t.status === 'done'    && inUpdatedRange(t, range)).length,
        }
      })
      .filter((r) => r.pending + r.done > 0)
      .sort((a, b) => b.pending - a.pending),
  [tasks, stores, range])

  // ── Period tasks (base for all Insights) ──
  const periodTasks = useMemo(() => tasks.filter((t) => taskInPeriod(t, range)), [tasks, range])
  const periodDone  = useMemo(() => periodTasks.filter((t) => t.status === 'done').length, [periodTasks])

  // ── Insights: Customer — task type by store ──
  const taskTypeByStore = useMemo(() => {
    const nameMap = new Map(stores.map((s) => [s.id, s.name]))
    const byStore = new Map<string, { reorder: number; winback: number; pattern_break: number; other: number }>()
    for (const t of periodTasks) {
      if (!byStore.has(t.store_id))
        byStore.set(t.store_id, { reorder: 0, winback: 0, pattern_break: 0, other: 0 })
      const b = byStore.get(t.store_id)!
      if      (t.task_type === 'reorder')       b.reorder++
      else if (t.task_type === 'winback')        b.winback++
      else if (t.task_type === 'pattern_break')  b.pattern_break++
      else                                       b.other++
    }
    return Array.from(byStore.entries())
      .map(([id, c]) => {
        const top = Object.entries(c).sort((a, b) => b[1] - a[1])[0]
        return { id, name: nameMap.get(id) ?? id.slice(0, 8), ...c, topType: top[1] > 0 ? top[0] : null }
      })
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [periodTasks, stores])

  // ── Insights: Customer — stuck customers ──
  const stuckCustomers = useMemo(() => {
    const nameMap = new Map(stores.map((s) => [s.id, s.name]))
    const doneTasks = periodTasks.filter((t) => t.status === 'done')
    const byKey = new Map<string, TaskMin[]>()
    for (const t of doneTasks) {
      const key = t.customer_phone ?? `${t.customer_name}::${t.store_id}`
      if (!byKey.has(key)) byKey.set(key, [])
      byKey.get(key)!.push(t)
    }
    const result: {
      customerName: string; phone: string | null; store: string
      timesContacted: number; lastContact: string | null; lastOutcome: string
    }[] = []
    for (const [, ctasks] of byKey) {
      if (ctasks.length < 2) continue
      const hasNeg    = ctasks.some((t) => hasNegativeOutcome(t.notes))
      const allNegOrBlank = ctasks.every((t) => !t.notes || hasNegativeOutcome(t.notes))
      if (!hasNeg || !allNegOrBlank) continue
      const sorted = [...ctasks].sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? ''))
      const last = sorted[0]
      result.push({
        customerName: last.customer_name,
        phone: last.customer_phone,
        store: nameMap.get(last.store_id) ?? '–',
        timesContacted: ctasks.length,
        lastContact: last.updated_at,
        lastOutcome: parseOutcome(last.notes, last.call_outcome),
      })
    }
    return result.sort((a, b) => b.timesContacted - a.timesContacted).slice(0, 10)
  }, [periodTasks, stores])

  // ── Insights: Customer — most reordered products (done/converted tasks only) ──
  const topProducts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const t of periodTasks) {
      if (t.status !== 'done') continue
      if (!t.product_name?.trim()) continue
      counts.set(t.product_name, (counts.get(t.product_name) ?? 0) + 1)
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1]).slice(0, 8)
      .map(([name, count]) => ({
        name: name.length > 24 ? `${name.slice(0, 22)}…` : name,
        count,
      }))
  }, [periodTasks])

  // ── Insights: Quality — conversion rate ──
  const conversionPct = useMemo(() => {
    const total = periodTasks.length
    return total ? Math.round((periodDone / total) * 100) : 0
  }, [periodTasks, periodDone])
  const convStatus = conversionPct >= 70
    ? { label: 'On track',       cls: 'text-emerald-600' }
    : conversionPct >= 40
      ? { label: 'Needs attention', cls: 'text-amber-500' }
      : { label: 'Below target',    cls: 'text-red-500' }

  // ── Insights: Quality — customer outcomes ──
  const outcomePieData = useMemo(() => {
    const doneTasks = periodTasks.filter((t) => t.status === 'done')
    const counts: Record<string, number> = {}
    for (const t of doneTasks) {
      const o = parseOutcome(t.notes, t.call_outcome)
      counts[o] = (counts[o] ?? 0) + 1
    }
    const total = doneTasks.length || 1
    return Object.entries(counts)
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([name, value]) => ({
        name, value,
        pct: Math.round((value / total) * 100),
        color: OUTCOME_COLOR[name] ?? '#D1D5DB',
      }))
  }, [periodTasks])

  // ── Insights: Quality — snooze vs completion ──
  const snoozeStats = useMemo(() => {
    let snoozed = 0; let active = 0
    for (const t of periodTasks) {
      if (t.status !== 'pending') continue
      if (t.snoozed_until) snoozed++
      else active++
    }
    const done  = periodDone
    const total = Math.max(snoozed + active + done, 1)
    return {
      snoozed, done, active,
      snoozedPct: (snoozed / total) * 100,
      donePct:    (done    / total) * 100,
      activePct:  (active  / total) * 100,
      total,
    }
  }, [periodTasks, periodDone])

  // ── Dynamic label copy ──
  const dueLabel       = filter === 'today' ? 'Due Today'          : filter === 'week' ? 'Due This Week'          : 'Due This Month'
  const dueSub         = filter === 'today' ? 'pending tasks'      : filter === 'week' ? 'pending this week'      : 'pending this month'
  const completedLabel = filter === 'today' ? 'Completed Today'    : filter === 'week' ? 'Completed This Week'    : 'Completed This Month'
  const completedSub   = filter === 'today' ? 'since midnight'     : filter === 'week' ? 'since Monday'           : 'since 1st'

  function downloadTrends() {
    setIsDownloadingTrend(true)
    try {
      const now = new Date()
      let periodStart: string
      let periodLabel: string
      if (trendPeriod === 'weekly') {
        const day = now.getDay()
        const mon = new Date(now)
        mon.setDate(now.getDate() - (day === 0 ? 6 : day - 1))
        mon.setHours(0, 0, 0, 0)
        periodStart = mon.toISOString().split('T')[0]
        periodLabel = `Week of ${periodStart}`
      } else {
        periodStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0]
        periodLabel = `${now.toLocaleString('en-IN', { month: 'long' })} ${now.getFullYear()}`
      }
      const nameMap = new Map(stores.map((s) => [s.id, s.name]))
      type S = { total: number; done: number; pending: number; reorder: number; winback: number; pattern_break: number; other: number }
      const byStore = new Map<string, S>()
      for (const t of tasks) {
        const d = (t.created_at ?? '').split('T')[0]
        if (d < periodStart) continue
        if (!byStore.has(t.store_id)) byStore.set(t.store_id, { total: 0, done: 0, pending: 0, reorder: 0, winback: 0, pattern_break: 0, other: 0 })
        const b = byStore.get(t.store_id)!
        b.total++
        if (t.status === 'done') b.done++
        else if (t.status === 'pending') b.pending++
        if (t.task_type === 'reorder') b.reorder++
        else if (t.task_type === 'winback') b.winback++
        else if (t.task_type === 'pattern_break') b.pattern_break++
        else b.other++
      }
      const rows = Array.from(byStore.entries())
        .map(([id, c]) => ({
          'Store': nameMap.get(id) ?? id,
          'Period': periodLabel,
          'Total Tasks': c.total,
          'Completed': c.done,
          'Pending': c.pending,
          'Completion Rate': c.total > 0 ? `${Math.round((c.done / c.total) * 100)}%` : '0%',
          'Reorder': c.reorder,
          'Winback': c.winback,
          'Pattern Break': c.pattern_break,
          'Other': c.other,
        }))
        .sort((a, b) => a.Store.localeCompare(b.Store))
      const ws = XLSX.utils.json_to_sheet(rows)
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'ERP Trends')
      XLSX.writeFile(wb, `HUFT_ERP_Trends_${trendPeriod}_${now.toISOString().slice(0, 10)}.xlsx`)
    } finally {
      setIsDownloadingTrend(false)
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">

      {/* ── Filter control ── */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="inline-flex rounded-full bg-gray-100 p-0.5">
            {FILTERS.map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={cn(
                  'rounded-full px-4 py-1.5 text-xs font-semibold transition-all',
                  filter === f ? 'bg-[#E8642C] text-white shadow-sm' : 'text-gray-500 hover:text-gray-700',
                )}
              >
                {FILTER_LABELS[f]}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <select
              value={trendPeriod}
              onChange={(e) => setTrendPeriod(e.target.value as 'weekly' | 'monthly')}
              className="h-8 rounded-md border border-input bg-background px-2 text-xs text-gray-700 shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
            <Button variant="outline" size="sm" onClick={downloadTrends} disabled={isDownloadingTrend} className="gap-1.5 text-gray-600">
              <Download className={`h-3.5 w-3.5 ${isDownloadingTrend ? 'animate-pulse' : ''}`} />
              {isDownloadingTrend ? 'Preparing…' : 'Download Trends'}
            </Button>
            <Button variant="outline" size="sm" onClick={() => queryClient.invalidateQueries()} className="gap-1.5 text-gray-600">
              <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          {tasksTs ? `Last updated ${fmtTime(tasksTs)}` : ' '}
        </p>
      </div>

      {/* ── KPI cards ── */}
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <KpiCard icon={ClipboardList} label="Total Pending Tasks" value={totalPending.toLocaleString('en-IN')}       sub="across all stores" iconBg="bg-[#E8642C]" />
        <KpiCard icon={Clock}         label={dueLabel}            value={dueInPeriod.toLocaleString('en-IN')}        sub={dueSub}            iconBg="bg-orange-400" />
        <KpiCard icon={CheckCircle2}  label={completedLabel}      value={completedInPeriod.toLocaleString('en-IN')}  sub={completedSub}      iconBg="bg-orange-600" />
        <KpiCard icon={AlertTriangle} label="Overdue"             value={overdue.toLocaleString('en-IN')}            sub="past due date"     iconBg="bg-red-500" />
      </div>

      {/* ── Charts ── */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader className="pb-0">
            <CardTitle className="text-sm font-semibold">Pending Tasks by Store</CardTitle>
            <p className="text-xs text-muted-foreground">Due in selected period — top 10 stores</p>
          </CardHeader>
          <CardContent className="pt-4">
            {barData.length === 0 ? <EmptyChart /> : (
              <ResponsiveContainer width="100%" height={268}>
                <BarChart data={barData} margin={{ top: 2, right: 4, left: -22, bottom: 64 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#6b7280' }} angle={-40} textAnchor="end" interval={0} tickLine={false} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#6b7280' }} axisLine={false} tickLine={false} />
                  <Tooltip cursor={{ fill: '#fef3ef' }} contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' }} formatter={(v: number) => [v.toLocaleString('en-IN'), 'Pending']} />
                  <Bar dataKey="pending" fill="#E8642C" radius={[4, 4, 0, 0]} maxBarSize={42} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-0">
            <CardTitle className="text-sm font-semibold">Task Type Breakdown</CardTitle>
            <p className="text-xs text-muted-foreground">Pending tasks due in selected period</p>
          </CardHeader>
          <CardContent className="pt-4">
            {pieData.length === 0 ? <EmptyChart /> : (
              <ResponsiveContainer width="100%" height={268}>
                <PieChart>
                  <Pie data={pieData} cx="50%" cy="46%" innerRadius={58} outerRadius={95} paddingAngle={3} dataKey="value">
                    {pieData.map((e, i) => <Cell key={i} fill={e.color} />)}
                  </Pie>
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' }} formatter={(v: number, name: string) => [v.toLocaleString('en-IN'), name]} />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Stores table ── */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Stores Overview</CardTitle></CardHeader>
        <CardContent className="px-0 pb-1">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5">Store</TableHead>
                <TableHead className="text-right">{dueLabel}</TableHead>
                <TableHead className="pr-5 text-right">Completed</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {storeRows.length === 0
                ? <EmptyRow cols={3} message="No stores found" />
                : storeRows.map((row) => (
                  <TableRow key={row.id} className="cursor-pointer" onClick={() => navigate(`/erp/upload?store=${row.id}`)}>
                    <TableCell className="pl-5 font-medium text-gray-900">{row.name}</TableCell>
                    <TableCell className="text-right">
                      <span className={row.pending > 0 ? 'font-semibold text-orange-600' : 'text-muted-foreground'}>{row.pending}</span>
                    </TableCell>
                    <TableCell className="pr-5 text-right text-muted-foreground">{row.done}</TableCell>
                  </TableRow>
                ))
              }
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* ── Insights section ── */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      <div className="space-y-3">
        <h2 className="text-base font-semibold text-gray-900">Insights</h2>

        <Tabs defaultValue="customer">
          <TabsList className="h-9">
            <TabsTrigger value="customer" className="text-xs">Customer Insights</TabsTrigger>
          </TabsList>

          {/* ─── Customer Insights tab ──────────────────────────────────────── */}
          <TabsContent value="customer" className="mt-4">
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">

              {/* Card 1: Task Type by Store */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold">Task Type by Store</CardTitle>
                  <p className="text-xs text-muted-foreground">Breakdown of task types in selected period</p>
                </CardHeader>
                <CardContent className="px-0 pb-1">
                  {isLoading ? <InsightSkeleton /> : (
                    <div className="max-h-64 overflow-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="pl-5">Store</TableHead>
                            <TableHead className="text-right">Reorder</TableHead>
                            <TableHead className="text-right">Win Back</TableHead>
                            <TableHead className="text-right">Pattern</TableHead>
                            <TableHead className="pr-5">Top Type</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {taskTypeByStore.length === 0
                            ? <EmptyRow cols={5} message="No tasks in this period" />
                            : taskTypeByStore.map((row) => (
                              <TableRow key={row.id}>
                                <TableCell className="pl-5 font-medium text-gray-900">{row.name}</TableCell>
                                <TableCell className="text-right text-muted-foreground">{row.reorder}</TableCell>
                                <TableCell className="text-right text-muted-foreground">{row.winback}</TableCell>
                                <TableCell className="text-right text-muted-foreground">{row.pattern_break}</TableCell>
                                <TableCell className="pr-5">
                                  {row.topType && (
                                    <Badge variant="outline" className={cn('text-[10px]', TYPE_BADGE[row.topType] ?? TYPE_BADGE.other)}>
                                      {TYPE_LABEL[row.topType] ?? row.topType}
                                    </Badge>
                                  )}
                                </TableCell>
                              </TableRow>
                            ))
                          }
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Card 3: Most Reordered Products */}
              <Card>
                <CardHeader className="pb-0">
                  <CardTitle className="text-sm font-semibold">Most Reordered Products</CardTitle>
                  <p className="text-xs text-muted-foreground">Based on completed follow-up calls</p>
                </CardHeader>
                <CardContent className="pt-4">
                  {isLoading ? <InsightSkeleton /> : topProducts.length === 0 ? <EmptyChart /> : (
                    <ResponsiveContainer width="100%" height={240}>
                      <BarChart data={topProducts} layout="vertical" margin={{ top: 2, right: 16, left: 0, bottom: 2 }}>
                        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f0f0f0" />
                        <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: '#6b7280' }} axisLine={false} tickLine={false} />
                        <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: '#6b7280' }} width={130} axisLine={false} tickLine={false} />
                        <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' }} formatter={(v: number) => [v.toLocaleString('en-IN'), 'Tasks']} />
                        <Bar dataKey="count" fill="#E8642C" radius={[0, 4, 4, 0]} maxBarSize={18} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </CardContent>
              </Card>

            </div>
          </TabsContent>

        </Tabs>
      </div>

    </div>
  )
}
