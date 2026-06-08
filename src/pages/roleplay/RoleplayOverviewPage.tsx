import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import * as XLSX from 'xlsx'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  PieChart, Pie, Cell, Legend, ResponsiveContainer,
} from 'recharts'
import { Video, Clock, CheckCircle2, Star, RefreshCw, Download } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { supabase } from '@/lib/supabase'
import type { ComponentType } from 'react'

type SubmissionMin = {
  id: string; status: 'submitted' | 'ai_reviewed' | 'approved' | 'rejected' | 'invalid'
  ai_score: { overall: number; required_score?: number } | null
  created_at: string; approved_at: string | null; store_id: string
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
        .select('id, status, ai_score, created_at, approved_at, store_id, staff:staff!roleplay_submissions_staff_id_fkey(name), store:stores!roleplay_submissions_store_id_fkey(name), theme:themes!roleplay_submissions_theme_id_fkey(title)')
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

const REPORT_DIMENSIONS = [
  'First Impression', 'Customer Welcome', 'Price Perception', 'Pet Details',
  'Product Knowledge', 'Product Demonstration', 'Offers Communication',
  'Cross Sell/Upsell', 'Query Handling', 'Product Suggestion', 'Impulse Products',
  'Customer Data Capture', 'Bag Handover & Google Review',
  'Shopping Basket (Bonus)', 'Spa Introduction (Bonus)',
]

export default function RoleplayOverviewPage() {
  const queryClient = useQueryClient()
  const { data: submissions = [], dataUpdatedAt: subTs, isLoading: subL } = useSubmissions()
  const { data: stores = [], isLoading: sL } = useStores()
  const isLoading = subL || sL
  const weekStart = useMemo(weekStartIso, [])

  const [reportStoreId, setReportStoreId] = useState<string>('all')
  const [isDownloading, setIsDownloading] = useState(false)

  async function downloadReport() {
    setIsDownloading(true)
    try {
      let query = supabase
        .from('roleplay_submissions')
        .select(
          'id, status, created_at, submitter_name, ai_score, store_id,' +
          'staff:staff!roleplay_submissions_staff_id_fkey(name),' +
          'store:stores!roleplay_submissions_store_id_fkey(name),' +
          'theme:themes!roleplay_submissions_theme_id_fkey(title)',
        )
        .order('created_at', { ascending: false })

      if (reportStoreId !== 'all') {
        query = query.eq('store_id', reportStoreId)
      }

      const { data, error } = await query
      if (error) throw error

      const rows = (data ?? []).map((sub: Record<string, unknown>) => {
        const score = sub.ai_score as Record<string, unknown> | null
        const reqScore = score?.required_score as number | undefined
        const pct = reqScore != null ? (reqScore / 24) * 100 : null
        let grade = '–'
        if (pct != null) {
          if (pct >= 80) grade = 'A'
          else if (pct >= 60) grade = 'B'
          else if (pct >= 50) grade = 'C'
          else grade = 'D'
        }

        const breakdown = (score?.breakdown as Array<Record<string, unknown>> | undefined) ?? []
        const dimCols: Record<string, string> = {}
        for (const dim of REPORT_DIMENSIONS) {
          const found = breakdown.find(
            (d) => (d.dimension as string)?.toLowerCase() === dim.toLowerCase(),
          )
          dimCols[dim] = found
            ? `${found.score}/${found.max_score ?? '?'}`
            : '–'
        }

        const staffObj = sub.staff as Record<string, unknown> | null
        const storeObj = sub.store as Record<string, unknown> | null
        const themeObj = sub.theme as Record<string, unknown> | null
        const statusCfg = STATUS_CFG[sub.status as SubmissionMin['status']]

        return {
          'Submitter Name': (sub.submitter_name as string | null) ?? (staffObj?.name as string | null) ?? '–',
          'Store': (storeObj?.name as string | null) ?? '–',
          'Theme': (themeObj?.title as string | null) ?? '–',
          'Date': sub.created_at
            ? new Date(sub.created_at as string).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
            : '–',
          'Status': statusCfg?.label ?? (sub.status as string),
          'Overall Grade': grade,
          ...dimCols,
        }
      })

      const ws = XLSX.utils.json_to_sheet(rows)
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'Roleplay Report')

      const storeName =
        reportStoreId === 'all'
          ? 'All_Stores'
          : (stores.find((s) => s.id === reportStoreId)?.name ?? 'Store').replace(/\s+/g, '_')
      const date = new Date().toISOString().slice(0, 10)

      XLSX.writeFile(wb, `HUFT_Roleplay_Report_${storeName}_${date}.xlsx`)
    } catch (err) {
      console.error('Download report failed:', err)
    } finally {
      setIsDownloading(false)
    }
  }

  const totalSubmissions = useMemo(() =>
    submissions.filter((s) => s.status !== 'invalid').length,
  [submissions])

  const pendingAiReview = useMemo(() =>
    submissions.filter((s) => s.status === 'submitted').length,
  [submissions])

  const approvedThisWeek = useMemo(() =>
    submissions.filter((s) => s.status === 'approved' && s.approved_at != null && s.approved_at >= weekStart).length,
  [submissions, weekStart])

  const avgScore = useMemo(() => {
    const scored = submissions.filter(
      (s) => s.status !== 'invalid' && s.ai_score?.required_score != null,
    )
    if (!scored.length) return '–'
    const avg = scored.reduce((sum, s) => sum + ((s.ai_score!.required_score ?? 0) / 24) * 100, 0) / scored.length
    if (avg >= 80) return 'A'
    if (avg >= 60) return 'B'
    if (avg >= 50) return 'C'
    return 'D'
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
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">{subTs ? `Last updated ${fmtTime(subTs)}` : ' '}</p>
        <div className="flex items-center gap-2">
          <select
            value={reportStoreId}
            onChange={(e) => setReportStoreId(e.target.value)}
            className="h-8 rounded-md border border-input bg-background px-2 text-xs text-gray-700 shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="all">All Stores</option>
            {stores.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          <Button
            variant="outline"
            size="sm"
            onClick={downloadReport}
            disabled={isDownloading}
            className="gap-2"
          >
            <Download className={`h-3.5 w-3.5 ${isDownloading ? 'animate-pulse' : ''}`} />
            {isDownloading ? 'Preparing…' : 'Download Report'}
          </Button>
          <Button variant="outline" size="sm" onClick={() => queryClient.invalidateQueries()} className="gap-2">
            <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
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
