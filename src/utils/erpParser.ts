/**
 * ERP CSV / Excel parser
 *
 * Converts HUFT store ERP exports (customer → product rows with monthly
 * purchase quantities) into Task objects ready for Supabase insertion.
 *
 * Row format in the source file
 *   Customer row : "[9871297107] Aamir- EPPL761"
 *   Product row  : "[RC-ADULT-2KG] Royal Canin Adult 2 kg  | qty1 | qty2 | …"
 */

import type { Task, ReplenishmentRule } from '@/types'

// ─── Internal types ───────────────────────────────────────────────────────────

type MonthCol  = { index: number; date: Date }
type CustomerInfo = { phone: string; name: string }
type ProductInfo  = { sku: string; rawName: string; weightKg: number | null; weightRaw: string | null }

// ─── Month name → 0-based index map ──────────────────────────────────────────

const MONTH_IDX: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
}

// ─── Hardcoded fallback replenishment rules ───────────────────────────────────

const WEIGHT_DEFAULTS: Array<{ maxKg: number; days: number }> = [
  { maxKg: 0.5,       days: 15 },
  { maxKg: 2,         days: 30 },
  { maxKg: 5,         days: 45 },
  { maxKg: 15,        days: 60 },
  { maxKg: Infinity,  days: 90 },
]

// ─── Weight helpers ───────────────────────────────────────────────────────────

/**
 * Extract weight from a product-name string and return it in kg.
 *
 *   "100 gm"  → 0.1
 *   "500g"    → 0.5
 *   "2 kg"    → 2.0
 *   "2.5kg"   → 2.5
 */
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

// ─── Month header detection ───────────────────────────────────────────────────

/**
 * Parse a cell value to the first day of the represented month.
 * Handles: "Jan-24", "Jan 24", "Jan'24", "Jan-2024", "Jan 2024",
 *          "January 2024", "1/2024", Excel serial dates.
 */
