import { useState, useEffect, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, RotateCcw, Check, X, AlertTriangle } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel,
  SelectSeparator, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose,
} from '@/components/ui/dialog'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

// ─── Types ────────────────────────────────────────────────────────────────────

type ProductType = 'dry_food' | 'wet_food' | 'spa_grooming'

type Rule = {
  id: string
  product_type: ProductType
  brand: string | null
  weight_min_kg: number
  weight_max_kg: number
  replenishment_days: number
  is_global: boolean
  store_id: string | null
  region: string | null
  updated_at: string | null
  created_by: string | null
}

type StoreMin = { id: string; name: string }

type RuleFormData = {
  product_type: ProductType
  brand: string       // '' | known brand name | '__other__'
  customBrand: string // only used when brand === '__other__'
  weight_min: string
  weight_max: string
  replenishment_days: string
}

// ─── Constants & helpers ──────────────────────────────────────────────────────

const PRODUCT_LABELS: Record<ProductType, string> = {
  dry_food: 'Dry Food',
  wet_food: 'Wet Food',
  spa_grooming: 'Spa Services',
}

const BRAND_OPTIONS = {
  house: [
    { value: 'saras_wholesome', label: "Sara's Wholesome" },
    { value: 'hearty',          label: 'Hearty'           },
    { value: 'meowsi',          label: 'Meowsi'           },
  ],
  premium: [
    { value: 'totw',        label: 'TOTW'            },
    { value: 'royal_canin', label: 'Royal Canin'     },
    { value: 'acana',       label: 'Acana'           },
    { value: 'orijen',      label: 'Orijen'          },
    { value: 'hills',       label: 'Hills'           },
    { value: 'purina',      label: 'Purina Pro Plan' },
    { value: 'drools',      label: 'Drools'          },
    { value: 'farmina',     label: 'Farmina'         },
  ],
} as const

const BRAND_VALUE_TO_LABEL: Record<string, string> = Object.fromEntries([
  ...BRAND_OPTIONS.house.map(({ value, label }) => [value, label]),
  ...BRAND_OPTIONS.premium.map(({ value, label }) => [value, label]),
])

const BRAND_LABEL_TO_VALUE: Record<string, string> = Object.fromEntries([
  ...BRAND_OPTIONS.house.map(({ value, label }) => [label, value]),
  ...BRAND_OPTIONS.premium.map(({ value, label }) => [label, value]),
])

function dbBrandToFormValue(rawBrand: string | null | undefined): { brand: string; customBrand: string } {
  if (!rawBrand) return { brand: 'all', customBrand: '' }
  if (rawBrand === 'all_house' || rawBrand === 'all_premium') return { brand: rawBrand, customBrand: '' }
  const slug = BRAND_LABEL_TO_VALUE[rawBrand]
  if (slug) return { brand: slug, customBrand: '' }
  return { brand: 'other', customBrand: rawBrand }
}

const EMPTY_FORM: RuleFormData = {
  product_type: 'dry_food',
  brand: 'all',
  customBrand: '',
  weight_min: '',
  weight_max: '',
  replenishment_days: '',
}

function resolveBrand(f: RuleFormData): string | null {
  if (f.brand === 'all')   return null
  if (f.brand === 'other') return f.customBrand.trim() || null
  // 'all_house' / 'all_premium' stored as-is; known slugs converted to display labels
  return (BRAND_VALUE_TO_LABEL[f.brand] ?? f.brand) || null
}

function fmtWeight(min: number, max: number) {
  if (max < 1) {
    return `${Math.round(min * 1000)} - ${Math.round(max * 1000)} gm`
  }
  return `${min} - ${max} kg`
}

function validateForm(f: RuleFormData): string | null {
  if (!f.weight_min || isNaN(+f.weight_min))    return 'Weight min is required'
  if (!f.weight_max || isNaN(+f.weight_max))    return 'Weight max is required'
  if (+f.weight_min >= +f.weight_max)            return 'Weight min must be less than max'
  if (!f.replenishment_days || isNaN(+f.replenishment_days)) return 'Replenishment days is required'
  if (+f.replenishment_days < 1)                 return 'Replenishment days must be at least 1'
  return null
}

// ─── Queries ──────────────────────────────────────────────────────────────────

function useGlobalRules() {
  return useQuery<Rule[]>({
    queryKey: ['replenishment_rules', 'global'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('replenishment_rules')
        .select('*')
        .eq('is_global', true)
        .order('product_type')
        .order('weight_min_kg')
      if (error) throw error
      return (data ?? []) as Rule[]
    },
    staleTime: 30_000,
  })
}

