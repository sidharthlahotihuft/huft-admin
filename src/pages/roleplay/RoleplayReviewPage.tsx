import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Video, Search, ChevronDown, ChevronUp, Play, ThumbsUp,
  ThumbsDown, RotateCcw, Sparkles, AlertCircle,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose,
} from '@/components/ui/dialog'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

// ── Types ─────────────────────────────────────────────────────────────────────

type AiBreakdown = { dimension: string; score: number; max_score?: number; is_bonus?: boolean; feedback: string }
type AiScore     = { overall: number; breakdown: AiBreakdown[]; summary: string; invalid?: boolean; reason?: string }

type Submission = {
  id: string
  staff_id: string
  store_id: string
  theme_id: string
  video_url: string | null
  ai_score: AiScore | null
  ai_reviewed_at: string | null
  approved_by: string | null
  approved_at: string | null
  rejected_reason: string | null
  status: 'submitted' | 'ai_reviewed' | 'approved' | 'rejected'
  created_at: string
  score_overridden: boolean | null
  trainer_score: number | null
  trainer_feedback: string | null
  reviewed_by: string | null
  reviewed_by_name: string | null
  reviewed_at: string | null
  submitter_name: string | null
  staff: { id: string; name: string } | null
  store: { id: string; name: string } | null
  theme: { id: string; title: string; brief_text: string } | null
}

type StoreMin   = { id: string; name: string; region: string | null; trainer_id: string | null; trainer_name: string | null }
type TrainerMin = { id: string; name: string }

// ── Constants ─────────────────────────────────────────────────────────────────

const ACCENT   = '#E8642C'
const REGIONS  = ['Mumbai', 'Delhi', 'Delhi NCR', 'Hyderabad', 'Bangalore']

const STATUS_TABS = [
  { key: 'all',         label: 'All' },
  { key: 'submitted',   label: 'Submitted' },
  { key: 'ai_reviewed', label: 'AI Reviewed' },
  { key: 'approved',    label: 'Approved' },
  { key: 'rejected',    label: 'Rejected' },
]

const STATUS_CFG: Record<string, { label: string; cls: string }> = {
  submitted:   { label: 'Submitted',    cls: 'bg-amber-50  text-amber-700  border-amber-200'   },
  ai_reviewed: { label: 'AI Reviewed',  cls: 'bg-blue-50   text-blue-700   border-blue-200'    },
  approved:    { label: 'Approved',     cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  rejected:    { label: 'Rejected',     cls: 'bg-red-50    text-red-700    border-red-200'      },
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso: string | null) {
  if (!iso) return '–'
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

function fmtDateFull(iso: string | null) {
  if (!iso) return '–'
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

function initials(name: string | null | undefined) {
  if (!name) return '?'
  return name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2)
}

function scoreColor(n: number) {
  if (n >= 80) return 'text-emerald-600'
  if (n >= 60) return 'text-amber-600'
  return 'text-red-600'
}

function scoreStroke(n: number) {
  if (n >= 80) return '#22c55e'
  if (n >= 60) return '#f59e0b'
  return '#ef4444'
}

function scoreGrade(n: number): { letter: string; label: string } {
  if (n >= 80) return { letter: 'A', label: 'Excellent' }
  if (n >= 60) return { letter: 'B', label: 'Good' }
  if (n >= 50) return { letter: 'C', label: 'Needs Improvement' }
  return { letter: 'D', label: 'Poor' }
}

// ── Queries ───────────────────────────────────────────────────────────────────

function useSubmissions() {
  return useQuery<Submission[]>({
    queryKey: ['roleplay_submissions_review'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('roleplay_submissions')
        .select('*, submitter_name, staff:staff!roleplay_submissions_staff_id_fkey(id, name), store:stores!roleplay_submissions_store_id_fkey(id, name), theme:themes!roleplay_submissions_theme_id_fkey(id, title, brief_text)')
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as unknown as Submission[]
    },
    staleTime: 30_000,
  })
}

function useTrainers() {
  return useQuery<TrainerMin[]>({
    queryKey: ['trainers_review'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('staff')
        .select('id, name')
        .eq('role', 'training_admin')
        .order('name')
      if (error) throw error
      return (data ?? []) as TrainerMin[]
    },
    staleTime: 5 * 60_000,
  })
}

function useStores() {
  return useQuery<StoreMin[]>({
    queryKey: ['stores'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('stores')
        .select('id, name, region, trainer_id, trainer_name')
        .order('name')
      if (error) throw error
      return (data ?? []) as StoreMin[]
    },
    staleTime: 5 * 60_000,
  })
}

// ── ScoreRing ─────────────────────────────────────────────────────────────────

function ScoreRing({ score, size = 88 }: { score: number; size?: number }) {
  const r    = (size - 14) / 2
  const circ = 2 * Math.PI * r
  const fill = circ * (score / 100)
  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90 absolute inset-0">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#f3f4f6" strokeWidth="7" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke={scoreStroke(score)} strokeWidth="7"
          strokeDasharray={`${fill} ${circ - fill}`}
          strokeLinecap="round" />
      </svg>
      <span className={cn('text-2xl font-bold', scoreColor(score))}>{scoreGrade(score).letter}</span>
    </div>
  )
}

// ── StatusBadge ───────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CFG[status] ?? { label: status, cls: 'bg-gray-50 text-gray-600 border-gray-200' }
  return <Badge variant="outline" className={cn('text-[10px]', cfg.cls)}>{cfg.label}</Badge>
}

