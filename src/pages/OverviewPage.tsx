import { useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  PieChart,
  Pie,
  Cell,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import { ClipboardList, Clock, Video, TrendingUp, RefreshCw } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { supabase } from '@/lib/supabase'
import type { ComponentType } from 'react'

// ── Local types ────────────────────────────────────────────────────────────────

type TaskMin = {
  id: string
  store_id: string
  status: 'pending' | 'done' | 'skipped'
  due_date: string | null
  task_type: string
  updated_at: string | null
}

type StoreMin = {
  id: string
  name: string
  region: string
}

type SubmissionMin = {
  id: string
  status: 'submitted' | 'ai_reviewed' | 'approved' | 'rejected'
  ai_score: { overall: number } | null
  created_at: string
  staff: { name: string } | null
  store: { name: string } | null
  theme: { title: string } | null
}

// ── Queries ────────────────────────────────────────────────────────────────────

function useTasks() {
  return useQuery<TaskMin[]>({
    queryKey: ['tasks'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tasks')
        .select('id, store_id, status, due_date, task_type, updated_at')
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
      const { data, error } = await supabase
        .from('stores')
        .select('id, name, region')
      if (error) throw error
      return (data ?? []) as StoreMin[]
    },
    staleTime: 5 * 60_000,
  })
}

function useRecentSubmissions() {
  return useQuery<SubmissionMin[]>({
    queryKey: ['roleplay_submissions', 'recent'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('roleplay_submissions')
        .select(
          'id, status, ai_score, created_at, staff:staff(name), store:stores(name), theme:themes(title)'
        )
        .order('created_at', { ascending: false })
        .limit(10)
      if (error) throw error
      return (data ?? []) as unknown as SubmissionMin[]
    },
    staleTime: 60_000,
  })
}

function useWeeklySubmissionsCount() {
  const weekStart = useMemo(() => {
    const d = new Date()
    const day = d.getDay()
    d.setDate(d.getDate() - (day === 0 ? 6 : day - 1))
    d.setHours(0, 0, 0, 0)
    return d.toISOString()
  }, [])

  return useQuery<number>({
    queryKey: ['roleplay_submissions', 'week_count'],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('roleplay_submissions')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', weekStart)
      if (error) throw error
      return count ?? 0
    },
    staleTime: 60_000,
  })
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function todayStr() {
  return new Date().toISOString().split('T')[0]
}

function fmtDate(iso: string | null) {
  if (!iso) return '–'
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

function fmtTime(ts: number) {
  if (!ts) return ''
  return new Date(ts).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
}

// ── KPI Card ───────────────────────────────────────────────────────────────────

function KpiCard({
  icon: Icon,
  label,
  value,
  sub,
  iconBg,
}: {
  icon: ComponentType<{ className?: string }>
  label: string
  value: string | number
  sub: string
  iconBg: string
}) {
  return (
    <Card>
      <CardContent className="pb-5 pt-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
              {label}
            </p>
            <p className="mt-2 text-3xl font-bold tracking-tight text-gray-900">{value}</p>
            <p className="mt-1 text-xs text-muted-foreground">{sub}</p>
          </div>
          <div
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${iconBg}`}
          >
            <Icon className="h-5 w-5 text-white" />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// ── Status Badge ───────────────────────────────────────────────────────────────

const STATUS_CFG: Record<
  SubmissionMin['status'],
  { label: string; className: string }
> = {
  submitted: {
    label: 'Submitted',
    className: 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-50',
  },
  ai_reviewed: {
    label: 'AI Reviewed',
    className: 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-50',
  },
  approved: {
    label: 'Approved',
    className: 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-50',
  },
  rejected: {
    label: 'Rejected',
    className: 'bg-red-50 text-red-700 border-red-200 hover:bg-red-50',
  },
}

function StatusBadge({ status }: { status: SubmissionMin['status'] }) {
  const cfg = STATUS_CFG[status]
  return (
    <Badge variant="outline" className={cfg.className}>
      {cfg.label}
    </Badge>
  )
}

// ── Pie chart config ───────────────────────────────────────────────────────────

const PIE_CFG: Record<string, { label: string; color: string }> = {
  reorder:       { label: 'Reorder',       color: '#3B82F6' },
  winback:       { label: 'Win Back',       color: '#F59E0B' },
  pattern_break: { label: 'Pattern Break',  color: '#EF4444' },
  other:         { label: 'Other',          color: '#9CA3AF' },
}

const GROUPED_AS_OTHER = new Set(['checkin', 'upsell', 'high_value', 'cart_growth'])

// ── Main page ──────────────────────────────────────────────────────────────────

export default function OverviewPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const { data: tasks = [], dataUpdatedAt: tasksTs, isLoading: tasksLoading } = useTasks()
  const { data: stores = [], isLoading: storesLoading } = useStores()
  const { data: submissions = [], isLoading: subLoading } = useRecentSubmissions()
  const { data: weekCount = 0 } = useWeeklySubmissionsCount()

  const today = todayStr()
  const isLoading = tasksLoading || storesLoading || subLoading

  // ── KPI computations ────────────────────────────────────────────────────────

  const totalPending = useMemo(
    () => tasks.filter((t) => t.status === 'pending').length,
    [tasks]
  )

  const dueToday = useMemo(
    () => tasks.filter((t) => t.status === 'pending' && t.due_date === today).length,
    [tasks, today]
  )

  const avgCompletion = useMemo(() => {
    if (!stores.length) return 0
    let sum = 0
    let counted = 0
    for (const s of stores) {
      const st = tasks.filter((t) => t.store_id === s.id)
      if (!st.length) continue
      sum += (st.filter((t) => t.status === 'done').length / st.length) * 100
      counted++
    }
    return counted ? Math.round(sum / counted) : 0
  }, [tasks, stores])

  // ── Bar chart — pending per store, top 10 ───────────────────────────────────

  const barData = useMemo(() => {
    const nameMap = new Map(stores.map((s) => [s.id, s.name]))
    const counts = new Map<string, number>()
    for (const t of tasks) {
      if (t.status === 'pending') {
        counts.set(t.store_id, (counts.get(t.store_id) ?? 0) + 1)
      }
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([id, pending]) => ({ name: nameMap.get(id) ?? id.slice(0, 8), pending }))
  }, [tasks, stores])

  // ── Pie chart — task type breakdown ─────────────────────────────────────────

  const pieData = useMemo(() => {
    const bucket: Record<string, number> = {
      reorder: 0, winback: 0, pattern_break: 0, other: 0,
    }
    for (const t of tasks) {
      if (t.task_type in bucket && t.task_type !== 'other') {
        bucket[t.task_type]++
      } else if (GROUPED_AS_OTHER.has(t.task_type)) {
        bucket.other++
      }
    }
    return Object.entries(bucket)
      .filter(([, v]) => v > 0)
      .map(([k, v]) => ({
        name: PIE_CFG[k]?.label ?? k,
        value: v,
        color: PIE_CFG[k]?.color ?? '#9CA3AF',
      }))
  }, [tasks])

  // ── Stores table rows ────────────────────────────────────────────────────────

  const storeRows = useMemo(() =>
    stores.map((s) => {
      const st = tasks.filter((t) => t.store_id === s.id)
      const lastSync =
        st
          .map((t) => t.updated_at)
          .filter((v): v is string => v !== null)
          .sort()
          .pop() ?? null
      return {
        ...s,
        pending:  st.filter((t) => t.status === 'pending').length,
        done:     st.filter((t) => t.status === 'done').length,
        dueToday: st.filter((t) => t.status === 'pending' && t.due_date === today).length,
        lastSync,
      }
    }),
    [tasks, stores, today]
  )

  const handleRefreshAll = () => queryClient.invalidateQueries()

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {tasksTs ? `Last updated ${fmtTime(tasksTs)}` : ' '}
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={handleRefreshAll}
          className="gap-2"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          Refresh All
        </Button>
      </div>

      {/* ── Row 1: KPI Cards ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <KpiCard
          icon={ClipboardList}
          label="Total Pending Tasks"
          value={totalPending.toLocaleString('en-IN')}
          sub="across all stores"
          iconBg="bg-[#E8642C]"
        />
        <KpiCard
          icon={Clock}
          label="Due Today"
          value={dueToday.toLocaleString('en-IN')}
          sub="pending tasks"
          iconBg="bg-red-500"
        />
        <KpiCard
          icon={Video}
          label="Roleplay Submissions"
          value={weekCount.toLocaleString('en-IN')}
          sub="this week"
          iconBg="bg-blue-500"
        />
        <KpiCard
          icon={TrendingUp}
          label="Avg Completion Rate"
          value={`${avgCompletion}%`}
          sub="per-store average"
          iconBg="bg-emerald-500"
        />
      </div>

      {/* ── Row 2: Charts ────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {/* Bar — Tasks by Store */}
        <Card>
          <CardHeader className="pb-0">
            <CardTitle className="text-sm font-semibold">Tasks by Store</CardTitle>
            <p className="text-xs text-muted-foreground">Pending count — top 10 stores</p>
          </CardHeader>
          <CardContent className="pt-4">
            {barData.length === 0 ? (
              <EmptyChart />
            ) : (
              <ResponsiveContainer width="100%" height={268}>
                <BarChart
                  data={barData}
                  margin={{ top: 2, right: 4, left: -22, bottom: 64 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    vertical={false}
                    stroke="#f0f0f0"
                  />
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: 11, fill: '#6b7280' }}
                    angle={-40}
                    textAnchor="end"
                    interval={0}
                    tickLine={false}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fontSize: 11, fill: '#6b7280' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    cursor={{ fill: '#fef3ef' }}
                    contentStyle={{
                      fontSize: 12,
                      borderRadius: 8,
                      border: '1px solid #e5e7eb',
                    }}
                    formatter={(v: number) => [v.toLocaleString('en-IN'), 'Pending']}
                  />
                  <Bar
                    dataKey="pending"
                    fill="#E8642C"
                    radius={[4, 4, 0, 0]}
                    maxBarSize={42}
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Pie — Task Type Breakdown */}
        <Card>
          <CardHeader className="pb-0">
            <CardTitle className="text-sm font-semibold">Task Type Breakdown</CardTitle>
            <p className="text-xs text-muted-foreground">Distribution across all tasks</p>
          </CardHeader>
          <CardContent className="pt-4">
            {pieData.length === 0 ? (
              <EmptyChart />
            ) : (
              <ResponsiveContainer width="100%" height={268}>
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="46%"
                    innerRadius={58}
                    outerRadius={95}
                    paddingAngle={3}
                    dataKey="value"
                  >
                    {pieData.map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      fontSize: 12,
                      borderRadius: 8,
                      border: '1px solid #e5e7eb',
                    }}
                    formatter={(v: number, name: string) => [
                      v.toLocaleString('en-IN'),
                      name,
                    ]}
                  />
                  <Legend
                    iconType="circle"
                    iconSize={8}
                    wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Row 3: Tables ────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {/* Stores Overview */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Stores Overview</CardTitle>
          </CardHeader>
          <CardContent className="px-0 pb-1">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-5">Store</TableHead>
                  <TableHead>Region</TableHead>
                  <TableHead className="text-right">Pending</TableHead>
                  <TableHead className="text-right">Due Today</TableHead>
                  <TableHead className="text-right">Done</TableHead>
                  <TableHead className="pr-5">Last Sync</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {storeRows.length === 0 ? (
                  <EmptyRow cols={6} message="No stores found" />
                ) : (
                  storeRows.map((row) => (
                    <TableRow
                      key={row.id}
                      className="cursor-pointer"
                      onClick={() => navigate(`/erp-upload?store=${row.id}`)}
                    >
                      <TableCell className="pl-5 font-medium text-gray-900">
                        {row.name}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {row.region}
                      </TableCell>
                      <TableCell className="text-right">
                        <span
                          className={
                            row.pending > 0
                              ? 'font-semibold text-orange-600'
                              : 'text-muted-foreground'
                          }
                        >
                          {row.pending}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <span
                          className={
                            row.dueToday > 0
                              ? 'font-semibold text-red-600'
                              : 'text-muted-foreground'
                          }
                        >
                          {row.dueToday}
                        </span>
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {row.done}
                      </TableCell>
                      <TableCell className="pr-5 text-xs text-muted-foreground">
                        {fmtDate(row.lastSync)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Recent Roleplay Submissions */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">
              Recent Roleplay Submissions
            </CardTitle>
          </CardHeader>
          <CardContent className="px-0 pb-1">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-5">Staff</TableHead>
                  <TableHead>Store</TableHead>
                  <TableHead>Theme</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Score</TableHead>
                  <TableHead className="pr-5">Submitted</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {submissions.length === 0 ? (
                  <EmptyRow cols={6} message="No submissions yet" />
                ) : (
                  submissions.map((sub) => (
                    <TableRow key={sub.id}>
                      <TableCell className="pl-5 font-medium text-gray-900">
                        {sub.staff?.name ?? '–'}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {sub.store?.name ?? '–'}
                      </TableCell>
                      <TableCell className="max-w-[110px] truncate text-muted-foreground">
                        {sub.theme?.title ?? '–'}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={sub.status} />
                      </TableCell>
                      <TableCell className="text-right">
                        {sub.ai_score?.overall != null ? (
                          <span className="font-semibold text-gray-900">
                            {sub.ai_score.overall.toFixed(1)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">–</span>
                        )}
                      </TableCell>
                      <TableCell className="pr-5 text-xs text-muted-foreground">
                        {fmtDate(sub.created_at)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

// ── Tiny shared empties ────────────────────────────────────────────────────────

function EmptyChart() {
  return (
    <div className="flex h-[268px] items-center justify-center text-sm text-muted-foreground">
      No data yet
    </div>
  )
}

function EmptyRow({ cols, message }: { cols: number; message: string }) {
  return (
    <TableRow>
      <TableCell
        colSpan={cols}
        className="py-8 text-center text-sm text-muted-foreground"
      >
        {message}
      </TableCell>
    </TableRow>
  )
}
