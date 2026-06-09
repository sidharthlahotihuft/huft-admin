/**
 * ERP CSV / Excel parser
 *
 * Supports two input formats:
 *
 * ── LEGACY FORMAT (wide / pivot) ─────────────────────────────────────────────
 *   Each row is a customer or product, with one column per month.
 *   Customer row : "[9871297107] Aamir- EPPL761"
 *   Product row  : "[RC-ADULT-2KG] Royal Canin Adult 2 kg  | qty1 | qty2 | …"
 *
 * ── FLAT FORMAT (new) ────────────────────────────────────────────────────────
 *   One row per (customer × product × date/month) transaction.
 *   Columns (order-independent, matched by header name):
 *     Customer Phone | Customer Name | Product Barcode | Product Name |
 *     Order Count    | Product Quantity | Total Price   |
 *     Month  ← monthly summary ("January 2026")
 *     Date   ← daily export ("09/06/2026" or "09-Jun-2026")
 *     Store Code  (optional; ignored in favour of the sheet→storeId map)
 *
 * Auto-detection: if the first non-empty data row has a "Month" or "Date"
 * column → flat format.  Otherwise falls back to legacy.
 */

import type { Task, ReplenishmentRule } from '@/types'

// ─── Internal types ───────────────────────────────────────────────────────────

type MonthCol     = { index: number; date: Date }
type CustomerInfo = { phone: string; name: string }
type ProductInfo  = { sku: string; rawName: string; weightKg: number | null; weightRaw: string | null }

// ─── Month name → 0-based index map ──────────────────────────────────────────

const MONTH_IDX: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
}

// ─── Hardcoded fallback replenishment rules ───────────────────────────────────

const WEIGHT_DEFAULTS: Record<'dry_food' | 'wet_food' | 'default', Array<{ maxKg: number; days: number }>> = {
  dry_food: [
    { maxKg: 0.5,      days: 15  },
    { maxKg: 2,        days: 45  },
    { maxKg: 5,        days: 75  },
    { maxKg: 15,       days: 120 },
    { maxKg: Infinity, days: 150 },
  ],
  wet_food: [
    { maxKg: 0.5,      days: 7  },
    { maxKg: 2,        days: 20 },
    { maxKg: 5,        days: 40 },
    { maxKg: 15,       days: 60 },
    { maxKg: Infinity, days: 75 },
  ],
  default: [
    { maxKg: 0.5,      days: 15  },
    { maxKg: 2,        days: 30  },
    { maxKg: 5,        days: 45  },
    { maxKg: 15,       days: 90  },
    { maxKg: Infinity, days: 120 },
  ],
}

// ─── Weight helpers ───────────────────────────────────────────────────────────

export function extractWeight(text: string): number | null {
  const m = text.match(/(\d+(?:\.\d+)?)\s*(kg|gm|g(?!\w)|grams?)/i)
  if (!m) return null
  const value = parseFloat(m[1])
  const unit  = m[2].toLowerCase()
  return unit === 'kg' ? value : value / 1000
}

function extractWeightFull(text: string): { kg: number; raw: string } | null {
  const m = text.match(/(\d+(?:\.\d+)?)\s*(kg|gm|g(?!\w)|grams?)/i)
  if (!m) return null
  const value = parseFloat(m[1])
  const unit  = m[2].toLowerCase()
  const kg    = unit === 'kg' ? value : value / 1000
  return { kg, raw: m[0].trim() }
}

// ─── Month header detection (legacy format) ───────────────────────────────────

