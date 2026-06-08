import { useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  PieChart, Pie, Cell, Legend, ResponsiveContainer,
} from 'recharts'
import { Video, Clock, CheckCircle2, Star, RefreshCw } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { supabase } from '@/lib/supabase'
import type { ComponentType } from 'react'

type SubmissionMin = {
  id: string; status: 'submitted' | 'ai_reviewed' | 'approved' | 'rejected'
  ai_score: { overall: number } | null; created_at: string; store_id: string
  staff: { name: string } | null; store: { name: string } | null; theme: { title: string } | null
}
type StoreMin = { id: string; name: string }

function weekStartIso() {
  const d = new Date(); const day = d.getDay()
  d.setDate(d.getDate() - (day === 0 ? 6 : day - 1)); d.setHours(0, 0, 0, 0)
  return d.toISOString()
}

function useSubmissions() {
  return useQuery<SubmissionMin[]>({
    queryKey: ['roleplay_submissions', 'all'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('roleplay_submissions')
        .select('id, status, ai_score, created_at, store_id, staff:staff!roleplay_submissions_staff_id_fkey(name), store:stores!roleplay_submissions_store_id_fkey(name), theme:themes!roleplay_submissions_theme_id_fkey(title)')
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as unknown as SubmissionMin[]
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

function fmtDate(iso: string | null) {
  if (!iso) return '–'
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}
function fmtTime(ts: number) {
  if (!ts) return ''
  return new Date(ts).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
}

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

const STATUS_CFG: Record<SubmissionMin['status'], { label: string; className: string; color: string }> = {
  submitted:   { label: 'Submitted',   className: 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-50',     color: '#3B82F6' },
  ai_reviewed: { label: 'AI Reviewed', className: 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-50', color: '#F59E0B' },
  approved:    { label: 'Approved',    className: 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-50', color: '#10B981' },
  rejected:    { label: 'Rejected',    className: 'bg-red-50 text-red-700 border-red-200 hover:bg-red-50',         color: '#EF4444' },
  invalid:     { label: 'Invalid',     className: 'bg-gray-50 text-gray-500 border-gray-200 hover:bg-gray-50',       color: '#9CA3AF' },
}
function StatusBadge({ status }: { status: SubmissionMin['status'] }) {
  const cfg = STATUS_CFG[status]
  return <Badge variant="outline" className={cfg.className}>{cfg.label}</Badge>
}

function EmptyChart() {
  return <div className="flex h-[268px] items-center justify-center text-sm text-muted-foreground">No data yet</div>
}
function EmptyRow({ cols, message }: { cols: number; message: string }) {
  return (
    <TableRow>
      <TableCell colSpan={cols} className="py-8 text-center text-sm text-muted-foreground">{message}</TableCell>
    </TableRow>
  )
}

export default function RoleplayOverviewPage() {
  const queryClient = useQueryClient()
  const { data: submissions = [], dataUpdatedAt: subTs, isLoading: subL } = useSubmissions()
  const { data: stores = [], isLoading: sL } = useStores()
  const isLoading = subL || sL
  const weekStart = useMemo(weekStartIso, [])

  const totalSubmissions = submissions.length
  const pendingAiReview = useMemo(() => submissions.filter((s) => s.status === 'submitted').length, [submissions])
  const approvedThisWeek = useMemo(() =>
    submissions.filter((s) => s.status === 'approved' && s.created_at >= weekStart).length,
  [submissions, weekStart])
  const avgScore = useMemo(() => {
    const scored = submissions.filter((s) => s.ai_score?.overall != null)
    if (!scored.length) return '–'
    const avg = scored.reduce((sum, s) => sum + s.ai_score!.overall, 0) / scored.length
    return avg.toFixed(1)
  }, [submissions])

  const barData = useMemo(() => {
    const nameMap = new Map(stores.map((s) => [s.id, s.name]))
    const counts = new Map<string, number>()
    for (const s of submissions) counts.set(s.store_id, (counts.get(s.store_id) ?? 0) + 1)
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10)
      .map(([id, count]) => ({ name: nameMap.get(id) ?? id.slice(0, 8), submissions: count }))
  }, [submissions, stores])

  const pieData = useMemo(() => {
    const bucket: Record<string, number> = { submitted: 0, ai_reviewed: 0, approved: 0, rejected: 0, invalid: 0 }
    for (const s of submissions) bucket[s.status] = (bucket[s.status] ?? 0) + 1
    return Object.entries(bucket).filter(([, v]) => v > 0).filter(Boolean)
      .map(([k, v]) => ({
        name: STATUS_CFG[k as SubmissionMin['status']]?.label ?? k,
        value: v,
        color: STATUS_CFG[k as SubmissionMin['status']].color,
      }))
  }, [submissions])

  const recentSubmissions = submissions.slice(0, 20)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">{subTs ? `Last updated ${fmtTime(subTs)}` : ' '}</p>
        <Button variant="outline" size="sm" onClick={() => queryClient.invalidateQueries()} className="gap-2">
          <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <KpiCard icon={Video}        label="Total Submissions"   value={totalSubmissions.toLocaleString('en-IN')} sub="all time"            iconBg="bg-[#E8642C]" />
        <KpiCard icon={Clock}        label="Pending AI Review"   value={pendingAiReview.toLocaleString('en-IN')}  sub="awaiting review"     iconBg="bg-orange-400" />
        <KpiCard icon={CheckCircle2} label="Approved This Week"  value={approvedThisWeek.toLocaleString('en-IN')} sub="since Monday"        iconBg="bg-orange-600" />
        <KpiCard icon={Star}         label="Avg AI Score"        value={avgScore}                                 sub="across all scored"   iconBg="bg-[#E8642C]" />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader className="pb-0">
            <CardTitle className="text-sm font-semibold">Submissions by Store</CardTitle>
            <p className="text-xs text-muted-foreground">Top 10 stores by submission count</p>
          </CardHeader>
          <CardContent className="pt-4">
            {barData.length === 0 ? <EmptyChart /> : (
              <ResponsiveContainer width="100%" height={268}>
                <BarChart data={barData} margin={{ top: 2, right: 4, left: -22, bottom: 64 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#6b7280' }} angle={-40} textAnchor="end" interval={0} tickLine={false} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#6b7280' }} axisLine={false} tickLine={false} />
                  <Tooltip cursor={{ fill: '#FFF8F5' }} contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' }} formatter={(v: number) => [v.toLocaleString('en-IN'), 'Submissions']} />
                  <Bar dataKey="submissions" fill="#E8642C" radius={[4, 4, 0, 0]} maxBarSize={42} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-0">
            <CardTitle className="text-sm font-semibold">Status Breakdown</CardTitle>
            <p className="text-xs text-muted-foreground">Distribution across all submissions</p>
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

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Recent Submissions</CardTitle></CardHeader>
        <CardContent className="px-0 pb-1">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5">Staff</TableHead>
                <TableHead>Store</TableHead>
                <TableHead>Theme</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Score</TableHead>
                <TableHead className="pr-5">Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recentSubmissions.length === 0
                ? <EmptyRow cols={6} message="No submissions yet" />
                : recentSubmissions.map((sub) => (
                  <TableRow key={sub.id}>
                    <TableCell className="pl-5 font-medium text-gray-900">{sub.staff?.name ?? '–'}</TableCell>
                    <TableCell className="text-muted-foreground">{sub.store?.name ?? '–'}</TableCell>
                    <TableCell className="max-w-[110px] truncate text-muted-foreground">{sub.theme?.title ?? '–'}</TableCell>
                    <TableCell><StatusBadge status={sub.status} /></TableCell>
                    <TableCell className="text-right">
                      {sub.ai_score?.overall != null
                        ? <span className="font-semibold text-gray-900">{sub.ai_score.overall.toFixed(1)}</span>
                        : <span className="text-muted-foreground">–</span>
                      }
                    </TableCell>
                    <TableCell className="pr-5 text-xs text-muted-foreground">{fmtDate(sub.created_at)}</TableCell>
                  </TableRow>
                ))
              }
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