// ── ScoreCell ─────────────────────────────────────────────────────────────────

function ScoreCell({ sub }: { sub: Submission }) {
  const score = sub.score_overridden && sub.trainer_score != null
    ? sub.trainer_score
    : sub.ai_score?.overall ?? null
  if (score == null) return <span className="text-xs text-muted-foreground">Pending</span>
  const grade = scoreGrade(score)
  return <span className={cn('text-sm font-bold', scoreColor(score))}>{grade.letter}</span>
}

// ── Main component ────────────────────────────────────────────────────────────

export default function RoleplayReviewPage() {
  const queryClient = useQueryClient()

  const { data: submissions = [], isLoading } = useSubmissions()
  const { data: stores = [] }                 = useStores()
  const { data: trainers = [] }               = useTrainers()

  // ── Filters ───────────────────────────────────────────────────────────────
  const [statusTab, setStatusTab]         = useState('all')
  const [search, setSearch]               = useState('')
  const [storeFilter, setStoreFilter]     = useState('all')
  const [trainerFilter, setTrainerFilter] = useState('all')
  const [regionFilter, setRegionFilter]   = useState('all')

  // ── Right panel ───────────────────────────────────────────────────────────
  const [selectedId, setSelectedId]       = useState<string | null>(null)
  const [briefExpanded, setBriefExpanded] = useState(false)

  // ── Score override ────────────────────────────────────────────────────────
  const [overrideExpanded, setOverrideExpanded]     = useState(false)
  const [overrideScore, setOverrideScore]           = useState(0)
  const [overrideBreakdown, setOverrideBreakdown]   = useState<AiBreakdown[]>([])
  const [overrideFeedback, setOverrideFeedback]     = useState('')
  const [savingOverride, setSavingOverride]         = useState(false)

  // ── Reject dialog ─────────────────────────────────────────────────────────
  const [rejectOpen, setRejectOpen]     = useState(false)
  const [rejectReason, setRejectReason] = useState('')

  // ── Action loading ────────────────────────────────────────────────────────
  const [approving, setApproving] = useState(false)
  const [rejecting, setRejecting] = useState(false)
  const [scoring, setScoring]     = useState(false)

  // Tracks submission IDs already dispatched for auto-scoring so we don't
  // re-invoke on subsequent re-renders / refetches.
  const scoringInFlight = useRef(new Set<string>())

  // ── Current user ──────────────────────────────────────────────────────────
  const [currentUserId, setCurrentUserId]     = useState<string | null>(null)
  const [currentUserName, setCurrentUserName] = useState<string | null>(null)
  const [currentUserRole, setCurrentUserRole] = useState<string | null>(null)
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return
      setCurrentUserId(user.id)
      supabase.from('staff').select('name, role').eq('id', user.id).single()
        .then(({ data }) => {
          setCurrentUserName(data?.name ?? user.email ?? null)
          setCurrentUserRole(data?.role ?? null)
        })
    })
  }, [])

  // ── Trainer-aware store filtering ─────────────────────────────────────────

  // Auto-scope: logged-in training_admin only sees their own assigned stores
  const assignedStoreIds = useMemo(() => {
    if (!currentUserId || currentUserRole !== 'training_admin') return null
    return new Set(stores.filter((s) => s.trainer_id === currentUserId).map((s) => s.id))
  }, [stores, currentUserId, currentUserRole])

  // Manual filter: admin selects a specific trainer from the dropdown
  const trainerFilterStoreIds = useMemo(() => {
    if (trainerFilter === 'all') return null
    return new Set(stores.filter((s) => s.trainer_id === trainerFilter).map((s) => s.id))
  }, [stores, trainerFilter])

  // Fast store lookup by id (used for region matching on submissions)
  const storeById = useMemo(
    () => new Map(stores.map((s) => [s.id, s])),
    [stores],
  )

  // Store dropdown only shows stores the current user is allowed to see,
  // further narrowed by trainer + region filters if active
  const visibleStores = useMemo(() => {
    let list = assignedStoreIds
      ? stores.filter((s) => assignedStoreIds.has(s.id))
      : stores
    if (trainerFilterStoreIds) {
      list = list.filter((s) => trainerFilterStoreIds.has(s.id))
    }
    if (regionFilter !== 'all') {
      list = list.filter((s) => s.region === regionFilter)
    }
    return list
  }, [stores, assignedStoreIds, trainerFilterStoreIds, regionFilter])

  // ── Derived ───────────────────────────────────────────────────────────────
  const filtered = submissions.filter((s) => {
    const q = search.trim().toLowerCase()
    const matchStatus        = statusTab === 'all' || s.status === statusTab
    const matchStore         = storeFilter === 'all' || s.store_id === storeFilter
    const matchAutoScope     = !assignedStoreIds || assignedStoreIds.has(s.store_id)
    const matchTrainerFilter = !trainerFilterStoreIds || trainerFilterStoreIds.has(s.store_id)
    const matchRegion        = regionFilter === 'all' ||
      storeById.get(s.store_id)?.region === regionFilter
    const matchSearch        = !q ||
      (s.submitter_name ?? s.staff?.name ?? '').toLowerCase().includes(q) ||
      (s.store?.name ?? '').toLowerCase().includes(q) ||
      (s.theme?.title ?? '').toLowerCase().includes(q)
    return matchStatus && matchStore && matchAutoScope && matchTrainerFilter && matchRegion && matchSearch
  })

  const selected          = submissions.find((s) => s.id === selectedId) ?? null
  const selectedStoreInfo = stores.find((s) => s.id === selected?.store_id) ?? null

  // Reset panel + override form when selection changes
  useEffect(() => {
    setBriefExpanded(false)
    setOverrideExpanded(false)
    const sub = submissions.find((s) => s.id === selectedId)
    if (sub?.score_overridden) {
      setOverrideScore(sub.trainer_score ?? 0)
      setOverrideFeedback(sub.trainer_feedback ?? '')
    } else if (sub?.ai_score) {
      setOverrideScore(sub.ai_score?.overall ?? 0)
      setOverrideFeedback('')
    } else {
      setOverrideScore(0)
      setOverrideFeedback('')
    }
    setOverrideBreakdown(sub?.ai_score?.invalid ? [] : (sub?.ai_score?.breakdown ?? []))
  }, [selectedId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-compute overall from breakdown whenever dimension scores change
  useEffect(() => {
    if (overrideBreakdown.length === 0) return
    const req = overrideBreakdown
      .filter((d) => !d.is_bonus)
      .reduce((sum, d) => sum + d.score, 0)
    setOverrideScore(Math.round((req / 24) * 100))
  }, [overrideBreakdown])

  // ── Mutations ─────────────────────────────────────────────────────────────
  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['roleplay_submissions_review'] })
    queryClient.invalidateQueries({ queryKey: ['roleplay_submissions', 'all'] })
  }

  // Auto-score any submission that is still in 'submitted' state.
  // Uses a ref-based set so each ID is only dispatched once per page load,
  // preventing re-invocation on the refetch that follows scoring completion.
  useEffect(() => {
    const toScore = submissions.filter(
      (s) => s.status === 'submitted' && !scoringInFlight.current.has(s.id),
    )
    if (toScore.length === 0) return

    toScore.forEach((s) => scoringInFlight.current.add(s.id))

    Promise.all(
      toScore.map((s) =>
        supabase.functions.invoke('score-roleplay', { body: { submission_id: s.id } }),
      ),
    ).then(() => {
      queryClient.invalidateQueries({ queryKey: ['roleplay_submissions_review'] })
      queryClient.invalidateQueries({ queryKey: ['roleplay_submissions', 'all'] })
    }).catch(() => {
      // Scoring failures are silent here; trainers can re-score manually from the panel.
    })
  }, [submissions, queryClient])

  async function handleApprove() {
    if (!selectedId) return
    setApproving(true)
    try {
      const { error } = await supabase.from('roleplay_submissions').update({
        status:      'approved',
        approved_by: currentUserName,
        approved_at: new Date().toISOString(),
      }).eq('id', selectedId)
      if (error) throw error
      invalidate()
      toast.success('Submission approved')
    } catch (e) {
      toast.error(`Failed: ${(e as Error).message}`)
    } finally { setApproving(false) }
  }

  async function handleReject() {
    if (!selectedId) return
    setRejecting(true)
    try {
      const { error } = await supabase.from('roleplay_submissions').update({
        status:          'rejected',
        rejected_reason: rejectReason.trim() || null,
      }).eq('id', selectedId)
      if (error) throw error
      invalidate()
      setRejectOpen(false)
      setRejectReason('')
      toast.success('Submission rejected')
    } catch (e) {
      toast.error(`Failed: ${(e as Error).message}`)
    } finally { setRejecting(false) }
  }

  async function handleUndo() {
    if (!selectedId) return
    try {
      const { error } = await supabase.from('roleplay_submissions').update({
        status:          'ai_reviewed',
        approved_by:     null,
        approved_at:     null,
        rejected_reason: null,
      }).eq('id', selectedId)
      if (error) throw error
      invalidate()
      toast.success('Status reset')
    } catch (e) {
      toast.error(`Failed: ${(e as Error).message}`)
    }
  }

  async function handleScore() {
    if (!selectedId) return
    setScoring(true)
    try {
      const { error } = await supabase.functions.invoke('score-roleplay', {
        body: { submission_id: selectedId },
      })
      if (error) throw error
      invalidate()
      toast.success('AI scoring complete')
    } catch (e) {
      toast.error(`Scoring failed: ${(e as Error).message}`)
    } finally { setScoring(false) }
  }

  async function handleSaveOverride() {
    if (!selectedId || !selected) return
    setSavingOverride(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      const authUserId    = user?.id ?? null
      const originalScore = selected.ai_score?.overall ?? null

      // Write to score_overrides for audit trail + Gemini calibration
      const { error: overrideErr } = await supabase.from('score_overrides').insert({
        submission_id:      selectedId,
        original_score:     originalScore,
        override_score:     overrideScore,
        trainer_notes:      overrideFeedback.trim() || null,
        trainer_id:         authUserId,
        // breakdown_override: overrideBreakdown.length > 0 ? overrideBreakdown : null,
      })
      if (overrideErr) {
        console.error('score_overrides insert error:', overrideErr)
        throw overrideErr
      }

      // Keep denormalised fields on the submission for fast display
      const { error: subErr } = await supabase.from('roleplay_submissions').update({
        trainer_score:    overrideScore,
        trainer_feedback: overrideFeedback.trim() || null,
        score_overridden: true,
        reviewed_by:      currentUserId,
        reviewed_by_name: currentUserName,
        reviewed_at:      new Date().toISOString(),
      }).eq('id', selectedId)
      if (subErr) throw subErr

      invalidate()
      setOverrideExpanded(false)
      toast.success('Score override saved')
    } catch (e) {
      toast.error(`Failed: ${(e as Error).message}`)
    } finally { setSavingOverride(false) }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-[calc(100vh-7rem)] flex-col">
      <div className="flex min-h-0 flex-1 gap-4">

        {/* ── LEFT PANEL ─────────────────────────────────────────────────── */}
        <div className="flex min-h-0 w-[55%] flex-col gap-3">

          {/* Status tabs */}
          <div className="flex-shrink-0">
            <div className="inline-flex flex-wrap rounded-full bg-gray-100 p-0.5">
              {STATUS_TABS.filter(Boolean).map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setStatusTab(key)}
                  className={cn(
                    'rounded-full px-3 py-1.5 text-xs font-semibold transition-all',
                    statusTab === key ? 'text-white shadow-sm' : 'text-gray-500 hover:text-gray-700',
                  )}
                  style={statusTab === key ? { backgroundColor: ACCENT } : undefined}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Search + trainer + store + region filters */}
          <div className="flex flex-shrink-0 flex-wrap gap-2">
            <div className="relative min-w-0 flex-1">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by staff, store, or theme…"
                className="pl-8 text-xs"
              />
            </div>
            {trainers.length > 0 && (
              <Select value={trainerFilter} onValueChange={(v) => { setTrainerFilter(v); setStoreFilter('all') }}>
                <SelectTrigger className="w-36 text-xs">
                  <SelectValue placeholder="All Trainers" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Trainers</SelectItem>
                  {trainers.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
            <Select value={storeFilter} onValueChange={setStoreFilter}>
              <SelectTrigger className="w-36 text-xs">
                <SelectValue placeholder="All Stores" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Stores</SelectItem>
                {visibleStores.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={regionFilter} onValueChange={(v) => { setRegionFilter(v); setStoreFilter('all') }}>
              <SelectTrigger className="w-36 text-xs">
                <SelectValue placeholder="All Regions" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Regions</SelectItem>
                {REGIONS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {/* Table */}
          <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-gray-100 bg-white">
            {isLoading ? (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                Loading…
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 py-16 text-center">
                <Video className="h-8 w-8 text-gray-300" />
                <p className="text-sm text-gray-500">
                  {submissions.length === 0
                    ? 'No submissions yet. Staff submit roleplays from the Pawsuit app.'
                    : 'No submissions match your filters.'}
                </p>
              </div>
            ) : (
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-gray-50 shadow-[0_1px_0_#f3f4f6]">
                  <tr>
                    <th className="px-4 py-2.5 text-left font-medium text-gray-500">Staff</th>
                    <th className="px-3 py-2.5 text-left font-medium text-gray-500">Submitted by</th>
                    <th className="px-3 py-2.5 text-left font-medium text-gray-500">Store</th>
                    <th className="px-3 py-2.5 text-left font-medium text-gray-500">Theme</th>
                    <th className="px-3 py-2.5 text-left font-medium text-gray-500">Date</th>
                    <th className="px-3 py-2.5 text-left font-medium text-gray-500">Status</th>
                    <th className="px-4 py-2.5 text-left font-medium text-gray-500">Score</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filtered.map((sub) => {
                    const isSelected = sub.id === selectedId
                    return (
                      <tr
                        key={sub.id}
                        onClick={() => setSelectedId(sub.id)}
                        className={cn(
                          'cursor-pointer transition-colors',
                          isSelected
                            ? 'bg-orange-50/60 border-l-2 border-l-[#E8642C]'
                            : 'hover:bg-gray-50/70',
                        )}
                      >
                        <td className="px-4 py-2.5 font-medium text-gray-900">
                          {sub.staff?.name ?? '–'}
                        </td>
                        <td className="px-3 py-2.5 text-muted-foreground">
                          {sub.submitter_name ?? sub.staff?.name ?? '–'}
                        </td>
                        <td className="px-3 py-2.5 text-muted-foreground">
                          {sub.store?.name ?? '–'}
                        </td>
                        <td className="max-w-[120px] truncate px-3 py-2.5 text-muted-foreground"
                          title={sub.theme?.title}>
                          {sub.theme?.title ?? '–'}
                        </td>
                        <td className="px-3 py-2.5 text-muted-foreground">
                          {fmtDate(sub.created_at)}
                        </td>
                        <td className="px-3 py-2.5">
                          <StatusBadge status={sub.status} />
                        </td>
                        <td className="px-4 py-2.5">
                          <ScoreCell sub={sub} />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* ── RIGHT PANEL ────────────────────────────────────────────────── */}
        <div className="flex w-[45%] flex-col overflow-hidden rounded-xl border border-gray-200 bg-white">
          {!selected ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#E8642C]/10">
                <Play className="h-6 w-6 text-[#E8642C]" />
              </div>
              <p className="text-sm font-medium text-gray-700">Select a submission to review</p>
              <p className="text-xs text-muted-foreground">Click any row on the left</p>
            </div>
          ) : (
            <>
              {/* Scrollable content */}
              <div className="flex-1 overflow-y-auto">

                {/* Header */}
                <div className="border-b border-gray-100 p-4">
                  <div className="flex items-start gap-3">
                    <div
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
                      style={{ backgroundColor: ACCENT }}
                    >
                      {initials(selected.submitter_name ?? selected.staff?.name)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium text-muted-foreground">Submitted by</p>
                      <p className="text-base font-bold text-gray-900 leading-tight">
                        {selected.submitter_name ?? selected.staff?.name ?? '–'}
                      </p>
                      {selected.submitter_name && selected.staff?.name && selected.submitter_name !== selected.staff.name && (
                        <p className="text-[11px] text-muted-foreground">
                          Account: {selected.staff.name}
                        </p>
                      )}
                      <p className="text-xs text-muted-foreground">
                        {selected.store?.name ?? '–'} · {fmtDateFull(selected.created_at)}
                      </p>
                      <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                        <span>👨‍🏫</span>
                        {selectedStoreInfo?.trainer_name
                          ? `Trainer: ${selectedStoreInfo.trainer_name}`
                          : <span className="text-gray-400">No trainer assigned</span>}
                      </p>
                    </div>
                    <StatusBadge status={selected.status} />
                  </div>

                  {/* Theme */}
                  <div className="mt-3">
                    <p className="text-sm font-semibold text-gray-900">
                      {selected.theme?.title ?? '–'}
                    </p>
                    {selected.theme?.brief_text && (
                      <div className="mt-1">
                        <p className="text-xs text-muted-foreground">
                          {briefExpanded
                            ? selected.theme.brief_text
                            : selected.theme.brief_text.slice(0, 100) +
                              (selected.theme.brief_text.length > 100 ? '…' : '')}
                        </p>
                        {selected.theme.brief_text.length > 100 && (
                          <button
                            onClick={() => setBriefExpanded((v) => !v)}
                            className="mt-0.5 flex items-center gap-0.5 text-[11px] font-medium"
                            style={{ color: ACCENT }}
                          >
                            {briefExpanded
                              ? <><ChevronUp className="h-3 w-3" />Read less</>
                              : <><ChevronDown className="h-3 w-3" />Read more</>}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Video player */}
                <div className="border-b border-gray-100 p-4">
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                    Video Submission
                  </p>
                  {selected.video_url ? (
                    <video
                      key={selected.id}
                      src={selected.video_url}
                      controls
                      className="w-full rounded-lg bg-black"
                      style={{ maxHeight: 200 }}
                    >
                      Your browser does not support the video element.
                    </video>
                  ) : (
                    <div className="flex items-center justify-center gap-2 rounded-lg bg-gray-50 py-8 text-sm text-muted-foreground">
                      <AlertCircle className="h-4 w-4 text-gray-300" />
                      No video available
                    </div>
                  )}
                </div>

                {/* Score section */}
                <div className="p-4">
                  <div className="mb-3 flex items-center gap-2">
                    <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                      Score
                    </p>
                    {selected.score_overridden ? (
                      <Badge className="border-orange-200 bg-orange-50 text-[10px] text-orange-700">
                        Trainer Reviewed
                      </Badge>
                    ) : selected.ai_score ? (
                      <Badge variant="outline" className="border-gray-200 text-[10px] text-gray-500">
                        AI Score
                      </Badge>
                    ) : null}
                  </div>

                  {/* Overridden display (not in edit mode) */}
                  {selected.score_overridden && !overrideExpanded && (
                    <div className="space-y-3">
                      {(selected.submitter_name ?? selected.staff?.name) && (
                        <p className="text-xs text-muted-foreground">
                          <span className="font-medium text-gray-700">Submitted by:</span>{' '}
                          {selected.submitter_name ?? selected.staff?.name}
                        </p>
                      )}
                      <div className="flex items-center gap-4">
                        <ScoreRing score={selected.trainer_score!} />
                        <div>
                          <p className={cn('text-3xl font-bold leading-none', scoreColor(selected.trainer_score!))}>
                            {scoreGrade(selected.trainer_score!).letter}
                          </p>
                          <p className="mt-0.5 text-xs font-medium text-gray-600">
                            {scoreGrade(selected.trainer_score!).label}
                          </p>
                        </div>
                      </div>
                      {selected.reviewed_by_name && (
                        <p className="text-xs text-muted-foreground">
                          Reviewed by {selected.reviewed_by_name} on {fmtDateFull(selected.reviewed_at)}
                        </p>
                      )}
                      {selected.trainer_feedback && (
                        <div className="rounded-lg bg-orange-50 px-3 py-2.5">
                          <p className="mb-1 text-[11px] font-semibold text-orange-700">Trainer Feedback</p>
                          <p className="text-xs text-orange-600">{selected.trainer_feedback}</p>
                        </div>
                      )}
                      <Button
                        variant="outline" size="sm"
                        onClick={() => setOverrideExpanded(true)}
                        className="w-full gap-1.5 text-xs"
                        style={{ borderColor: ACCENT, color: ACCENT }}
                      >
                        ✏️ Edit Override
                      </Button>
                    </div>
                  )}

                  {/* Invalid submission */}
                  {!selected.score_overridden && selected.ai_score?.invalid && (
                    <div className="rounded-lg bg-gray-50 px-3 py-3 text-xs text-gray-600">
                      <p className="font-medium text-gray-700">Invalid submission</p>
                      {selected.ai_score.reason && (
                        <p className="mt-1 text-muted-foreground">{selected.ai_score.reason}</p>
                      )}
                    </div>
                  )}

                  {/* Normal AI score display */}
                  {!selected.score_overridden && selected.ai_score && !selected.ai_score.invalid && (
                    <div className="space-y-4">
                      {(selected.submitter_name ?? selected.staff?.name) && (
                        <p className="text-xs text-muted-foreground">
                          <span className="font-medium text-gray-700">Submitted by:</span>{' '}
                          {selected.submitter_name ?? selected.staff?.name}
                        </p>
                      )}
                      <div className="flex items-center gap-4">
                        <ScoreRing score={selected.ai_score?.overall ?? 0} />
                        <div>
                          <p className={cn('text-3xl font-bold leading-none', scoreColor(selected.ai_score?.overall ?? 0))}>
                            {scoreGrade(selected.ai_score?.overall ?? 0).letter}
                          </p>
                          <p className="mt-0.5 text-xs font-medium text-gray-600">
                            {scoreGrade(selected.ai_score?.overall ?? 0).label}
                          </p>
                        </div>
                      </div>

                      {(selected.ai_score?.breakdown ?? []).map((dim) => {
                        const pct = Math.round((dim.score / (dim.max_score ?? 1)) * 100)
                        return (
                          <div key={dim.dimension} className="space-y-1">
                            <div className="flex items-center justify-between text-xs">
                              <span className="font-medium text-gray-700">{dim.dimension}</span>
                              <span className={cn('font-bold', scoreColor(pct))}>
                                {scoreGrade(pct).letter}
                              </span>
                            </div>
                            <Progress value={pct} className="h-1.5" />
                            <p className="text-[11px] text-muted-foreground">{dim.feedback}</p>
                          </div>
                        )
                      })}

                      {selected.ai_score.summary && (
                        <div className="rounded-lg bg-gray-50 px-3 py-2.5">
                          <p className="text-xs italic text-gray-600">{selected.ai_score.summary}</p>
                        </div>
                      )}

                      <Button
                        variant="outline" size="sm"
                        onClick={handleScore}
                        disabled={scoring}
                        className="w-full gap-1.5 text-xs"
                        style={{ borderColor: ACCENT, color: ACCENT }}
                      >
                        {scoring
                          ? <><RotateCcw className="h-3.5 w-3.5 animate-spin" /> Analysing video…</>
                          : <><Sparkles className="h-3.5 w-3.5" /> Re-score with Gemini</>}
                      </Button>

                      {!overrideExpanded && (
                        <button
                          onClick={() => setOverrideExpanded(true)}
                          className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-gray-200 py-2 text-xs font-medium text-gray-500 hover:border-gray-300 hover:text-gray-700"
                        >
                          ✏️ Override this score
                        </button>
                      )}
                    </div>
                  )}

                  {/* Not yet scored */}
                  {!selected.score_overridden && !selected.ai_score && (
                    <div className="space-y-3">
                      <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 py-8 text-center">
                        <Sparkles className="mx-auto mb-2 h-6 w-6 text-gray-300" />
                        <p className="text-sm font-medium text-gray-500">Not yet scored</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          Click below to analyse with Gemini AI
                        </p>
                      </div>
                      <Button
                        onClick={handleScore}
                        disabled={scoring}
                        className="w-full gap-1.5 text-xs text-white hover:opacity-90"
                        style={{ backgroundColor: ACCENT }}
                      >
                        {scoring
                          ? <><RotateCcw className="h-3.5 w-3.5 animate-spin" /> Analysing video…</>
                          : <><Sparkles className="h-3.5 w-3.5" /> Score with Gemini AI</>}
                      </Button>
                    </div>
                  )}

                  {/* Override form */}
                  {overrideExpanded && (
                    <div className="mt-4 space-y-3 rounded-lg border border-orange-200 bg-orange-50/30 p-3">
                      <p className="text-xs font-semibold text-gray-700">Override AI Score</p>

                      {/* Per-dimension inputs */}
                      {overrideBreakdown.length > 0 && (
                        <div className="space-y-1.5">
                          <label className="text-[11px] font-medium text-gray-500">Dimension Scores</label>
                          <div className="grid grid-cols-2 gap-x-3 gap-y-2">
                            {overrideBreakdown.map((dim) => (
                              <div key={dim.dimension} className="space-y-0.5">
                                <div className="flex items-center justify-between gap-1">
                                  <label className="truncate text-[10px] font-medium leading-tight text-gray-600">
                                    {dim.dimension}
                                    {dim.is_bonus && (
                                      <span className="ml-1 rounded px-0.5 text-[8px] bg-purple-100 text-purple-600">bonus</span>
                                    )}
                                  </label>
                                  <span className="shrink-0 text-[10px] text-muted-foreground">/ {dim.max_score ?? 1}</span>
                                </div>
                                <Input
                                  type="number" min="0" max={dim.max_score ?? 1}
                                  value={dim.score}
                                  onChange={(e) => {
                                    const val = Math.min(Math.max(0, Number(e.target.value)), dim.max_score ?? 1)
                                    setOverrideBreakdown((prev) =>
                                      prev.map((d) => d.dimension === dim.dimension ? { ...d, score: val } : d)
                                    )
                                  }}
                                  className="h-7 text-xs"
                                />
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Overall (auto-computed from criteria, manually adjustable) */}
                      <div className="space-y-1">
                        <div className="flex items-center justify-between">
                          <label className="text-xs font-medium text-gray-600">Overall Score (0–100)</label>
                          {overrideBreakdown.length > 0 && (
                            <span className="text-[10px] text-muted-foreground">auto-computed</span>
                          )}
                        </div>
                        <Input
                          type="number" min="0" max="100"
                          value={overrideScore}
                          onChange={(e) => setOverrideScore(Number(e.target.value))}
                          className="h-8 text-xs"
                        />
                      </div>

                      <div className="space-y-1">
                        <label className="text-xs font-medium text-gray-600">Trainer Feedback</label>
                        <textarea
                          value={overrideFeedback}
                          onChange={(e) => setOverrideFeedback(e.target.value)}
                          placeholder="Add your feedback…"
                          rows={3}
                          className="w-full resize-none rounded-lg border border-input bg-transparent px-3 py-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
                        />
                      </div>
                      <div className="flex gap-2">
                        <Button
                          onClick={handleSaveOverride}
                          disabled={savingOverride}
                          className="flex-1 text-xs text-white hover:opacity-90"
                          style={{ backgroundColor: ACCENT }}
                        >
                          {savingOverride ? 'Saving…' : 'Save Override'}
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => setOverrideExpanded(false)}
                          disabled={savingOverride}
                          className="text-xs"
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Sticky action bar */}
              <div className="flex-shrink-0 border-t border-gray-100 bg-white p-3 space-y-2">
                {selected.status === 'approved' ? (
                  <>
                    <div className="flex items-center justify-between rounded-lg bg-emerald-50 px-3 py-2.5 text-xs text-emerald-700">
                      <span>
                        <span className="font-semibold">Approved</span>
                        {selected.approved_by && ` by ${selected.approved_by}`}
                        {selected.approved_at && ` on ${fmtDateFull(selected.approved_at)}`}
                      </span>
                      <button
                        onClick={handleUndo}
                        className="ml-2 text-[11px] underline-offset-2 hover:underline"
                      >
                        Undo
                      </button>
                    </div>
                  </>
                ) : selected.status === 'rejected' ? (
                  <>
                    <div className="rounded-lg bg-red-50 px-3 py-2.5 text-xs text-red-700">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold">Rejected</span>
                        <button
                          onClick={handleUndo}
                          className="text-[11px] underline-offset-2 hover:underline"
                        >
                          Undo
                        </button>
                      </div>
                      {selected.rejected_reason && (
                        <p className="mt-0.5 text-red-600">{selected.rejected_reason}</p>
                      )}
                    </div>
                  </>
                ) : (
                  <>
                    <Button
                      onClick={handleApprove}
                      disabled={approving}
                      className="w-full gap-1.5 bg-emerald-600 text-xs text-white hover:bg-emerald-700"
                    >
                      <ThumbsUp className="h-3.5 w-3.5" />
                      {approving ? 'Approving…' : '✓ Approve'}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => setRejectOpen(true)}
                      className="w-full gap-1.5 border-red-200 text-xs text-red-600 hover:bg-red-50 hover:text-red-700"
                    >
                      <ThumbsDown className="h-3.5 w-3.5" />
                      ✗ Reject
                    </Button>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Reject dialog ────────────────────────────────────────────────── */}
      <Dialog open={rejectOpen} onOpenChange={(open) => { if (!open) { setRejectOpen(false); setRejectReason('') } }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm">Reject Submission</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <p className="text-xs text-muted-foreground">
              Optionally provide a reason to help the staff member improve.
            </p>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="e.g. Product knowledge needs improvement on the premium dry food range…"
              rows={4}
              className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 resize-none"
            />
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" size="sm">Cancel</Button>
            </DialogClose>
            <Button
              size="sm"
              disabled={rejecting}
              onClick={handleReject}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {rejecting ? 'Rejecting…' : 'Confirm Reject'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