function parseMonthCell(cell: unknown): Date | null {
  if (cell === null || cell === undefined || cell === '') return null

  if (typeof cell === 'number') {
    if (cell < 1000) return null
    const epoch = new Date(1899, 11, 30)
    const d = new Date(epoch.getTime() + cell * 86_400_000)
    if (d.getFullYear() < 2000 || d.getFullYear() > 2035) return null
    return new Date(d.getFullYear(), d.getMonth(), 1)
  }

  if (cell instanceof Date) {
    if (cell.getFullYear() < 2000 || cell.getFullYear() > 2035) return null
    return new Date(cell.getFullYear(), cell.getMonth(), 1)
  }

  const s = String(cell).trim()

  const m1 = s.match(/^([A-Za-z]{3})[-\s'](\d{2,4})$/)
  if (m1) {
    const mo = MONTH_IDX[m1[1].toLowerCase()]
    if (mo !== undefined) {
      const yr = m1[2].length === 2 ? 2000 + parseInt(m1[2]) : parseInt(m1[2])
      return new Date(yr, mo, 1)
    }
  }

  const m2 = s.match(/^([A-Za-z]{4,9})[-\s](\d{4})$/)
  if (m2) {
    const mo = MONTH_IDX[m2[1].toLowerCase().slice(0, 3)]
    if (mo !== undefined) return new Date(parseInt(m2[2]), mo, 1)
  }

  const m3 = s.match(/^(\d{1,2})\/(\d{4})$/)
  if (m3) {
    const mo = parseInt(m3[1]) - 1
    if (mo >= 0 && mo <= 11) return new Date(parseInt(m3[2]), mo, 1)
  }

  return null
}

function findMonthCols(row: unknown[]): MonthCol[] {
  const cols: MonthCol[] = []
  for (let i = 0; i < row.length; i++) {
    const d = parseMonthCell(row[i])
    if (d) cols.push({ index: i, date: d })
  }
  return cols.sort((a, b) => a.date.getTime() - b.date.getTime())
}

// ─── Flat format: date cell parser ───────────────────────────────────────────

/**
 * Parse a date value from the flat "Date" column.
 * Handles:
 *   - JS Date objects (SheetJS with cellDates:true)
 *   - "09/06/2026"  (DD/MM/YYYY)
 *   - "09-Jun-2026" / "09-Jun-26"
 *   - "2026-06-09"  (ISO)
 *   - "January 2026" / "Jan 2026"  (monthly summary in Date column)
 */
function parseDateCell(cell: unknown): Date | null {
  if (!cell && cell !== 0) return null

  if (cell instanceof Date) return isNaN(cell.getTime()) ? null : cell

  if (typeof cell === 'number') {
    // Excel serial date
    if (cell < 1000) return null
    const epoch = new Date(1899, 11, 30)
    const d = new Date(epoch.getTime() + cell * 86_400_000)
    return d.getFullYear() >= 2000 ? d : null
  }

  const s = String(cell).trim()

  // DD/MM/YYYY or DD-MM-YYYY
  const mDMY = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/)
  if (mDMY) {
    const [, d, m, y] = mDMY
    return new Date(parseInt(y), parseInt(m) - 1, parseInt(d))
  }

  // DD-Mon-YYYY or DD-Mon-YY
  const mDMonY = s.match(/^(\d{1,2})[-\s]([A-Za-z]{3})[-\s](\d{2,4})$/)
  if (mDMonY) {
    const mo = MONTH_IDX[mDMonY[2].toLowerCase()]
    if (mo !== undefined) {
      const yr = mDMonY[3].length === 2 ? 2000 + parseInt(mDMonY[3]) : parseInt(mDMonY[3])
      return new Date(yr, mo, parseInt(mDMonY[1]))
    }
  }

  // ISO: YYYY-MM-DD
  const mISO = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (mISO) return new Date(parseInt(mISO[1]), parseInt(mISO[2]) - 1, parseInt(mISO[3]))

  // Monthly summary value in a "Date" column: "January 2026" → first of that month
  const monthly = parseMonthCell(s)
  if (monthly) return monthly

  return null
}

// ─── Row classification (legacy format) ──────────────────────────────────────

function isCustomerRow(cell: unknown): boolean {
  return /^\s*\[\d{8,12}\]/.test(String(cell ?? ''))
}

function isProductRow(cell: unknown): boolean {
  const s = String(cell ?? '')
  if (isCustomerRow(s)) return false
  return /^\s*\[[A-Z0-9][\w\-]*\]/i.test(s)
}

function parseCustomerCell(cell: unknown): CustomerInfo | null {
  const m = String(cell ?? '').trim().match(/^\[(\d{8,12})\]\s*(.+)/)
  if (!m) return null
  return { phone: m[1], name: m[2].trim() }
}

function parseProductCell(cell: unknown): ProductInfo | null {
  const m = String(cell ?? '').trim().match(/^\[([^\]]+)\]\s*(.+)/)
  if (!m) return null
  const sku     = m[1].trim()
  const rawName = m[2].trim()
  const w       = extractWeightFull(rawName)
  return { sku, rawName, weightKg: w?.kg ?? null, weightRaw: w?.raw ?? null }
}

