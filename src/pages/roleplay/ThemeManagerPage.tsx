import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  BookOpen, Pencil, Trash2, Eye, EyeOff, Zap, Search,
  CheckCircle2, AlertTriangle, ExternalLink, MapPin,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
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

type Theme = {
  id: string
  title: string
  brief_text: string
  is_active: boolean
  created_at: string
  launch_date: string | null
  expiry_date: string | null
  submission_deadline_days: number | null
}

type AssignmentScope = 'all' | 'region' | 'store'

type ThemeAssignment = {
  id?: string
  theme_id: string
  scope: AssignmentScope
  store_id: string | null
  region: string | null      // comma-separated when multiple regions
}

type StoreMin = { id: string; name: string }

const REGIONS = ['Mumbai', 'Delhi', 'Delhi NCR', 'Hyderabad', 'Bangalore']

// ── Sample themes ─────────────────────────────────────────────────────────────

const SAMPLE_THEMES: Omit<Theme, 'id' | 'created_at'>[] = [
  {
    title: 'Premium Dry Food Recommendation',
    is_active: true,
    brief_text: `A customer is looking at budget dry food options. Your goal is to guide them toward a premium brand without being pushy.

**Key points to cover:**
- Ask about the pet's age, breed, and any health concerns before recommending
- Explain the cost-per-day difference — premium food lasts longer and uses better ingredients
- Mention vet-endorsed brands (Royal Canin, Orijen, Acana) by name
- Offer a trial-size pack for hesitant customers

**Objection to handle:** "It's too expensive compared to what I usually buy."`,
  },
  {
    title: 'Win-Back Lapsed Customer',
    is_active: true,
    brief_text: `A customer who hasn't visited in 60+ days walks in. Your goal is to re-engage them warmly and understand why they lapsed.

**Key points to cover:**
- Open warmly — acknowledge the gap without making them feel guilty
- Diagnose the reason: budget, moved, tried another store, or pet preference changed?
- Introduce any new arrivals or restocked products since their last visit
- Mention loyalty points balance if they're in the program

**Objection to handle:** "I've been buying online — it's just easier."`,
  },
  {
    title: 'Handling Price Objections',
    is_active: true,
    brief_text: `A customer questions why HUFT products are priced higher than online stores. Defend the value confidently without discounting.

**Key points to cover:**
- **Never apologise for price.** Shift the conversation to value and trust
- Break down cost-per-day vs cost-per-bag — premium food is more nutritionally dense
- Highlight HUFT advantages: expert staff, genuine products, returns policy
- Offer loyalty points as a softener — not a discount

**Objection to handle:** "I can get the same thing 30% cheaper on Amazon."`,
  },
  {
    title: 'New Customer Onboarding',
    is_active: false,
    brief_text: `A first-time customer walks in with a new puppy. This is your chance to turn them into a loyal HUFT customer.

**Key points to cover:**
- Welcome them and ask about the puppy: breed, age, and what they already have at home
- Walk them through the store sections relevant to their pet (food, treats, accessories)
- Explain the HUFT loyalty programme and sign them up before they leave
- Recommend the new pet starter bundle if applicable

**Goal:** Leave them feeling guided, not overwhelmed. They should walk out with a clear plan.`,
  },
  {
    title: 'Upselling Accessories Bundle',
    is_active: true,
    brief_text: `A customer is buying food and nothing else. Your goal is to naturally add accessories to the basket.

**Key points to cover:**
- Use a needs-assessment question: "Do you have everything else you need at home?"
- Suggest a logical bundle: food + treats + a toy relevant to their pet size
- Demonstrate or describe the product if possible — physical touch increases purchase intent
- Keep it to 1-2 add-ons maximum — don't overwhelm

**Upsell trigger phrases:**
- "While you're here, we just got in some great new interactive toys for [breed]…"
- "Most customers buying that food also pick up [product] — want me to show you?"`,
  },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

function todayISO() {
  const d = new Date()
  return d.toISOString().slice(0, 10)
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

function fmtDateOpt(iso: string | null) {
  if (!iso) return '—'
  return fmtDate(iso)
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

// Simple markdown: **bold**, *italic*, paragraphs, line breaks
function renderMarkdown(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((para) => {
      const html = para
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/\n/g, '<br />')
      return `<p class="mb-2 last:mb-0">${html}</p>`
    })
    .join('')
}

// ── Queries ───────────────────────────────────────────────────────────────────

function useThemes() {
  return useQuery<Theme[]>({
    queryKey: ['themes_mgmt'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('themes')
        .select('*')
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as Theme[]
    },
    staleTime: 30_000,
  })
}

function useSubmissionCounts() {
  return useQuery<Map<string, number>>({
    queryKey: ['submission_counts_by_theme'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('roleplay_submissions')
        .select('theme_id')
      if (error) throw error
      const map = new Map<string, number>()
      for (const row of (data ?? []) as { theme_id: string }[]) {
        map.set(row.theme_id, (map.get(row.theme_id) ?? 0) + 1)
      }
      return map
    },
    staleTime: 60_000,
  })
}

function useAssignments() {
  return useQuery<Map<string, ThemeAssignment>>({
    queryKey: ['theme_assignments'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('theme_assignments')
        .select('id, theme_id, scope, store_id, region')
      if (error) throw error
      const map = new Map<string, ThemeAssignment>()
      for (const row of (data ?? []) as ThemeAssignment[]) {
        map.set(row.theme_id, row)
      }
      return map
    },
    staleTime: 30_000,
  })
}


function useStoresList() {
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

// ── AssignmentBadge ───────────────────────────────────────────────────────────

function AssignmentBadge({ assignment, storeName }: {
  assignment: ThemeAssignment | undefined
  storeName?: string
}) {
  if (!assignment) return <span className="text-[11px] text-gray-400">—</span>

  if (assignment.scope === 'all') {
    return (
      <Badge variant="outline" className="text-[10px] bg-blue-50 text-blue-700 border-blue-200 gap-1">
        <MapPin className="h-2.5 w-2.5" /> All Stores
      </Badge>
    )
  }
  if (assignment.scope === 'region') {
    const regions = assignment.region?.split(',').map((r) => r.trim()).filter(Boolean) ?? []
    if (regions.length === 0) return <span className="text-[11px] text-gray-400">—</span>
    if (regions.length === 1) {
      return (
        <Badge variant="outline" className="text-[10px] bg-purple-50 text-purple-700 border-purple-200 gap-1">
          <MapPin className="h-2.5 w-2.5" /> {regions[0]}
        </Badge>
      )
    }
    return (
      <Badge variant="outline" className="text-[10px] bg-purple-50 text-purple-700 border-purple-200 gap-1">
        <MapPin className="h-2.5 w-2.5" /> {regions[0]} +{regions.length - 1}
      </Badge>
    )
  }
  return (
    <Badge variant="outline" className="text-[10px] bg-orange-50 text-orange-700 border-orange-200 gap-1">
      <MapPin className="h-2.5 w-2.5" /> {storeName ?? assignment.store_id}
    </Badge>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ThemeManagerPage() {
  const navigate     = useNavigate()
  const queryClient  = useQueryClient()

  const { data: themes = [], isLoading }         = useThemes()
  const { data: subCounts = new Map() }          = useSubmissionCounts()
  const { data: assignments = new Map() }        = useAssignments()
  const { data: storesList = [] }                = useStoresList()

  // ── Form state ────────────────────────────────────────────────────────────
  const [editingId, setEditingId]     = useState<string | null>(null)
  const [title, setTitle]             = useState('')
  const [briefText, setBriefText]     = useState('')
  const [isActive, setIsActive]       = useState(true)
  const [showPreview, setShowPreview] = useState(false)
  const [saving, setSaving]           = useState(false)
  const [launchDate, setLaunchDate]               = useState(todayISO)
  const [expiryDate, setExpiryDate]               = useState('')
  const [submissionDeadlineDays, setSubmissionDeadlineDays] = useState(4)

  // ── Assignment state ──────────────────────────────────────────────────────
  const [assignScope, setAssignScope]       = useState<AssignmentScope>('all')
  const [assignRegions, setAssignRegions]   = useState<string[]>([])
  const [assignStoreId, setAssignStoreId]   = useState('')

  // ── Table state ───────────────────────────────────────────────────────────
  const [search, setSearch]             = useState('')
  const [deleteTarget, setDeleteTarget] = useState<Theme | null>(null)
  const [deleting, setDeleting]         = useState(false)
  const [loadingSamples, setLoadingSamples] = useState(false)

  // ── Derived ───────────────────────────────────────────────────────────────
  const filtered = themes.filter((t) =>
    !search.trim() || t.title.toLowerCase().includes(search.trim().toLowerCase()),
  )

  const activeCount = themes.filter((t) => t.is_active).length
  const totalSubs   = Array.from(subCounts.values()).reduce((a, b) => a + b, 0)

  const isEditing  = editingId !== null
  const editingTheme = themes.find((t) => t.id === editingId)

  // ── Helpers ───────────────────────────────────────────────────────────────
  function resetForm() {
    setEditingId(null); setTitle(''); setBriefText('')
    setIsActive(true); setShowPreview(false)
    setLaunchDate(todayISO()); setExpiryDate(''); setSubmissionDeadlineDays(4)
    setAssignScope('all'); setAssignRegions([]); setAssignStoreId('')
  }

  function startEdit(theme: Theme) {
    setEditingId(theme.id); setTitle(theme.title)
    setBriefText(theme.brief_text); setIsActive(theme.is_active)
    setLaunchDate(theme.launch_date ?? todayISO())
    setExpiryDate(theme.expiry_date ?? '')
    setSubmissionDeadlineDays(theme.submission_deadline_days ?? 4)
    setShowPreview(false)
    const existing = assignments.get(theme.id)
    setAssignScope(existing?.scope ?? 'all')
    setAssignRegions(existing?.region ? existing.region.split(',').map((r) => r.trim()).filter(Boolean) : [])
    setAssignStoreId(existing?.store_id ?? '')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function toggleRegion(r: string) {
    setAssignRegions((prev) =>
      prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r],
    )
  }

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['themes_mgmt'] })
    queryClient.invalidateQueries({ queryKey: ['theme_assignments'] })
  }

  // ── Mutations ─────────────────────────────────────────────────────────────
  async function saveAssignment(themeId: string) {
    const { error } = await supabase.from('theme_assignments').upsert({
      theme_id: themeId,
      scope:    assignScope,
      region:   assignScope === 'region' ? assignRegions.join(',') || null : null,
      store_id: assignScope === 'store'  ? assignStoreId || null   : null,
    }, { onConflict: 'theme_id' })
    if (error) throw error
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) return
    setSaving(true)
    try {
      const payload = {
        title: title.trim(),
        brief_text: briefText,
        is_active: isActive,
        launch_date: launchDate || null,
        expiry_date: expiryDate || null,
        submission_deadline_days: submissionDeadlineDays,
      }
      if (isEditing) {
        const { error } = await supabase.from('themes').update(payload).eq('id', editingId!)
        if (error) throw error
        await saveAssignment(editingId!)
        toast.success('Theme updated')
      } else {
        const { data, error } = await supabase.from('themes').insert(payload).select('id').single()
        if (error) throw error
        await saveAssignment(data.id)
        toast.success('Theme published')
      }
      invalidate()
      resetForm()
    } catch (e) {
      toast.error(`Failed: ${(e as Error).message}`)
    } finally { setSaving(false) }
  }

  async function handleToggleActive(theme: Theme) {
    try {
      const { error } = await supabase.from('themes')
        .update({ is_active: !theme.is_active })
        .eq('id', theme.id)
      if (error) throw error
      invalidate()
      toast.success(theme.is_active ? 'Theme set to Draft' : 'Theme set to Live')
    } catch (e) {
      toast.error(`Failed: ${(e as Error).message}`)
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      const { error } = await supabase.from('themes').delete().eq('id', deleteTarget.id)
      if (error) throw error
      invalidate()
      setDeleteTarget(null)
      if (editingId === deleteTarget.id) resetForm()
      toast.success('Theme deleted')
    } catch (e) {
      toast.error(`Delete failed: ${(e as Error).message}`)
    } finally { setDeleting(false) }
  }

  async function handleLoadSamples() {
    if (themes.length > 0) return
    setLoadingSamples(true)
    try {
      const { error } = await supabase.from('themes').insert(SAMPLE_THEMES)
      if (error) throw error
      invalidate()
      toast.success('5 sample themes loaded')
    } catch (e) {
      toast.error(`Failed: ${(e as Error).message}`)
    } finally { setLoadingSamples(false) }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-[calc(100vh-7rem)] gap-5">

      {/* ── LEFT: Form panel ─────────────────────────────────────────────── */}
      <div className="flex w-[40%] min-h-0 flex-col overflow-y-auto rounded-xl border border-gray-200 bg-white p-5">

        {/* Heading */}
        <div className="mb-5 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold text-gray-900">
              {isEditing ? `Editing: ${editingTheme?.title ?? '…'}` : 'New Theme'}
            </h2>
            {isEditing && (
              <button
                onClick={resetForm}
                className="mt-0.5 text-xs text-muted-foreground underline-offset-2 hover:underline"
              >
                ← Cancel editing
              </button>
            )}
          </div>
          {!isEditing && themes.length === 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleLoadSamples}
              disabled={loadingSamples}
              className="gap-1.5 text-xs"
            >
              <Zap className="h-3.5 w-3.5" />
              {loadingSamples ? 'Loading…' : 'Load Sample Themes'}
            </Button>
          )}
        </div>

        <form onSubmit={handleSave} className="flex flex-col gap-5">

          {/* Title */}
          <div className="space-y-1.5">
            <Label className="text-xs">Title <span className="text-red-500">*</span></Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Premium Dry Food Recommendation"
              required
            />
          </div>

          {/* Date fields row */}
          <div className="grid grid-cols-2 gap-3">
            {/* Launch Date */}
            <div className="space-y-1.5">
              <Label className="text-xs">Launch Date</Label>
              <Input
                type="date"
                value={launchDate}
                onChange={(e) => setLaunchDate(e.target.value)}
                className="text-xs"
              />
            </div>

            {/* Expiry Date */}
            <div className="space-y-1.5">
              <Label className="text-xs">Expiry Date <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Input
                type="date"
                value={expiryDate}
                onChange={(e) => setExpiryDate(e.target.value)}
                className="text-xs"
              />
            </div>
          </div>

          {/* Submission Deadline */}
          <div className="space-y-1.5">
            <Label className="text-xs">Submission deadline (days after launch)</Label>
            <Input
              type="number"
              min={1}
              max={30}
              value={submissionDeadlineDays}
              onChange={(e) => setSubmissionDeadlineDays(Number(e.target.value))}
              className="text-xs"
            />
            <p className="text-[11px] text-muted-foreground">
              Staff must submit within {submissionDeadlineDays} day{submissionDeadlineDays !== 1 ? 's' : ''} of launch
              {launchDate && (
                <> &mdash; Deadline: <strong>{fmtDate(addDays(launchDate, submissionDeadlineDays))}</strong></>
              )}
            </p>
          </div>

          {/* Brief text */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Brief Text</Label>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-muted-foreground">{briefText.length} chars</span>
                <button
                  type="button"
                  onClick={() => setShowPreview((v) => !v)}
                  className="flex items-center gap-1 text-[11px] font-medium text-orange-600 hover:text-orange-700"
                >
                  {showPreview
                    ? <><EyeOff className="h-3 w-3" /> Hide preview</>
                    : <><Eye className="h-3 w-3" /> Preview</>}
                </button>
              </div>
            </div>
            <textarea
              value={briefText}
              onChange={(e) => setBriefText(e.target.value)}
              rows={10}
              placeholder="Describe the scenario, key talking points, and any objections to handle…"
              className="w-full resize-none rounded-lg border border-input bg-transparent px-3 py-2 text-xs leading-relaxed outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
            />
            <p className="text-[11px] text-muted-foreground">
              Use <code className="rounded bg-gray-100 px-1">**bold**</code> for key points. Each blank line starts a new paragraph.
            </p>

            {/* Markdown preview */}
            {showPreview && briefText.trim() && (
              <div
                className="rounded-lg border border-orange-100 bg-orange-50/40 px-4 py-3 text-xs text-gray-700 leading-relaxed"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(briefText) }}
              />
            )}
            {showPreview && !briefText.trim() && (
              <div className="rounded-lg border border-dashed border-gray-200 px-4 py-3 text-xs text-muted-foreground">
                Nothing to preview — type some text above.
              </div>
            )}
          </div>

          {/* is_active toggle */}
          <div className="flex items-center justify-between rounded-lg border border-gray-100 bg-gray-50 px-3 py-2.5">
            <div>
              <p className="text-xs font-medium text-gray-800">Live on Pawsuit app</p>
              <p className="text-[11px] text-muted-foreground">
                {isActive
                  ? 'Staff can see and submit this theme'
                  : 'Hidden from staff — saved as draft'}
              </p>
            </div>
            <Switch
              checked={isActive}
              onCheckedChange={setIsActive}
            />
          </div>

          {/* Theme Assignment */}
          <div className="space-y-2.5 rounded-lg border border-gray-100 bg-gray-50 px-3 py-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-gray-800">Assignment</p>
              {assignScope === 'all' && (
                <span className="text-[11px] text-blue-600 font-medium">All Stores</span>
              )}
              {assignScope === 'region' && assignRegions.length > 0 && (
                <span className="text-[11px] text-purple-600 font-medium">
                  {assignRegions.length === 1 ? assignRegions[0] : `${assignRegions.length} regions`}
                </span>
              )}
              {assignScope === 'store' && assignStoreId && (
                <span className="text-[11px] text-orange-600 font-medium truncate max-w-[120px]">
                  {storesList.find((s) => s.id === assignStoreId)?.name ?? ''}
                </span>
              )}
            </div>

            {/* Scope selector */}
            <div className="flex gap-1 rounded-md bg-gray-200/60 p-0.5">
              {([
                { key: 'all',    label: 'All Stores'    },
                { key: 'region', label: 'By Region'     },
                { key: 'store',  label: 'Single Store'  },
              ] as { key: AssignmentScope; label: string }[]).map(({ key, label }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setAssignScope(key)}
                  className={cn(
                    'flex-1 rounded py-1 text-[11px] font-medium transition-all',
                    assignScope === key
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-500 hover:text-gray-700',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Region multi-select */}
            {assignScope === 'region' && (
              <div className="flex flex-wrap gap-1.5 pt-0.5">
                {REGIONS.map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => toggleRegion(r)}
                    className={cn(
                      'rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors',
                      assignRegions.includes(r)
                        ? 'border-purple-300 bg-purple-100 text-purple-700'
                        : 'border-gray-200 bg-white text-gray-500 hover:border-gray-300',
                    )}
                  >
                    {r}
                  </button>
                ))}
              </div>
            )}

            {/* Store single-select */}
            {assignScope === 'store' && (
              <Select value={assignStoreId} onValueChange={setAssignStoreId}>
                <SelectTrigger className="h-8 text-xs bg-white">
                  <SelectValue placeholder="Select store" />
                </SelectTrigger>
                <SelectContent>
                  {storesList.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* Submit */}
          <Button
            type="submit"
            disabled={saving || !title.trim()}
            className="text-white hover:opacity-90"
            style={{ backgroundColor: '#E8642C' }}
          >
            {saving
              ? 'Saving…'
              : isEditing ? 'Save Changes' : 'Publish Theme'}
          </Button>

          {isEditing && (
            <button type="button" onClick={resetForm}
              className="text-center text-xs text-muted-foreground underline-offset-2 hover:underline">
              Cancel
            </button>
          )}

        </form>

      </div>

      {/* ── RIGHT: Table panel ───────────────────────────────────────────── */}
      <div className="flex min-h-0 w-[60%] flex-col gap-3">

        {/* Stats row */}
        <div className="flex gap-3">
          {[
            { label: 'Active',      value: activeCount },
            { label: 'Total',       value: themes.length },
            { label: 'Submissions', value: totalSubs },
          ].map(({ label, value }) => (
            <div key={label}
              className="flex flex-1 items-center justify-between rounded-xl border border-gray-100 bg-white px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">{label}</p>
              <p className="text-xl font-bold text-gray-900">{value}</p>
            </div>
          ))}
        </div>

        {/* Search */}
        <div className="relative flex-shrink-0">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search themes…"
            className="pl-8 text-xs"
          />
        </div>

        {/* Table */}
        <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-gray-100 bg-white">
          {isLoading ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Loading…
            </div>
          ) : themes.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 py-16 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#E8642C]/10">
                <BookOpen className="h-5 w-5 text-[#E8642C]" />
              </div>
              <div>
                <p className="text-sm font-medium text-gray-700">
                  No themes yet. Create your first training theme.
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Or use the{' '}
                  <button
                    onClick={handleLoadSamples}
                    disabled={loadingSamples}
                    className="font-medium text-[#E8642C] underline-offset-2 hover:underline"
                  >
                    Load Sample Themes
                  </button>{' '}
                  button to get started.
                </p>
              </div>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-gray-500">
              No themes match your search.
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-gray-50 shadow-[0_1px_0_#f3f4f6]">
                <tr>
                  <th className="px-4 py-2.5 text-left font-medium text-gray-500">Title</th>
                  <th className="px-3 py-2.5 text-left font-medium text-gray-500">Status</th>
                  <th className="px-3 py-2.5 text-left font-medium text-gray-500">Assignment</th>
                  <th className="px-3 py-2.5 text-left font-medium text-gray-500">Launch Date</th>
                  <th className="px-3 py-2.5 text-left font-medium text-gray-500">Expiry</th>
                  <th className="px-3 py-2.5 text-left font-medium text-gray-500">Deadline</th>
                  <th className="px-3 py-2.5 text-left font-medium text-gray-500">Submissions</th>
                  <th className="px-4 py-2.5 text-right font-medium text-gray-500">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map((theme) => {
                  const subs     = subCounts.get(theme.id) ?? 0
                  const isBeingEdited = editingId === theme.id
                  return (
                    <tr
                      key={theme.id}
                      className={cn(
                        'transition-colors',
                        isBeingEdited && 'bg-orange-50/50 border-l-2 border-l-[#E8642C]',
                      )}
                    >
                      <td className="px-4 py-2.5">
                        <p className="max-w-[200px] truncate font-medium text-gray-900" title={theme.title}>
                          {theme.title}
                        </p>
                        {theme.brief_text && (
                          <p className="mt-0.5 max-w-[200px] truncate text-muted-foreground">
                            {theme.brief_text.slice(0, 60)}{theme.brief_text.length > 60 ? '…' : ''}
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        {theme.is_active
                          ? <Badge variant="outline" className="text-[10px] bg-emerald-50 text-emerald-700 border-emerald-200">Live</Badge>
                          : <Badge variant="outline" className="text-[10px] bg-gray-50 text-gray-500 border-gray-200">Draft</Badge>}
                      </td>
                      <td className="px-3 py-2.5">
                        <AssignmentBadge
                          assignment={assignments.get(theme.id)}
                          storeName={storesList.find((s) => s.id === assignments.get(theme.id)?.store_id)?.name}
                        />
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap">
                        {fmtDateOpt(theme.launch_date)}
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap">
                        {fmtDateOpt(theme.expiry_date)}
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap">
                        {theme.launch_date
                          ? fmtDate(addDays(theme.launch_date, theme.submission_deadline_days ?? 4))
                          : `${theme.submission_deadline_days ?? 4} days`}
                      </td>
                      <td className="px-3 py-2.5">
                        {subs > 0 ? (
                          <button
                            onClick={() => navigate('/roleplay/review')}
                            className="flex items-center gap-1 font-semibold text-[#E8642C] hover:underline underline-offset-2"
                          >
                            {subs}
                            <ExternalLink className="h-3 w-3" />
                          </button>
                        ) : (
                          <span className="text-muted-foreground">0</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right" style={{minWidth: '7rem'}}>
                        <div className="flex items-center justify-end gap-0.5">
                          {/* Edit */}
                          <button
                            onClick={() => startEdit(theme)}
                            title="Edit theme"
                            className="rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          {/* Toggle active */}
                          <button
                            onClick={() => handleToggleActive(theme)}
                            title={theme.is_active ? 'Set to Draft' : 'Set to Live'}
                            className={cn(
                              'rounded p-1.5 hover:bg-gray-100',
                              theme.is_active
                                ? 'text-emerald-500 hover:text-emerald-700'
                                : 'text-gray-300 hover:text-gray-500',
                            )}
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" />
                          </button>
                          {/* Delete */}
                          <button
                            onClick={() => setDeleteTarget(theme)}
                            title="Delete theme"
                            className="rounded p-1.5 text-red-300 hover:bg-red-50 hover:text-red-500"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* ── Delete dialog ────────────────────────────────────────────────── */}
      <Dialog open={deleteTarget !== null} onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm">Delete &ldquo;{deleteTarget?.title}&rdquo;?</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1">
            {(subCounts.get(deleteTarget?.id ?? '') ?? 0) > 0 && (
              <div className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2.5 text-xs text-amber-800">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                This theme has{' '}
                <strong>{subCounts.get(deleteTarget?.id ?? '')} submission{(subCounts.get(deleteTarget?.id ?? '') ?? 0) !== 1 ? 's' : ''}</strong>{' '}
                associated with it.
              </div>
            )}
            <p className="text-xs text-muted-foreground">This action cannot be undone.</p>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" size="sm">Cancel</Button>
            </DialogClose>
            <Button size="sm" disabled={deleting} onClick={handleDelete}
              className="bg-red-600 hover:bg-red-700 text-white">
              {deleting ? 'Deleting…' : 'Delete Theme'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  )
}