function parseMonthCell(cell: unknown): Date | null {
  if (cell === null || cell === undefined || cell === '') return null

  // Excel serial date (a positive integer not resembling a qty, i.e. > 1000)
  if (typeof cell === 'number') {
    if (cell < 1000) return null           // likely a purchase quantity
    const epoch = new Date(1899, 11, 30)   // Excel 1900 epoch
    const d = new Date(epoch.getTime() + cell * 86_400_000)
    if (d.getFullYear() < 2000 || d.getFullYear() > 2035) return null
    return new Date(d.getFullYear(), d.getMonth(), 1)
  }

  if (cell instanceof Date) {
    if (cell.getFullYear() < 2000 || cell.getFullYear() > 2035) return null
    return new Date(cell.getFullYear(), cell.getMonth(), 1)
  }

  const s = String(cell).trim()

  // "Jan-24" / "Jan 24" / "Jan'24" / "Jan-2024" / "Jan 2024"
  const m1 = s.match(/^([A-Za-z]{3})[-\s'](\d{2,4})$/)
  if (m1) {
    const mo = MONTH_IDX[m1[1].toLowerCase()]
    if (mo !== undefined) {
      const yr = m1[2].length === 2 ? 2000 + parseInt(m1[2]) : parseInt(m1[2])
      return new Date(yr, mo, 1)
    }
  }

  // "January 2024" / "January-2024"
  const m2 = s.match(/^([A-Za-z]{4,9})[-\s](\d{4})$/)
  if (m2) {
    const mo = MONTH_IDX[m2[1].toLowerCase().slice(0, 3)]
    if (mo !== undefined) return new Date(parseInt(m2[2]), mo, 1)
  }

  // "1/2024" / "01/2024"
  const m3 = s.match(/^(\d{1,2})\/(\d{4})$/)
  if (m3) {
    const mo = parseInt(m3[1]) - 1
    if (mo >= 0 && mo <= 11) return new Date(parseInt(m3[2]), mo, 1)
  }

  return null
}

/** Scan one row and return all month-labelled column positions, sorted ascending. */
function findMonthCols(row: unknown[]): MonthCol[] {
  const cols: MonthCol[] = []
  for (let i = 0; i < row.length; i++) {
    const d = parseMonthCell(row[i])
    if (d) cols.push({ index: i, date: d })
  }
  return cols.sort((a, b) => a.date.getTime() - b.date.getTime())
}

// ─── Row classification ───────────────────────────────────────────────────────

/** Customer rows have an exactly-10-to-12-digit phone in brackets. */
function isCustomerRow(cell: unknown): boolean {
  return /^\s*\[\d{8,12}\]/.test(String(cell ?? ''))
}

/** Product rows have an alphanumeric SKU (containing at least one letter) in brackets. */
function isProductRow(cell: unknown): boolean {
  const s = String(cell ?? '')
  if (isCustomerRow(s)) return false
  return /^\s*\[[A-Z0-9][\w\-]*\]/i.test(s)
}

// ─── Cell parsers ─────────────────────────────────────────────────────────────

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

function getDefaultDays(weightKg: number | null): number {
  if (weightKg === null) return 30
  for (const r of WEIGHT_DEFAULTS) {
    if (weightKg <= r.maxKg) return r.days
  }
  return 90
}

function findReplenishmentDays(
  weightKg: number | null,
  productType: 'dry_food' | 'wet_food' | null,
  storeId: string,
  rules: ReplenishmentRule[],
): number {
  function matches(r: ReplenishmentRule): boolean {
    // Weight range (skip check if product weight unknown)
    if (weightKg !== null && (weightKg < r.weight_min || weightKg > r.weight_max)) return false
    // Product type (skip if either side is unknown)
    if (r.product_type && productType && r.product_type !== productType) return false
    return true
  }

  // 1. Store-specific
  for (const r of rules) {
    if (!r.is_global && r.store_id === storeId && matches(r)) return r.replenishment_days
  }
  // 2. Global
  for (const r of rules) {
    if (r.is_global && matches(r)) return r.replenishment_days
  }
  // 3. Hardcoded fallback
  return getDefaultDays(weightKg)
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

// ─── Task-type determination ──────────────────────────────────────────────────

function determineTaskType(
  monthCols: MonthCol[],
  quantities: number[],
  lastPurchaseDate: Date,
): Task['task_type'] {
  const today = new Date()
  const purchaseMonths = monthCols.filter((_, i) => (quantities[i] ?? 0) > 0)
  const n = purchaseMonths.length

  if (n === 0) return 'reorder'

  const daysSinceLast = daysBetween(lastPurchaseDate, today)

  // Single purchase + lapsed > 60 days → winback
  if (n === 1 && daysSinceLast > 60) return 'winback'

  // 2+ purchases: check for irregular gaps (> 45 days between consecutive buys)
  if (n >= 2) {
    for (let i = 1; i < purchaseMonths.length; i++) {
      const gap = daysBetween(purchaseMonths[i - 1].date, purchaseMonths[i].date)
      if (gap > 45) return 'pattern_break'
    }
  }

  return 'reorder'
}

// ─── Priority determination ───────────────────────────────────────────────────

function determinePriority(daysUntilFinish: number): Task['priority'] {
  if (daysUntilFinish <= 4) return 'high'   // covers <= 0 (already finished) too
  if (daysUntilFinish <= 7) return 'medium'
  return 'low'
}

// ─── Task builder ─────────────────────────────────────────────────────────────

function buildTasks(
  customer: CustomerInfo,
  product: ProductInfo,
  monthCols: MonthCol[],
  quantities: number[],
  storeId: string,
  rules: ReplenishmentRule[],
): Partial<Task>[] {
  // Find last month with a non-zero purchase
  let lastIdx = -1
  let lastQty  = 0
  for (let i = monthCols.length - 1; i >= 0; i--) {
    if ((quantities[i] ?? 0) > 0) { lastIdx = i; lastQty = quantities[i]; break }
  }
  if (lastIdx === -1) return []   // no purchase history → skip

  const lastPurchaseDate  = monthCols[lastIdx].date
  const productType       = inferProductType(product.rawName)
  const replenDays        = findReplenishmentDays(product.weightKg, productType, storeId, rules)

  const today             = new Date()
  const predictedFinish   = addDays(lastPurchaseDate, replenDays)
  const t4                = addDays(predictedFinish, -4)
  const t2                = addDays(predictedFinish, -2)
  const daysUntilFinish   = daysBetween(today, predictedFinish)

  const allQty = monthCols.map((_, i) => quantities[i] ?? 0)
  const taskType = determineTaskType(monthCols, allQty, lastPurchaseDate)
  const priority = determinePriority(daysUntilFinish)

  const base: Partial<Task> = {
    store_id:             storeId,
    customer_name:        customer.name,
    customer_phone:       customer.phone,
    task_type:            taskType,
    priority,
    status:               'pending',
    notes:                null,
    product_name:         product.rawName,
    product_weight:       product.weightRaw,
    product_sku:          product.sku,
    last_purchase_date:   toISO(lastPurchaseDate),
    last_purchase_qty:    lastQty,
    replenishment_days:   replenDays,
    predicted_finish_date: toISO(predictedFinish),
    followup_t_minus_4:   toISO(t4),
    followup_t_minus_2:   toISO(t2),
  }

  return [
    { ...base, due_date: toISO(t4), followup_sequence: 1 },
    { ...base, due_date: toISO(t2), followup_sequence: 2 },
  ]
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
      i = j + 2   // skip closing quote + comma separator
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

// ─── Core sheet processor ─────────────────────────────────────────────────────

function processSheet(
  rows: unknown[][],
  storeId: string,
  rules: ReplenishmentRule[],
): Partial<Task>[] {
  // Locate the header row — first row with ≥ 2 parseable month columns
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

      tasks.push(...buildTasks(customer, product, monthCols, quantities, storeId, rules))
    }
  }

  return tasks
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Parse a single store's ERP data.
 *
 * @param data       - Raw CSV string **or** SheetJS `sheet_to_json({header:1})` output
 * @param storeId    - Supabase store UUID to stamp on every generated task
 * @param rules      - All replenishment rules (store-specific + global)
 * @returns          - Array of `Partial<Task>` (two per customer-product pair)
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
 *
 * Requires `xlsx` (SheetJS) to be installed:  `npm install xlsx`
 *
 * @param file      - Browser `File` object (the uploaded Excel)
 * @param storeMap  - Map of sheet name → Supabase store UUID
 * @param rules     - All replenishment rules
 * @returns         - Map of store UUID → tasks array
 */
export const parseMultiSheetExcel = async (
  file: File,
  storeMap: Record<string, string>,
  rules: ReplenishmentRule[],
): Promise<Record<string, Partial<Task>[]>> => {
  const XLSX = await import('xlsx')

  const buffer   = await file.arrayBuffer()
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true })

  const result: Record<string, Partial<Task>[]> = {}

  for (const sheetName of workbook.SheetNames) {
    const storeId = storeMap[sheetName]
    if (!storeId) continue

    const sheet    = workbook.Sheets[sheetName]
    const sheetData = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: '',
      raw: false,   // let SheetJS format dates as strings — parseMonthCell handles them
    })

    const tasks = processSheet(sheetData as unknown[][], storeId, rules)
    if (tasks.length > 0) {
      result[storeId] = [...(result[storeId] ?? []), ...tasks]
    }
  }

  return result
}