// ─── Product-type inference ───────────────────────────────────────────────────

function inferProductType(name: string): 'dry_food' | 'wet_food' | null {
  const n = name.toLowerCase()
  if (/\b(wet|pouch|gravy|jelly|mousse|p[aâ]te|loaf|can|tray|tin)\b/.test(n)) return 'wet_food'
  if (/\b(dry|kibble|pellet|biscuit|crunch|bite)\b/.test(n)) return 'dry_food'
  return null
}

// ─── Replenishment rule matching ──────────────────────────────────────────────

function getDefaultDays(weightKg: number | null, productType: 'dry_food' | 'wet_food' | null): number {
  if (weightKg === null) return 30
  const bands = WEIGHT_DEFAULTS[productType ?? 'default']
  for (const r of bands) {
    if (weightKg <= r.maxKg) return r.days
  }
  return 120
}

function findReplenishmentDays(
  weightKg: number | null,
  productType: 'dry_food' | 'wet_food' | null,
  storeId: string,
  rules: ReplenishmentRule[],
): number {
  function matches(r: ReplenishmentRule): boolean {
    if (weightKg !== null && (weightKg < r.weight_min_kg || weightKg > r.weight_max_kg)) return false
    if (r.product_type && productType && r.product_type !== productType) return false
    return true
  }
  for (const r of rules) {
    if (!r.is_global && r.store_id === storeId && matches(r)) return r.replenishment_days
  }
  for (const r of rules) {
    if (r.is_global && matches(r)) return r.replenishment_days
  }
  return getDefaultDays(weightKg, productType)
}

// ─── Date utilities ───────────────────────────────────────────────────────────

const MS_PER_DAY = 86_400_000

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_PER_DAY)
}

function daysBetween(earlier: Date, later: Date): number {
  return Math.round((later.getTime() - earlier.getTime()) / MS_PER_DAY)
}

function toISO(date: Date): string {
  return date.toISOString().split('T')[0]
}

function startOfToday(): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

// ─── Follow-up task builder ───────────────────────────────────────────────────

/**
 * Emit 1 or 2 follow-up tasks applying these rules in order:
 *
 * SHORT-CYCLE  (t−4 ≤ lastPurchaseDate, i.e. < 4 days of supply):
 *   Emit a single task:  due_date = max(predictedFinish − 2, today), seq = 1
 *
 * NORMAL CYCLE (t−4 > lastPurchaseDate):
 *   Emit two tasks:  FU1 due = max(t−4, today), seq = 1
 *                    FU2 due = max(t−2, today), seq = 2
 *
 * GENERAL GUARD: no due_date may be before lastPurchaseDate OR before today.
 */