function useStoreRules(storeId: string | null) {
  return useQuery<Rule[]>({
    queryKey: ['replenishment_rules', 'store', storeId],
    queryFn: async () => {
      if (!storeId) return []
      const { data, error } = await supabase
        .from('replenishment_rules')
        .select('*')
        .eq('store_id', storeId)
        .eq('is_global', false)
        .order('product_type')
        .order('weight_min_kg')
      if (error) throw error
      return (data ?? []) as Rule[]
    },
    enabled: !!storeId,
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

function useRegions() {
  return useQuery<string[]>({
    queryKey: ['regions'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('stores')
        .select('region')
        .not('region', 'is', null)
        .order('region')
      if (error) throw error
      return [...new Set((data ?? []).map((r: { region: string }) => r.region))]
    },
    staleTime: 5 * 60_000,
  })
}

function useRegionalRules(region: string | null) {
  return useQuery<Rule[]>({
    queryKey: ['replenishment_rules', 'regional', region],
    queryFn: async () => {
      if (!region) return []
      const { data, error } = await supabase
        .from('replenishment_rules')
        .select('*')
        .eq('region', region)
        .eq('is_global', false)
        .is('store_id', null)
        .order('product_type')
        .order('weight_min_kg')
      if (error) throw error
      return (data ?? []) as Rule[]
    },
    enabled: !!region,
    staleTime: 30_000,
  })
}

// ─── BrandPicker ─────────────────────────────────────────────────────────────

function BrandPicker({
  brand,
  customBrand,
  onBrandChange,
  onCustomBrandChange,
  compact = false,
}: {
  brand: string
  customBrand: string
  onBrandChange: (v: string) => void
  onCustomBrandChange: (v: string) => void
  compact?: boolean
}) {
  const showCustom = brand === 'other'

  function handleSelectChange(v: string) {
    if (v !== 'other') onCustomBrandChange('')
    onBrandChange(v)
  }

  const labelCls = 'text-[10px] font-semibold uppercase tracking-wide text-muted-foreground px-2 py-1'

  return (
    <div className={showCustom ? 'space-y-1' : undefined}>
      <Select value={brand} onValueChange={handleSelectChange}>
        <SelectTrigger className={cn('w-full', compact ? 'h-7 text-xs' : 'h-9')}>
          {showCustom && customBrand
            ? <span className={compact ? 'text-xs truncate' : 'text-sm truncate'}>{customBrand}</span>
            : <SelectValue placeholder="All Brands" />
          }
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Brands</SelectItem>
          <SelectSeparator />
          <SelectGroup>
            <SelectLabel className={labelCls}>HUFT House Brands</SelectLabel>
            <SelectItem value="all_house">All House Brands</SelectItem>
            {BRAND_OPTIONS.house.map(({ value, label }) => (
              <SelectItem key={value} value={value}>{label}</SelectItem>
            ))}
          </SelectGroup>
          <SelectSeparator />
          <SelectGroup>
            <SelectLabel className={labelCls}>Premium Brands</SelectLabel>
            <SelectItem value="all_premium">All Premium Brands</SelectItem>
            {BRAND_OPTIONS.premium.map(({ value, label }) => (
              <SelectItem key={value} value={value}>{label}</SelectItem>
            ))}
          </SelectGroup>
          <SelectSeparator />
          <SelectItem value="other">Other / Custom</SelectItem>
        </SelectContent>
      </Select>
      {showCustom && (
        <Input
          value={customBrand}
          onChange={(e) => onCustomBrandChange(e.target.value)}
          placeholder="Enter brand name"
          className={compact ? 'h-7 text-xs' : 'h-8 text-sm'}
          autoFocus
        />
      )}
    </div>
  )
}

// ─── RuleDialog ───────────────────────────────────────────────────────────────

function RuleDialog({
  open,
  title,
  initialForm,
  onOpenChange,
  onSave,
  isSaving,
}: {
  open: boolean
  title: string
  initialForm?: Partial<RuleFormData>
  onOpenChange: (v: boolean) => void
  onSave: (form: RuleFormData) => void
  isSaving: boolean
}) {
  const [form, setForm] = useState<RuleFormData>(EMPTY_FORM)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      const { brand, customBrand } = dbBrandToFormValue(initialForm?.brand)
      setForm({ ...EMPTY_FORM, ...initialForm, brand, customBrand })
      setErr(null)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const set = (k: keyof RuleFormData, v: string) => setForm((p) => ({ ...p, [k]: v }))

  function handleSave() {
    const e = validateForm(form)
    if (e) { setErr(e); return }
    onSave(form)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm">{title}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 py-1">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Product Type</Label>
              <Select value={form.product_type} onValueChange={(v) => set('product_type', v as ProductType)}>
                <SelectTrigger className="h-9 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="dry_food">Dry Food</SelectItem>
                  <SelectItem value="wet_food">Wet Food</SelectItem>
                  <SelectItem value="spa_grooming">Spa Services</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">
                Brand <span className="font-normal text-muted-foreground">(optional)</span>
              </Label>
              <BrandPicker
                brand={form.brand}
                customBrand={form.customBrand}
                onBrandChange={(v) => set('brand', v)}
                onCustomBrandChange={(v) => set('customBrand', v)}
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Weight Min (kg)</Label>
              <Input
                type="number" min={0} step={0.1}
                value={form.weight_min}
                onChange={(e) => set('weight_min', e.target.value)}
                placeholder="e.g. 1"
                className="h-9"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Weight Max (kg)</Label>
              <Input
                type="number" min={0} step={0.1}
                value={form.weight_max}
                onChange={(e) => set('weight_max', e.target.value)}
                placeholder="e.g. 5"
                className="h-9"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Repl. Days</Label>
              <Input
                type="number" min={1}
                value={form.replenishment_days}
                onChange={(e) => set('replenishment_days', e.target.value)}
                placeholder="e.g. 30"
                className="h-9"
              />
            </div>
          </div>

          {err && (
            <p className="flex items-center gap-1.5 text-xs text-red-600">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              {err}
            </p>
          )}
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" size="sm">Cancel</Button>
          </DialogClose>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={isSaving}
            className="bg-[#E8642C] hover:bg-[#CF5826] text-white"
          >
            {isSaving ? 'Saving…' : 'Save Rule'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function TableSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-2.5 p-5">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-3.5 animate-pulse rounded bg-gray-100" style={{ width: `${[75, 55, 85, 65, 70][i % 5]}%` }} />
      ))}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function ReorderSettingsPage() {
  const queryClient = useQueryClient()
  const [adminName, setAdminName] = useState<string | null>(null)

  // Inline edit state
  const [editingId, setEditingId]   = useState<string | null>(null)
  const [editForm, setEditForm]     = useState<RuleFormData>(EMPTY_FORM)
  const [editSaving, setEditSaving] = useState(false)

  // Delete / reset confirm
  const [confirmId, setConfirmId]   = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)

  // Add-rule dialog
  const [dialogMode, setDialogMode]       = useState<'global' | 'store' | 'regional' | null>(null)
  const [dialogPrefill, setDialogPrefill] = useState<Partial<RuleFormData> | undefined>()
  const [dialogSaving, setDialogSaving]   = useState(false)

  // Store overrides tab
  const [selectedStoreId, setSelectedStoreId] = useState<string | null>(null)

  // Regional rules tab
  const [selectedRegion, setSelectedRegion]   = useState<string | null>(null)
  const [confirmMode, setConfirmMode]         = useState<'delete' | 'reset'>('delete')

  // Queries
  const { data: globalRules   = [], isLoading: gL  } = useGlobalRules()
  const { data: storeRules    = [], isLoading: sRL } = useStoreRules(selectedStoreId)
  const { data: regionalRules = [], isLoading: rRL } = useRegionalRules(selectedRegion)
  const { data: stores        = [] }                  = useStores()
  const { data: regions       = [] }                  = useRegions()

  // Fetch admin name once
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return
      supabase.from('staff').select('name').eq('id', user.id).single()
        .then(({ data }) => setAdminName(data?.name ?? null))
    })
  }, [])

  // Auto-select first store
  useEffect(() => {
    if (stores.length > 0 && !selectedStoreId) setSelectedStoreId(stores[0].id)
  }, [stores, selectedStoreId])

  // ── Inline edit helpers ───────────────────────────────────────────────────

  function startEdit(rule: Rule) {
    setEditingId(rule.id)
    const { brand, customBrand } = dbBrandToFormValue(rule.brand)
    setEditForm({
      product_type: rule.product_type,
      brand,
      customBrand,
      weight_min:   String(rule.weight_min_kg),
      weight_max:   String(rule.weight_max_kg),
      replenishment_days: String(rule.replenishment_days),
    })
    setConfirmId(null)
  }

  function cancelEdit() {
    setEditingId(null)
    setEditForm(EMPTY_FORM)
  }

  const setEF = (k: keyof RuleFormData, v: string) => setEditForm((p) => ({ ...p, [k]: v }))

  // ── Mutations ─────────────────────────────────────────────────────────────

  async function saveEdit() {
    if (!editingId) return
    const e = validateForm(editForm)
    if (e) { toast.error(e); return }

    setEditSaving(true)
    const { error } = await supabase
      .from('replenishment_rules')
      .update({
        product_type: editForm.product_type,
        brand: resolveBrand(editForm),
        weight_min_kg: +editForm.weight_min,
        weight_max_kg: +editForm.weight_max,
        replenishment_days: +editForm.replenishment_days,
        updated_at: new Date().toISOString(),
        created_by: adminName,
      })
      .eq('id', editingId)
    setEditSaving(false)

    if (error) { toast.error(`Save failed: ${error.message}`); return }
    toast.success('Rule updated')
    cancelEdit()
    queryClient.invalidateQueries({ queryKey: ['replenishment_rules'] })
  }

  async function confirmAction(id: string) {
    setConfirming(true)
    const { error } = await supabase.from('replenishment_rules').delete().eq('id', id)
    setConfirming(false)
    setConfirmId(null)
    if (error) { toast.error(`Failed: ${error.message}`); return }
    toast.success('Rule deleted')
    queryClient.invalidateQueries({ queryKey: ['replenishment_rules'] })
  }

  async function addRule(
    form: RuleFormData,
    isGlobal: boolean,
    storeId: string | null,
    region: string | null = null,
  ) {
    setDialogSaving(true)
    const { error } = await supabase.from('replenishment_rules').insert({
      product_type: form.product_type,
      brand: resolveBrand(form),
      weight_min_kg: +form.weight_min,
      weight_max_kg: +form.weight_max,
      replenishment_days: +form.replenishment_days,
      is_global: isGlobal,
      store_id: storeId,
      region,
      updated_at: new Date().toISOString(),
      created_by: adminName,
    })
    setDialogSaving(false)

    if (error) { toast.error(`Add failed: ${error.message}`); return }
    toast.success('Rule added')
    setDialogMode(null)
    queryClient.invalidateQueries({ queryKey: ['replenishment_rules'] })
  }

  // ── Merged store display rows ──────────────────────────────────────────────

  const storeDisplayRows = useMemo(() => {
    const overrideMap = new Map(
      storeRules.map((r) => [`${r.product_type}::${r.weight_min_kg}::${r.weight_max_kg}`, r]),
    )
    return globalRules.map((gr) => {
      const key = `${gr.product_type}::${gr.weight_min_kg}::${gr.weight_max_kg}`
      const storeRule = overrideMap.get(key) ?? null
      return {
        globalRule: gr,
        storeRule,
        differsFromGlobal: !!storeRule && storeRule.replenishment_days !== gr.replenishment_days,
      }
    })
  }, [globalRules, storeRules])

  // ── Global tab row renderer ────────────────────────────────────────────────

  function GlobalRow({ rule }: { rule: Rule }) {
    const isEditing    = editingId === rule.id
    const isConfirming = confirmId === rule.id

    if (isConfirming) {
      return (
        <TableRow className="bg-red-50/60">
          <TableCell className="pl-5" colSpan={4}>
            <p className="text-xs font-medium text-red-700">Delete this rule? This cannot be undone.</p>
          </TableCell>
          <TableCell className="pr-5">
            <div className="flex items-center gap-1.5">
              <Button size="sm" onClick={() => confirmAction(rule.id)} disabled={confirming}
                className="h-7 bg-red-600 hover:bg-red-700 text-white text-xs px-2.5">
                {confirming ? '…' : 'Delete'}
              </Button>
              <Button variant="outline" size="sm" onClick={() => setConfirmId(null)} className="h-7 text-xs px-2.5">
                Cancel
              </Button>
            </div>
          </TableCell>
        </TableRow>
      )
    }

    if (isEditing) {
      return (
        <TableRow className="bg-orange-50/40">
          <TableCell className="pl-5">
            <Select value={editForm.product_type} onValueChange={(v) => setEF('product_type', v)}>
              <SelectTrigger className="h-7 w-28 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="dry_food">Dry Food</SelectItem>
                <SelectItem value="wet_food">Wet Food</SelectItem>
              </SelectContent>
            </Select>
          </TableCell>
          <TableCell>
            <BrandPicker
              brand={editForm.brand}
              customBrand={editForm.customBrand}
              onBrandChange={(v) => setEF('brand', v)}
              onCustomBrandChange={(v) => setEF('customBrand', v)}
              compact
            />
          </TableCell>
          <TableCell>
            <div className="flex items-center gap-1">
              <Input type="number" value={editForm.weight_min} onChange={(e) => setEF('weight_min', e.target.value)}
                className="h-7 w-14 text-xs" />
              <span className="text-xs text-muted-foreground">–</span>
              <Input type="number" value={editForm.weight_max} onChange={(e) => setEF('weight_max', e.target.value)}
                className="h-7 w-14 text-xs" />
              <span className="text-xs text-muted-foreground">kg</span>
            </div>
          </TableCell>
          <TableCell>
            <Input type="number" min={1} value={editForm.replenishment_days}
              onChange={(e) => setEF('replenishment_days', e.target.value)} className="h-7 w-20 text-xs" />
          </TableCell>
          <TableCell className="pr-5">
            <div className="flex items-center gap-1.5">
              <Button size="sm" onClick={saveEdit} disabled={editSaving}
                className="h-7 bg-[#E8642C] hover:bg-[#CF5826] text-white text-xs px-2.5">
                <Check className="mr-1 h-3 w-3" />{editSaving ? '…' : 'Save'}
              </Button>
              <Button variant="outline" size="sm" onClick={cancelEdit} className="h-7 text-xs px-2.5">
                <X className="mr-1 h-3 w-3" />Cancel
              </Button>
            </div>
          </TableCell>
        </TableRow>
      )
    }

    return (
      <TableRow className="group">
        <TableCell className="pl-5 font-medium">{PRODUCT_LABELS[rule.product_type]}</TableCell>
        <TableCell className="text-muted-foreground">
          {rule.brand ?? <span className="italic text-muted-foreground/60">All brands</span>}
        </TableCell>
        <TableCell className="text-muted-foreground">{fmtWeight(rule.weight_min_kg, rule.weight_max_kg)}</TableCell>
        <TableCell>
          <span className="font-semibold text-gray-900">{rule.replenishment_days}</span>
          <span className="ml-1 text-xs text-muted-foreground">days</span>
        </TableCell>
        <TableCell className="pr-5">
          <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
            <Button variant="ghost" size="sm"
              onClick={() => { cancelEdit(); setConfirmId(null); startEdit(rule) }}
              className="h-7 w-7 p-0 text-gray-400 hover:text-gray-800">
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="sm"
              onClick={() => { cancelEdit(); setConfirmId(rule.id) }}
              className="h-7 w-7 p-0 text-gray-400 hover:text-red-600">
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </TableCell>
      </TableRow>
    )
  }

  // ── Store override row renderer ────────────────────────────────────────────

  function StoreRow({
    globalRule: gr, storeRule, differsFromGlobal,
  }: {
    globalRule: Rule; storeRule: Rule | null; differsFromGlobal: boolean
  }) {
    const isEditing    = !!storeRule && editingId === storeRule.id
    const isConfirming = !!storeRule && confirmId === storeRule.id
    const displayRule  = storeRule ?? gr

    if (isConfirming) {
      return (
        <TableRow className="bg-amber-50/60">
          <TableCell className="pl-5" colSpan={5}>
            <p className="text-xs font-medium text-amber-800">
              Reset to global default ({gr.replenishment_days} days)? Store override will be removed.
            </p>
          </TableCell>
          <TableCell className="pr-5">
            <div className="flex items-center gap-1.5">
              <Button size="sm" onClick={() => confirmAction(storeRule!.id)} disabled={confirming}
                className="h-7 bg-amber-600 hover:bg-amber-700 text-white text-xs px-2.5">
                {confirming ? '…' : 'Reset'}
              </Button>
              <Button variant="outline" size="sm" onClick={() => setConfirmId(null)} className="h-7 text-xs px-2.5">
                Cancel
              </Button>
            </div>
          </TableCell>
        </TableRow>
      )
    }

    if (isEditing) {
      return (
        <TableRow className="bg-orange-50/40">
          <TableCell className="pl-5 text-muted-foreground">{PRODUCT_LABELS[gr.product_type]}</TableCell>
          <TableCell>
            <BrandPicker
              brand={editForm.brand}
              customBrand={editForm.customBrand}
              onBrandChange={(v) => setEF('brand', v)}
              onCustomBrandChange={(v) => setEF('customBrand', v)}
              compact
            />
          </TableCell>
          <TableCell className="text-muted-foreground">{fmtWeight(gr.weight_min_kg, gr.weight_max_kg)}</TableCell>
          <TableCell>
            <div className="flex items-center gap-2">
              <Input type="number" min={1} value={editForm.replenishment_days}
                onChange={(e) => setEF('replenishment_days', e.target.value)} className="h-7 w-20 text-xs" />
              <span className="text-xs text-muted-foreground">global: {gr.replenishment_days}</span>
            </div>
          </TableCell>
          <TableCell />
          <TableCell className="pr-5">
            <div className="flex items-center gap-1.5">
              <Button size="sm" onClick={saveEdit} disabled={editSaving}
                className="h-7 bg-[#E8642C] hover:bg-[#CF5826] text-white text-xs px-2.5">
                <Check className="mr-1 h-3 w-3" />{editSaving ? '…' : 'Save'}
              </Button>
              <Button variant="outline" size="sm" onClick={cancelEdit} className="h-7 text-xs px-2.5">
                <X className="mr-1 h-3 w-3" />Cancel
              </Button>
            </div>
          </TableCell>
        </TableRow>
      )
    }

    return (
      <TableRow className="group">
        <TableCell className="pl-5 font-medium">{PRODUCT_LABELS[gr.product_type]}</TableCell>
        <TableCell className="text-muted-foreground">
          {displayRule.brand ?? <span className="italic text-muted-foreground/60">All brands</span>}
        </TableCell>
        <TableCell className="text-muted-foreground">{fmtWeight(gr.weight_min_kg, gr.weight_max_kg)}</TableCell>
        <TableCell>
          <div className="flex items-center gap-2">
            <span className={cn('font-semibold', storeRule ? 'text-gray-900' : 'text-muted-foreground')}>
              {displayRule.replenishment_days}
            </span>
            <span className="text-xs text-muted-foreground">days</span>
            {storeRule && (
              <span className="text-[10px] text-muted-foreground">(global: {gr.replenishment_days})</span>
            )}
          </div>
        </TableCell>
        <TableCell>
          {storeRule ? (
            differsFromGlobal ? (
              <Badge variant="outline" className="border-orange-200 bg-orange-50 text-orange-700 text-[10px]">
                Override
              </Badge>
            ) : (
              <Badge variant="outline" className="border-gray-200 bg-gray-50 text-gray-500 text-[10px]">
                Same as global
              </Badge>
            )
          ) : (
            <Badge variant="outline" className="border-blue-200 bg-blue-50 text-blue-600 text-[10px]">
              Using global
            </Badge>
          )}
        </TableCell>
        <TableCell className="pr-5">
          {storeRule ? (
            <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
              <Button variant="ghost" size="sm"
                onClick={() => { cancelEdit(); setConfirmId(null); startEdit(storeRule) }}
                className="h-7 w-7 p-0 text-gray-400 hover:text-gray-800">
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              <Button variant="ghost" size="sm" title="Reset to global default"
                onClick={() => { cancelEdit(); setConfirmId(storeRule.id) }}
                className="h-7 w-7 p-0 text-gray-400 hover:text-amber-600">
                <RotateCcw className="h-3.5 w-3.5" />
              </Button>
            </div>
          ) : (
            <Button variant="ghost" size="sm"
              onClick={() => {
                setDialogPrefill({
                  product_type: gr.product_type,
                  brand: gr.brand ?? '',
                  weight_min: String(gr.weight_min_kg),
                  weight_max: String(gr.weight_max_kg),
                  replenishment_days: String(gr.replenishment_days),
                })
                setDialogMode('store')
              }}
              className="h-7 px-2 text-xs text-muted-foreground hover:text-gray-900 opacity-0 transition-opacity group-hover:opacity-100">
              Add override
            </Button>
          )}
        </TableCell>
      </TableRow>
    )
  }

  // ── Regional rule row renderer ────────────────────────────────────────────

  function RegionalRow({ rule }: { rule: Rule }) {
    const isEditing    = editingId === rule.id
    const isConfirming = confirmId === rule.id

    if (isConfirming) {
      const isReset = confirmMode === 'reset'
      return (
        <TableRow className={isReset ? 'bg-amber-50/60' : 'bg-red-50/60'}>
          <TableCell className="pl-5" colSpan={4}>
            <p className={`text-xs font-medium ${isReset ? 'text-amber-800' : 'text-red-700'}`}>
              {isReset
                ? 'Reset to global default? This regional rule will be removed.'
                : 'Delete this rule? This cannot be undone.'}
            </p>
          </TableCell>
          <TableCell className="pr-5">
            <div className="flex items-center gap-1.5">
              <Button size="sm" onClick={() => confirmAction(rule.id)} disabled={confirming}
                className={`h-7 text-white text-xs px-2.5 ${isReset ? 'bg-amber-600 hover:bg-amber-700' : 'bg-red-600 hover:bg-red-700'}`}>
                {confirming ? '…' : isReset ? 'Reset' : 'Delete'}
              </Button>
              <Button variant="outline" size="sm" onClick={() => setConfirmId(null)} className="h-7 text-xs px-2.5">
                Cancel
              </Button>
            </div>
          </TableCell>
        </TableRow>
      )
    }

    if (isEditing) {
      return (
        <TableRow className="bg-orange-50/40">
          <TableCell className="pl-5">
            <Select value={editForm.product_type} onValueChange={(v) => setEF('product_type', v)}>
              <SelectTrigger className="h-7 w-28 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="dry_food">Dry Food</SelectItem>
                <SelectItem value="wet_food">Wet Food</SelectItem>
              </SelectContent>
            </Select>
          </TableCell>
          <TableCell>
            <BrandPicker
              brand={editForm.brand}
              customBrand={editForm.customBrand}
              onBrandChange={(v) => setEF('brand', v)}
              onCustomBrandChange={(v) => setEF('customBrand', v)}
              compact
            />
          </TableCell>
          <TableCell>
            <div className="flex items-center gap-1">
              <Input type="number" value={editForm.weight_min} onChange={(e) => setEF('weight_min', e.target.value)}
                className="h-7 w-14 text-xs" />
              <span className="text-xs text-muted-foreground">–</span>
              <Input type="number" value={editForm.weight_max} onChange={(e) => setEF('weight_max', e.target.value)}
                className="h-7 w-14 text-xs" />
              <span className="text-xs text-muted-foreground">kg</span>
            </div>
          </TableCell>
          <TableCell>
            <Input type="number" min={1} value={editForm.replenishment_days}
              onChange={(e) => setEF('replenishment_days', e.target.value)} className="h-7 w-20 text-xs" />
          </TableCell>
          <TableCell className="pr-5">
            <div className="flex items-center gap-1.5">
              <Button size="sm" onClick={saveEdit} disabled={editSaving}
                className="h-7 bg-[#E8642C] hover:bg-[#CF5826] text-white text-xs px-2.5">
                <Check className="mr-1 h-3 w-3" />{editSaving ? '…' : 'Save'}
              </Button>
              <Button variant="outline" size="sm" onClick={cancelEdit} className="h-7 text-xs px-2.5">
                <X className="mr-1 h-3 w-3" />Cancel
              </Button>
            </div>
          </TableCell>
        </TableRow>
      )
    }

    return (
      <TableRow className="group">
        <TableCell className="pl-5 font-medium">{PRODUCT_LABELS[rule.product_type]}</TableCell>
        <TableCell className="text-muted-foreground">
          {rule.brand ?? <span className="italic text-muted-foreground/60">All brands</span>}
        </TableCell>
        <TableCell className="text-muted-foreground">{fmtWeight(rule.weight_min_kg, rule.weight_max_kg)}</TableCell>
        <TableCell>
          <span className="font-semibold text-gray-900">{rule.replenishment_days}</span>
          <span className="ml-1 text-xs text-muted-foreground">days</span>
        </TableCell>
        <TableCell className="pr-5">
          <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
            <Button variant="ghost" size="sm"
              onClick={() => { cancelEdit(); setConfirmId(null); startEdit(rule) }}
              className="h-7 w-7 p-0 text-gray-400 hover:text-gray-800">
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="sm" title="Reset to global default"
              onClick={() => { cancelEdit(); setConfirmMode('reset'); setConfirmId(rule.id) }}
              className="h-7 w-7 p-0 text-gray-400 hover:text-amber-600">
              <RotateCcw className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="sm" title="Delete rule"
              onClick={() => { cancelEdit(); setConfirmMode('delete'); setConfirmId(rule.id) }}
              className="h-7 w-7 p-0 text-gray-400 hover:text-red-600">
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </TableCell>
      </TableRow>
    )
  }

  // ─────────────────────────────────────────────────────────────────────────────

  const selectedStoreName = stores.find((s) => s.id === selectedStoreId)?.name ?? ''

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-muted-foreground">
          Configure how many days each product type lasts before replenishment
        </p>
      </div>

      <Tabs defaultValue="global">
        <TabsList className="h-9">
          <TabsTrigger value="global"    className="text-xs">Global Defaults</TabsTrigger>
          <TabsTrigger value="store"     className="text-xs">Store Overrides</TabsTrigger>
          <TabsTrigger value="regional"  className="text-xs">Regional Rules</TabsTrigger>
        </TabsList>

        {/* ── Global Defaults ─────────────────────────────────────────────── */}
        <TabsContent value="global" className="mt-4">
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-sm font-semibold">Global Replenishment Rules</CardTitle>
                  <p className="mt-0.5 text-xs text-muted-foreground">Applied to all stores unless overridden</p>
                </div>
                <Button
                  size="sm"
                  onClick={() => { setDialogPrefill(undefined); setDialogMode('global') }}
                  className="gap-1.5 bg-[#E8642C] hover:bg-[#CF5826] text-white text-xs h-8"
                >
                  <Plus className="h-3.5 w-3.5" /> Add Rule
                </Button>
              </div>
            </CardHeader>
            <CardContent className="px-0 pb-1">
              {gL ? <TableSkeleton /> : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-5">Product Type</TableHead>
                      <TableHead>Brand</TableHead>
                      <TableHead>Weight Range</TableHead>
                      <TableHead>Replenishment Days</TableHead>
                      <TableHead className="pr-5 w-28">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {globalRules.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="py-12 text-center text-sm text-muted-foreground">
                          No global rules yet — click "Add Rule" to create one.
                        </TableCell>
                      </TableRow>
                    ) : (
                      globalRules.map((rule) => <GlobalRow key={rule.id} rule={rule} />)
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Store Overrides ─────────────────────────────────────────────── */}
        <TabsContent value="store" className="mt-4">
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <Select value={selectedStoreId ?? ''} onValueChange={setSelectedStoreId}>
                <SelectTrigger className="w-56">
                  <SelectValue placeholder="Select a store…" />
                </SelectTrigger>
                <SelectContent>
                  {stores.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {selectedStoreId && (
                <Button
                  size="sm"
                  onClick={() => { setDialogPrefill(undefined); setDialogMode('store') }}
                  className="gap-1.5 bg-[#E8642C] hover:bg-[#CF5826] text-white text-xs h-8"
                >
                  <Plus className="h-3.5 w-3.5" /> Add Override
                </Button>
              )}
            </div>

            {selectedStoreId && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold">
                    Overrides — {selectedStoreName}
                  </CardTitle>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Store-specific rules take priority over global defaults
                  </p>
                </CardHeader>
                <CardContent className="px-0 pb-1">
                  {(sRL || gL) ? <TableSkeleton /> : globalRules.length === 0 ? (
                    <p className="py-10 text-center text-sm text-muted-foreground">
                      No global rules defined. Add global defaults first.
                    </p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="pl-5">Product Type</TableHead>
                          <TableHead>Brand</TableHead>
                          <TableHead>Weight Range</TableHead>
                          <TableHead>Repl. Days</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className="pr-5 w-28">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {storeDisplayRows.map(({ globalRule, storeRule, differsFromGlobal }) => (
                          <StoreRow
                            key={globalRule.id}
                            globalRule={globalRule}
                            storeRule={storeRule}
                            differsFromGlobal={differsFromGlobal}
                          />
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>
        {/* ── Regional Rules ──────────────────────────────────────────────── */}
        <TabsContent value="regional" className="mt-4">
          <div className="space-y-4">

            {/* Priority legend */}
            <div className="flex items-center gap-2 rounded-md border border-gray-100 bg-gray-50 px-4 py-2.5 text-xs">
              <span className="font-medium text-gray-700">Priority:</span>
              <Badge variant="outline" className="border-orange-200 bg-orange-50 text-orange-700 text-[10px]">
                Store Override
              </Badge>
              <span className="text-muted-foreground">→</span>
              <Badge variant="outline" className="border-blue-200 bg-blue-50 text-blue-700 text-[10px]">
                Regional Rule
              </Badge>
              <span className="text-muted-foreground">→</span>
              <Badge variant="outline" className="border-gray-200 bg-gray-100 text-gray-500 text-[10px]">
                Global Default
              </Badge>
              <span className="ml-1 text-muted-foreground/60">Higher priority takes precedence</span>
            </div>

            {/* Region selector + add button */}
            <div className="flex items-center gap-3">
              <Select value={selectedRegion ?? ''} onValueChange={setSelectedRegion}>
                <SelectTrigger className="w-56">
                  <SelectValue placeholder="Select a region…" />
                </SelectTrigger>
                <SelectContent>
                  {regions.map((r) => (
                    <SelectItem key={r} value={r}>{r}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {selectedRegion && (
                <Button
                  size="sm"
                  onClick={() => { setDialogPrefill(undefined); setDialogMode('regional') }}
                  className="gap-1.5 bg-[#E8642C] hover:bg-[#CF5826] text-white text-xs h-8"
                >
                  <Plus className="h-3.5 w-3.5" /> Add Regional Rule
                </Button>
              )}
            </div>

            {/* Content area */}
            {!selectedRegion ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                Select a region to view or add rules
              </p>
            ) : (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold">
                    Regional Rules — {selectedRegion}
                  </CardTitle>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Applies to all stores in this region unless a store override exists
                  </p>
                </CardHeader>
                <CardContent className="px-0 pb-1">
                  {rRL ? <TableSkeleton /> : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="pl-5">Product Type</TableHead>
                          <TableHead>Brand</TableHead>
                          <TableHead>Weight Range</TableHead>
                          <TableHead>Replenishment Days</TableHead>
                          <TableHead className="pr-5 w-28">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {regionalRules.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={5} className="py-12 text-center text-sm text-muted-foreground">
                              No regional rules for {selectedRegion} — using global defaults
                            </TableCell>
                          </TableRow>
                        ) : (
                          regionalRules.map((rule) => <RegionalRow key={rule.id} rule={rule} />)
                        )}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>
      </Tabs>

      {/* ── Add Global Rule dialog ── */}
      <RuleDialog
        open={dialogMode === 'global'}
        title="Add Global Rule"
        initialForm={dialogPrefill}
        onOpenChange={(v) => { if (!v) setDialogMode(null) }}
        onSave={(form) => addRule(form, true, null)}
        isSaving={dialogSaving}
      />

      {/* ── Add Store Override dialog ── */}
      <RuleDialog
        open={dialogMode === 'store'}
        title={`Add Override — ${selectedStoreName}`}
        initialForm={dialogPrefill}
        onOpenChange={(v) => { if (!v) setDialogMode(null) }}
        onSave={(form) => addRule(form, false, selectedStoreId)}
        isSaving={dialogSaving}
      />

      {/* ── Add Regional Rule dialog ── */}
      <RuleDialog
        open={dialogMode === 'regional'}
        title={`Add Regional Rule — ${selectedRegion ?? ''}`}
        initialForm={dialogPrefill}
        onOpenChange={(v) => { if (!v) setDialogMode(null) }}
        onSave={(form) => addRule(form, false, null, selectedRegion)}
        isSaving={dialogSaving}
      />
    </div>
  )
}