function buildFollowupTasks(
  base: Partial<Task>,
  lastPurchaseDate: Date,
  predictedFinish: Date,
): Partial<Task>[] {
  const today = startOfToday()
  const t4    = addDays(predictedFinish, -4)
  const t2    = addDays(predictedFinish, -2)

  // Clamp: never before lastPurchaseDate and never before today
  const floor = new Date(Math.max(lastPurchaseDate.getTime(), today.getTime()))
  const clamp = (d: Date): Date => d < floor ? floor : d

  if (t4.getTime() <= lastPurchaseDate.getTime()) {
    // Short-cycle: emit a single follow-up at max(t−2, floor)
    return [{ ...base, due_date: toISO(clamp(t2)), followup_sequence: 1 }]
  }

  return [
    { ...base, due_date: toISO(clamp(t4)), followup_sequence: 1 },
    { ...base, due_date: toISO(clamp(t2)), followup_sequence: 2 },
  ]
}

// ─── Task-type determination ──────────────────────────────────────────────────

function determineTaskType(
  purchaseDates: Date[],
  lastPurchaseDate: Date,
): Task['task_type'] {
  const today = new Date()
  const n = purchaseDates.length

  if (n === 0) return 'reorder'

  const daysSinceLast = daysBetween(lastPurchaseDate, today)

  if (n === 1 && daysSinceLast > 60) return 'winback'

  if (n >= 2) {
    const sorted = [...purchaseDates].sort((a, b) => a.getTime() - b.getTime())
    for (let i = 1; i < sorted.length; i++) {
      const gap = daysBetween(sorted[i - 1], sorted[i])
      if (gap > 45) return 'pattern_break'
    }
  }

  return 'reorder'
}

// Legacy overload for month-column format
function determineTaskTypeMonthly(
  monthCols: MonthCol[],
  quantities: number[],
  lastPurchaseDate: Date,
): Task['task_type'] {
  const purchaseMonths = monthCols.filter((_, i) => (quantities[i] ?? 0) > 0)
  return determineTaskType(purchaseMonths.map((m) => m.date), lastPurchaseDate)
}

// ─── Priority determination ───────────────────────────────────────────────────

function determinePriority(daysUntilFinish: number): Task['priority'] {
  if (daysUntilFinish <= 4) return 'high'
  if (daysUntilFinish <= 7) return 'medium'
  return 'low'
}

// ─── Task builder (shared) ────────────────────────────────────────────────────

function buildTasksFromHistory(
  customer: CustomerInfo,
  product: ProductInfo,
  purchaseDates: Date[],
  lastQty: number,
  storeId: string,
  rules: ReplenishmentRule[],
): Partial<Task>[] {
  if (purchaseDates.length === 0) return []

  const sorted          = [...purchaseDates].sort((a, b) => a.getTime() - b.getTime())
  const lastPurchaseDate = sorted[sorted.length - 1]
  const productType     = inferProductType(product.rawName)
  const replenDays      = findReplenishmentDays(product.weightKg, productType, storeId, rules)

  const today           = new Date()
  const predictedFinish = addDays(lastPurchaseDate, replenDays)
  const t4              = addDays(predictedFinish, -4)
  const t2              = addDays(predictedFinish, -2)
  const daysUntilFinish = daysBetween(today, predictedFinish)

  const taskType = determineTaskType(sorted, lastPurchaseDate)
  const priority = determinePriority(daysUntilFinish)

  const base: Partial<Task> = {
    store_id:              storeId,
    customer_name:         customer.name,
    customer_phone:        customer.phone,
    task_type:             taskType,
    priority,
    status:                'pending',
    notes:                 null,
    product_name:          product.rawName,
    product_weight:        product.weightRaw,
    product_sku:           product.sku,
    last_purchase_date:    toISO(lastPurchaseDate),
    last_purchase_qty:     lastQty,
    replenishment_days:    replenDays,
    predicted_finish_date: toISO(predictedFinish),
    followup_t_minus_4:    toISO(t4),
    followup_t_minus_2:    toISO(t2),
  }

  return buildFollowupTasks(base, lastPurchaseDate, predictedFinish)
}

// Legacy task builder used by the wide/pivot format
function buildTasksLegacy(
  customer: CustomerInfo,
  product: ProductInfo,
  monthCols: MonthCol[],
  quantities: number[],
  storeId: string,
  rules: ReplenishmentRule[],
): Partial<Task>[] {
  let lastIdx = -1
  let lastQty  = 0
  for (let i = monthCols.length - 1; i >= 0; i--) {
    if ((quantities[i] ?? 0) > 0) { lastIdx = i; lastQty = quantities[i]; break }
  }
  if (lastIdx === -1) return []

  const purchaseDates = monthCols
    .filter((_, i) => (quantities[i] ?? 0) > 0)
    .map((mc) => mc.date)

  const lastPurchaseDate = monthCols[lastIdx].date
  const productType      = inferProductType(product.rawName)
  const replenDays       = findReplenishmentDays(product.weightKg, productType, storeId, rules)

  const today            = new Date()
  const predictedFinish  = addDays(lastPurchaseDate, replenDays)
  const t4               = addDays(predictedFinish, -4)
  const t2               = addDays(predictedFinish, -2)
  const daysUntilFinish  = daysBetween(today, predictedFinish)

  const allQty   = monthCols.map((_, i) => quantities[i] ?? 0)
  const taskType = determineTaskTypeMonthly(monthCols, allQty, lastPurchaseDate)
  const priority = determinePriority(daysUntilFinish)

  const base: Partial<Task> = {
    store_id:              storeId,
    customer_name:         customer.name,
    customer_phone:        customer.phone,
    task_type:             taskType,
    priority,
    status:                'pending',
    notes:                 null,
    product_name:          product.rawName,
    product_weight:        product.weightRaw,
    product_sku:           product.sku,
    last_purchase_date:    toISO(lastPurchaseDate),
    last_purchase_qty:     lastQty,
    replenishment_days:    replenDays,
    predicted_finish_date: toISO(predictedFinish),
    followup_t_minus_4:    toISO(t4),
    followup_t_minus_2:    toISO(t2),
  }

  return buildFollowupTasks(base, lastPurchaseDate, predictedFinish)
}

// ─── CSV parser ───────────────────────────────────────────────────────────────

function parseCsvLine(line: string): string[] {
  const cells: string[] = []
  let i = 0
  while (i <= line.length) {
    if (i === line.length) { cells.push(''); break }
    if (line[i] === '"') {
      let j = i + 1
      while (j < line.length) {
        if (line[j] === '"' && line[j + 1] === '"') { j += 2; continue }
        if (line[j] === '"') break
        j++
      }
      cells.push(line.slice(i + 1, j).replace(/""/g, '"'))
      i = j + 2
    } else {
      const end = line.indexOf(',', i)
      if (end === -1) { cells.push(line.slice(i)); break }
      cells.push(line.slice(i, end))
      i = end + 1
    }
  }
  return cells
}

function parseCsv(csv: string): string[][] {
  return csv
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map(parseCsvLine)
}

// ─── Flat format: header detection ───────────────────────────────────────────

/**
 * Look for a header row in the flat format.
 * Returns column indices for the columns we care about, or null if not found.
 */
interface FlatHeader {
  phone:    number
  name:     number
  barcode:  number
  product:  number
  qty:      number
  dateOrMonth: number   // "Date" or "Month" column
  isDaily:  boolean     // true → individual dates; false → "Month YYYY" values
}

const FLAT_COL_ALIASES: Record<keyof Omit<FlatHeader, 'isDaily'>, string[]> = {
  phone:       ['customer phone', 'phone', 'mobile', 'customer mobile'],
  name:        ['customer name', 'name', 'customer'],
  barcode:     ['product barcode', 'barcode', 'sku', 'product sku', 'item code'],
  product:     ['product name', 'product', 'item name', 'item'],
  qty:         ['product quantity', 'quantity', 'qty'],
  dateOrMonth: ['date', 'month', 'transaction date', 'sale date', 'purchase date'],
}

function detectFlatHeader(rows: unknown[][]): (FlatHeader & { headerIdx: number }) | null {
  for (let ri = 0; ri < Math.min(rows.length, 10); ri++) {
    const row = rows[ri]
    const lower = row.map((c) => String(c ?? '').trim().toLowerCase())

    // Must have at least phone + product + (date or month)
    const hasPhone   = lower.some((h) => FLAT_COL_ALIASES.phone.includes(h))
    const hasProduct = lower.some((h) => FLAT_COL_ALIASES.product.includes(h))
    const hasDate    = lower.some((h) => FLAT_COL_ALIASES.dateOrMonth.includes(h))
    if (!hasPhone || !hasProduct || !hasDate) continue

    function colIdx(aliases: string[]): number {
      return lower.findIndex((h) => aliases.includes(h))
    }

    const dateColIdx = colIdx(FLAT_COL_ALIASES.dateOrMonth)
    const dateColName = lower[dateColIdx]
    const isDaily = dateColName === 'date' || dateColName.includes('transaction') || dateColName.includes('sale')

    return {
      headerIdx:   ri,
      phone:       colIdx(FLAT_COL_ALIASES.phone),
      name:        colIdx(FLAT_COL_ALIASES.name),
      barcode:     colIdx(FLAT_COL_ALIASES.barcode),
      product:     colIdx(FLAT_COL_ALIASES.product),
      qty:         colIdx(FLAT_COL_ALIASES.qty),
      dateOrMonth: dateColIdx,
      isDaily,
    }
  }
  return null
}

// ─── Flat format processor ────────────────────────────────────────────────────

/**
 * Aggregation key: phone + barcode (unique customer-product pair per store)
 */
interface FlatAggRow {
  customer:      CustomerInfo
  product:       ProductInfo
  purchaseDates: Date[]
  lastQty:       number
}

function processFlatSheet(
  rows: unknown[][],
  storeId: string,
  rules: ReplenishmentRule[],
): Partial<Task>[] {
  const header = detectFlatHeader(rows)
  if (!header) return []

  const agg = new Map<string, FlatAggRow>()

  for (let ri = header.headerIdx + 1; ri < rows.length; ri++) {
    const row = rows[ri]

    const phoneRaw   = String(row[header.phone]   ?? '').trim()
    const nameRaw    = String(row[header.name]     ?? '').trim()
    const barcodeRaw = String(row[header.barcode]  ?? '').trim()
    const productRaw = String(row[header.product]  ?? '').trim()
    const qtyRaw     = row[header.qty]
    const dateRaw    = row[header.dateOrMonth]

    // Skip blank or legend rows
    if (!phoneRaw || !productRaw || !dateRaw) continue
    if (!/^\d{8,12}$/.test(phoneRaw)) continue

    const purchaseDate = parseDateCell(dateRaw)
    if (!purchaseDate) continue

    const qty = typeof qtyRaw === 'number' ? qtyRaw : parseFloat(String(qtyRaw ?? '0'))
    if (isNaN(qty) || qty < 0) continue

    const key      = `${phoneRaw}::${barcodeRaw || productRaw}`
    const w        = extractWeightFull(productRaw)
    const existing = agg.get(key)

    if (!existing) {
      agg.set(key, {
        customer: { phone: phoneRaw, name: nameRaw },
        product:  {
          sku:       barcodeRaw || productRaw.slice(0, 20),
          rawName:   productRaw,
          weightKg:  w?.kg  ?? null,
          weightRaw: w?.raw ?? null,
        },
        purchaseDates: [purchaseDate],
        lastQty:       qty,
      })
    } else {
      existing.purchaseDates.push(purchaseDate)
      // Keep the most recent qty as lastQty
      const sorted = [...existing.purchaseDates].sort((a, b) => b.getTime() - a.getTime())
      if (purchaseDate >= sorted[0]) existing.lastQty = qty
    }
  }

  const tasks: Partial<Task>[] = []
  for (const row of agg.values()) {
    tasks.push(
      ...buildTasksFromHistory(row.customer, row.product, row.purchaseDates, row.lastQty, storeId, rules),
    )
  }
  return tasks
}

// ─── Legacy format processor ──────────────────────────────────────────────────

function processLegacySheet(
  rows: unknown[][],
  storeId: string,
  rules: ReplenishmentRule[],
): Partial<Task>[] {
  let headerIdx = -1
  let monthCols: MonthCol[] = []

  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const cols = findMonthCols(rows[i])
    if (cols.length >= 2) { headerIdx = i; monthCols = cols; break }
  }

  if (headerIdx === -1 || monthCols.length === 0) return []

  const tasks: Partial<Task>[] = []
  let customer: CustomerInfo | null = null

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row  = rows[i]
    const cell = row[0]

    if (isCustomerRow(cell)) {
      customer = parseCustomerCell(cell)
    } else if (isProductRow(cell) && customer) {
      const product = parseProductCell(cell)
      if (!product) continue

      const quantities: number[] = monthCols.map((col) => {
        const v = row[col.index]
        if (v === null || v === undefined || v === '') return 0
        const n = typeof v === 'number' ? v : parseFloat(String(v))
        return isNaN(n) || n < 0 ? 0 : n
      })

      tasks.push(...buildTasksLegacy(customer, product, monthCols, quantities, storeId, rules))
    }
  }

  return tasks
}

// ─── Format auto-detection ────────────────────────────────────────────────────

/**
 * Returns 'flat' if the sheet looks like the new flat format, 'legacy' otherwise.
 */
function detectFormat(rows: unknown[][]): 'flat' | 'legacy' {
  return detectFlatHeader(rows) !== null ? 'flat' : 'legacy'
}

// ─── Core sheet processor ─────────────────────────────────────────────────────

function processSheet(
  rows: unknown[][],
  storeId: string,
  rules: ReplenishmentRule[],
): Partial<Task>[] {
  const format = detectFormat(rows)
  if (format === 'flat') {
    return processFlatSheet(rows, storeId, rules)
  }
  return processLegacySheet(rows, storeId, rules)
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Parse a single store's ERP data (CSV string or SheetJS sheet_to_json output).
 * Handles both legacy wide format and new flat format automatically.
 */
export const parseERPData = (
  data: string | unknown[][],
  storeId: string,
  rules: ReplenishmentRule[],
): Partial<Task>[] => {
  const rows: unknown[][] =
    typeof data === 'string' ? parseCsv(data) : (data as unknown[][])
  return processSheet(rows, storeId, rules)
}

/**
 * Parse a multi-sheet Excel file where each sheet represents a different store.
 * Sheet names are matched against storeMap (case-insensitive, trims spaces).
 * Both flat and legacy formats are detected automatically per sheet.
 *
 * @param file      - Browser File object
 * @param storeMap  - { "SAKET": "uuid-...", "GK2": "uuid-...", ... }
 * @param rules     - All replenishment rules (global + store-specific)
 */
export const parseMultiSheetExcel = async (
  file: File,
  storeMap: Record<string, string>,
  rules: ReplenishmentRule[],
): Promise<Record<string, Partial<Task>[]>> => {
  const XLSX = await import('xlsx')

  const buffer   = await file.arrayBuffer()
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true })

  // Build a normalised lookup: lowercase-trimmed sheet name → storeId
  const normMap: Record<string, string> = {}
  for (const [k, v] of Object.entries(storeMap)) {
    normMap[k.trim().toLowerCase()] = v
  }

  const result: Record<string, Partial<Task>[]> = {}

  for (const sheetName of workbook.SheetNames) {
    const storeId = normMap[sheetName.trim().toLowerCase()]
    if (!storeId) continue

    const sheet     = workbook.Sheets[sheetName]
    const sheetData = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header:  1,
      defval:  '',
      raw:     false,
    })

    const tasks = processSheet(sheetData as unknown[][], storeId, rules)
    if (tasks.length > 0) {
      result[storeId] = [...(result[storeId] ?? []), ...tasks]
    }
  }

  return result
}
