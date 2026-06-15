import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  GoogleGenerativeAI,
  HarmBlockThreshold,
  HarmCategory,
} from 'https://esm.sh/@google/generative-ai@0.21.0'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')!
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY)

const SAFETY = [
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT,        threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,       threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
]

// ── Types ─────────────────────────────────────────────────────────────────────

type Submission = {
  id: string
  staff_id: string
  store_id: string
  theme_id: string
  video_url: string | null
  submission_type: string | null
  staff:  { name: string } | null
  store:  { name: string; has_spa?: boolean | null } | null
  theme:  { title: string; brief_text: string; scoring_criteria: string[] | null } | null
}

type Override = {
  override_score: number
  trainer_notes:  string | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const ALL_CRITERIA = [
  { dimension: 'First Impression',             max: 5, is_bonus: false, rubric: 'Grooming, hygiene, body language, attitude, energy. 5 = excellent across all; deduct 1 per noticeable shortfall.' },
  { dimension: 'Customer Welcome',             max: 3, is_bonus: false, rubric: 'Did the staff greet the customer, welcome them to the store, and introduce themselves by name? 1 point per element present.' },
  { dimension: 'Price Perception',             max: 2, is_bonus: false, rubric: 'Did the staff use keywords that create positive price perception? 2 = clearly communicated, 1 = partial, 0 = absent.' },
  { dimension: 'Pet Details',                  max: 4, is_bonus: false, rubric: "Did the staff collect the pet's breed, age, name, and weight? 1 point per detail collected." },
  { dimension: 'Product & Breed Knowledge',    max: 1, is_bonus: false, rubric: 'Did the staff demonstrate accurate product or breed-specific knowledge? 1 = yes, 0 = no.' },
  { dimension: 'Product Demonstration',        max: 2, is_bonus: false, rubric: 'Did the staff physically pick up and show a product while explaining its USPs? 2 = full demo, 1 = showed without USPs, 0 = absent.' },
  { dimension: 'Offers Communication',         max: 1, is_bonus: false, rubric: 'Did the staff proactively inform the customer about current offers? 1 = yes, 0 = no.' },
  { dimension: 'Cross Sell / Upsell',          max: 1, is_bonus: false, rubric: 'Did the staff use SWF questioning to cross-sell or upsell? 1 = yes, 0 = no.' },
  { dimension: 'Query Handling',               max: 1, is_bonus: false, rubric: 'Did the staff address all customer questions effectively? 1 = yes, 0 = no.' },
  { dimension: 'Product Suggestion',           max: 1, is_bonus: false, rubric: 'Did the staff suggest a specific product after understanding needs? 1 = yes, 0 = no.' },
  { dimension: 'Impulse Products',             max: 1, is_bonus: false, rubric: 'Did the staff suggest impulse products at checkout? 1 = yes, 0 = no.' },
  { dimension: 'Customer Data Capture',        max: 1, is_bonus: false, rubric: 'Did the staff update pet details at billing? 1 = yes, 0 = no.' },
  { dimension: 'Bag Handover & Google Review', max: 1, is_bonus: false, rubric: 'Did the staff thank the customer and mention Google review? 1 = yes, 0 = no.' },
  { dimension: 'Shopping Basket',              max: 1, is_bonus: true,  rubric: 'Did the staff hand a shopping basket to the customer? 1 = yes, 0 = no.' },
  { dimension: 'Spa Introduction',             max: 1, is_bonus: true,  rubric: null }, // set dynamically
]

function buildPrompt(
  submission: Submission,
  overrides: Override[],
): string {
  const themeBrief = submission.theme?.brief_text ?? ''
  const themeTitle = submission.theme?.title     ?? 'Unknown Theme'
  const staffName  = submission.staff?.name      ?? 'Staff member'
  const storeName  = submission.store?.name      ?? 'Unknown store'
  const hasSpa     = submission.store?.has_spa ?? false

  const examplesBlock = overrides.length > 0
    ? `\n\n## Trainer-calibrated examples for this theme\nThese are scores that a human trainer has manually reviewed and corrected for this theme. Use them to calibrate your judgment:\n\n${
        overrides.map((o, i) =>
          `Example ${i + 1}: Trainer gave ${o.override_score}/100${o.trainer_notes ? ` — Notes: "${o.trainer_notes}"` : ''}`
        ).join('\n')
      }`
    : ''

  const spaInstruction = hasSpa
    ? 'This store HAS a spa — evaluate whether the staff introduced spa services.'
    : 'This store does NOT have a spa — set score to 0 and feedback to "N/A – no spa at this store".'

  return `You are a retail training assessor for HUFT (Heads Up For Tails), a premium pet-care brand in India.

## Submission context
Staff: ${staffName}
Store: ${storeName}
Theme: ${themeTitle}

## Theme brief
${themeBrief}
${examplesBlock}

## ⚠️ SCORING SCOPE — READ FIRST
${submission.theme?.scoring_criteria ? `This theme restricts scoring to ONLY these criteria: ${submission.theme.scoring_criteria.join(', ')}.
For every other criterion NOT in this list, you MUST set score = 0 and feedback = "Not assessed for this theme." No exceptions.` : 'Score all criteria below.'}

## Task
Watch the video submission carefully and evaluate the staff member's roleplay performance against the criteria below.

${(() => {
  const activeCriteria = submission.theme?.scoring_criteria
  const criteriaList = [
    { d: "First Impression", max: 5, bonus: false, r: "Grooming, hygiene, body language, attitude, energy. 5=excellent; deduct 1 per shortfall." },
    { d: "Customer Welcome", max: 3, bonus: false, r: "Greet customer, welcome to store, introduce by name. 1 point each." },
    { d: "Price Perception", max: 2, bonus: false, r: "Keywords creating positive price perception. 2=clear, 1=partial, 0=absent." },
    { d: "Pet Details", max: 4, bonus: false, r: "Collect pet breed, age, name, weight. 1 point per detail." },
    { d: "Product & Breed Knowledge", max: 1, bonus: false, r: "Accurate product/breed knowledge. 1=yes, 0=no." },
    { d: "Product Demonstration", max: 2, bonus: false, r: "Physically show product with USPs. 2=full, 1=no USPs, 0=absent." },
    { d: "Offers Communication", max: 1, bonus: false, r: "Proactively mention current offers. 1=yes, 0=no." },
    { d: "Cross Sell / Upsell", max: 1, bonus: false, r: "SWF questioning for cross-sell/upsell. 1=yes, 0=no." },
    { d: "Query Handling", max: 1, bonus: false, r: "Address all customer questions. 1=yes, 0=no." },
    { d: "Product Suggestion", max: 1, bonus: false, r: "Suggest specific product after understanding needs. 1=yes, 0=no." },
    { d: "Impulse Products", max: 1, bonus: false, r: "Suggest impulse products at checkout. 1=yes, 0=no." },
    { d: "Customer Data Capture", max: 1, bonus: false, r: "Update pet details at billing. 1=yes, 0=no." },
    { d: "Bag Handover & Google Review", max: 1, bonus: false, r: "Thank customer and mention Google review. 1=yes, 0=no." },
    { d: "Shopping Basket", max: 1, bonus: true, r: "Hand shopping basket to customer. 1=yes, 0=no." },
    { d: "Spa Introduction", max: 1, bonus: true, r: spaInstruction + " 1=yes, 0=no/N/A." },
  ]
  const active = activeCriteria ? criteriaList.filter(c => activeCriteria.includes(c.d)) : criteriaList
  const inactive = activeCriteria ? criteriaList.filter(c => !activeCriteria.includes(c.d)) : []
  const reqMax = active.filter(c => !c.bonus).reduce((s, c) => s + c.max, 0)
  let out = `## Active scoring criteria (max ${reqMax} required points)\n`
  if (inactive.length) out += `INACTIVE (score=0, feedback="Not assessed for this theme."): ${inactive.map(c=>c.d).join(", ")}\n\n`
  out += "### Score ONLY these criteria:\n"
  active.filter(c=>!c.bonus).forEach((c,i) => { out += `${i+1}. **${c.d}** (max ${c.max}) — ${c.r}\n` })
  if (active.some(c=>c.bonus)) {
    out += "\n### Bonus (not in required total):\n"
    active.filter(c=>c.bonus).forEach((c,i) => { out += `${i+1}. **${c.d}** (max ${c.max}) — ${c.r}\n` })
  }
  return out
})()}

## IMPORTANT — validity check
Before scoring, determine whether this is a valid HUFT retail roleplay video. A valid video must show a staff member interacting with or simulating a customer interaction in a retail context. If the video does NOT show a customer interaction (e.g. it shows only animals, random footage, personal videos, or has no human speaking), respond with this exact JSON instead of scoring:
{ "invalid": true, "reason": "<one sentence describing what the video actually shows>" }

## Output format (only if the video is valid)
Respond with valid JSON only — no markdown fences, no extra text:

{
  "required_score": <integer, sum of ACTIVE required criteria scores only>,
  "bonus_score": <integer, sum of ACTIVE bonus criteria scores only>,
  "overall": <integer 0–100, = round((required_score / active_required_max) * 100) where active_required_max is the sum of max points of active required criteria>,
  "breakdown": [
    { "dimension": "First Impression",            "score": <0–5>, "max_score": 5, "is_bonus": false, "feedback": "<one line>" },
    { "dimension": "Customer Welcome",            "score": <0–3>, "max_score": 3, "is_bonus": false, "feedback": "<one line>" },
    { "dimension": "Price Perception",            "score": <0–2>, "max_score": 2, "is_bonus": false, "feedback": "<one line>" },
    { "dimension": "Pet Details",                 "score": <0–4>, "max_score": 4, "is_bonus": false, "feedback": "<one line>" },
    { "dimension": "Product & Breed Knowledge",   "score": <0–1>, "max_score": 1, "is_bonus": false, "feedback": "<one line>" },
    { "dimension": "Product Demonstration",       "score": <0–2>, "max_score": 2, "is_bonus": false, "feedback": "<one line>" },
    { "dimension": "Offers Communication",        "score": <0–1>, "max_score": 1, "is_bonus": false, "feedback": "<one line>" },
    { "dimension": "Cross Sell / Upsell",         "score": <0–1>, "max_score": 1, "is_bonus": false, "feedback": "<one line>" },
    { "dimension": "Query Handling",              "score": <0–1>, "max_score": 1, "is_bonus": false, "feedback": "<one line>" },
    { "dimension": "Product Suggestion",          "score": <0–1>, "max_score": 1, "is_bonus": false, "feedback": "<one line>" },
    { "dimension": "Impulse Products",            "score": <0–1>, "max_score": 1, "is_bonus": false, "feedback": "<one line>" },
    { "dimension": "Customer Data Capture",       "score": <0–1>, "max_score": 1, "is_bonus": false, "feedback": "<one line>" },
    { "dimension": "Bag Handover & Google Review","score": <0–1>, "max_score": 1, "is_bonus": false, "feedback": "<one line>" },
    { "dimension": "Shopping Basket",             "score": <0–1>, "max_score": 1, "is_bonus": true,  "feedback": "<one line>" },
    { "dimension": "Spa Introduction",            "score": <0–1>, "max_score": 1, "is_bonus": true,  "feedback": "<one line>" }
  ],
  "summary": "<2-3 sentence overall summary of the performance>"
}`
}

// ── Handler ───────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin':  '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      },
    })
  }

  try {
    const body = await req.json() as { submission_id?: string; record?: { id: string }; type?: string }
    // Accept direct call ({ submission_id }) or Supabase webhook payload ({ type, record })
    const submission_id = body.submission_id ?? body.record?.id
    if (!submission_id) return jsonError('submission_id is required', 400)

    // ── 1. Fetch submission ───────────────────────────────────────────────────
    const { data: sub, error: subErr } = await supabase
      .from('roleplay_submissions')
      .select('*, submission_type, staff:staff!roleplay_submissions_staff_id_fkey(name), store:stores!roleplay_submissions_store_id_fkey(name, has_spa), theme:themes!roleplay_submissions_theme_id_fkey(title, brief_text, scoring_criteria)')
      .eq('id', submission_id)
      .single()
    if (subErr || !sub) return jsonError(`Submission not found: ${subErr?.message}`, 404)

    const submission = sub as unknown as Submission

    if (!submission.video_url) return jsonError('No video URL on this submission', 422)

    // ── 2. Fetch last 10 trainer overrides for this theme ─────────────────────
    //    score_overrides → roleplay_submissions(theme_id) filtered to same theme
    const { data: overrides } = await supabase
      .from('score_overrides')
      .select('override_score, trainer_notes, submission_id, roleplay_submissions!inner(theme_id)')
      .eq('roleplay_submissions.theme_id', submission.theme_id)
      .order('created_at', { ascending: false })
      .limit(10)

    const calibrationExamples: Override[] = (overrides ?? []).map((o: {
      override_score: number
      trainer_notes: string | null
    }) => ({
      override_score: o.override_score,
      trainer_notes:  o.trainer_notes,
    }))

    console.log(`[score-roleplay] calibration examples for theme ${submission.theme_id}: ${calibrationExamples.length}`)

    // ── 3. Build prompt ───────────────────────────────────────────────────────
    const prompt = buildPrompt(submission, calibrationExamples)

    // ── 4. Download video and upload to Gemini File API ───────────────────────
    const storagePath = extractStoragePath(submission.video_url, 'roleplay-videos')
    const { data: { publicUrl } } = supabase.storage
      .from('roleplay-videos')
      .getPublicUrl(storagePath)

    const videoResponse = await fetch(publicUrl)
    if (!videoResponse.ok) {
      throw new Error(`Failed to download video: ${videoResponse.status} ${videoResponse.statusText}`)
    }
    const videoBuffer = await videoResponse.arrayBuffer()
    const mimeType    = guessMimeType(storagePath)
    const fileUri     = await uploadToGeminiFileApi(videoBuffer, mimeType)

    // ── 5. Call Gemini ────────────────────────────────────────────────────────
    const model = genAI.getGenerativeModel({
      model:          'gemini-2.5-flash-lite',
      safetySettings: SAFETY,
    })

    const result = await model.generateContent([
      { text: prompt },
      {
        fileData: {
          mimeType,
          fileUri,
        },
      },
    ])

    const rawText = result.response.text().trim()

    // Strip any accidental markdown fences
    const jsonText = rawText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')

    let aiScore: Record<string, unknown>
    try {
      aiScore = JSON.parse(jsonText)
    } catch (_parseErr) {
      // Gemini returned plain text instead of JSON — check if it's describing an invalid video
      const lower = rawText.toLowerCase()
      const looksInvalid =
        lower.includes('invalid') ||
        lower.includes('not a valid') ||
        lower.includes('does not show') ||
        lower.includes('no customer')

      if (looksInvalid) {
        console.warn('[score-roleplay] Gemini returned plain-text invalid response:', rawText.slice(0, 300))
        await supabase.from('roleplay_submissions').update({
          status:   'ai_reviewed',
          ai_score: { invalid: true, reason: rawText.slice(0, 300) },
          ai_reviewed_at: new Date().toISOString(),
        }).eq('id', submission_id)
        return json({ success: true, invalid: true, reason: rawText.slice(0, 300) })
      }

      console.error('[score-roleplay] JSON parse failed. Raw Gemini text:', rawText.slice(0, 500))
      throw new Error(`Gemini returned non-JSON response: ${rawText.slice(0, 200)}`)
    }

    // Invalid submission detected by Gemini
    if (aiScore.invalid === true) {
      const reason = typeof aiScore.reason === 'string' ? aiScore.reason : 'Not a valid retail roleplay video'
      await supabase.from('roleplay_submissions').update({
        status:   'invalid',
        ai_score: { invalid: true, reason },
      }).eq('id', submission_id)
      return jsonError(`Invalid submission: ${reason}`, 422)
    }

    // Validate shape
    if (!Array.isArray(aiScore.breakdown) || aiScore.breakdown.length < 13) {
      throw new Error('Gemini returned unexpected shape — expected at least 13 breakdown items')
    }

    // Recompute totals server-side so arithmetic is always correct
    const requiredScore = aiScore.breakdown
      .filter((d: { is_bonus: boolean }) => !d.is_bonus)
      .reduce((sum: number, d: { score: number }) => sum + (d.score ?? 0), 0)
    const bonusScore = aiScore.breakdown
      .filter((d: { is_bonus: boolean }) => d.is_bonus)
      .reduce((sum: number, d: { score: number }) => sum + (d.score ?? 0), 0)

    aiScore.required_score = requiredScore
    aiScore.bonus_score    = bonusScore
    // Use active criteria max for overall — if scoring_criteria set, sum only those maxes
    const ALL_MAX: Record<string, number> = {
      'First Impression': 5, 'Customer Welcome': 3, 'Price Perception': 2,
      'Pet Details': 4, 'Product & Breed Knowledge': 1, 'Product Demonstration': 2,
      'Offers Communication': 1, 'Cross Sell / Upsell': 1, 'Query Handling': 1,
      'Product Suggestion': 1, 'Impulse Products': 1, 'Customer Data Capture': 1,
      'Bag Handover & Google Review': 1,
    }
    const activeCriteria = submission.theme?.scoring_criteria
    const activeMax = activeCriteria
      ? activeCriteria.reduce((s: number, d: string) => s + (ALL_MAX[d] ?? 0), 0)
      : 24
    aiScore.overall = Math.round((requiredScore / (activeMax || 24)) * 100)

    // ── 6. Persist score ──────────────────────────────────────────────────────
    const { error: updateErr } = await supabase
      .from('roleplay_submissions')
      .update({
        ai_score:        aiScore,
        ai_reviewed_at:  new Date().toISOString(),
        status:          'ai_reviewed',
      })
      .eq('id', submission_id)
    if (updateErr) throw updateErr

    return json({ success: true, score: aiScore })
  } catch (err) {
    console.error('score-roleplay error:', err)
    return jsonError((err as Error).message, 500)
  }
})

// ── Utils ─────────────────────────────────────────────────────────────────────

/**
 * Uploads a video buffer to the Gemini File API using multipart upload,
 * waits for it to finish processing, and returns the file URI.
 */
async function uploadToGeminiFileApi(
  buffer:   ArrayBuffer,
  mimeType: string,
): Promise<string> {
  const boundary = `gemini_${crypto.randomUUID().replace(/-/g, '')}`
  const encoder  = new TextEncoder()

  // Multipart body: JSON metadata part + binary video part
  const head = encoder.encode(
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=utf-8\r\n\r\n` +
    `${JSON.stringify({ file: { display_name: 'roleplay' } })}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: ${mimeType}\r\n\r\n`,
  )
  const tail = encoder.encode(`\r\n--${boundary}--`)

  const body = new Uint8Array(head.length + buffer.byteLength + tail.length)
  body.set(head)
  body.set(new Uint8Array(buffer), head.length)
  body.set(tail, head.length + buffer.byteLength)

  const res = await fetch(
    `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${GEMINI_API_KEY}`,
    {
      method:  'POST',
      headers: {
        'X-Goog-Upload-Protocol': 'multipart',
        'Content-Type':           `multipart/related; boundary=${boundary}`,
      },
      body,
    },
  )

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Gemini File API upload failed (${res.status}): ${text}`)
  }

  const data    = await res.json() as { file?: { uri?: string; name?: string } }
  const fileUri = data.file?.uri
  const name    = data.file?.name

  if (!fileUri || !name) throw new Error('Gemini File API did not return a file URI')

  // Video files are processed asynchronously — wait until ACTIVE before use
  await waitForGeminiFileActive(name)

  return fileUri
}

/**
 * Polls the Gemini File API until the uploaded file transitions
 * from PROCESSING → ACTIVE (or throws on FAILED / timeout).
 */
async function waitForGeminiFileActive(name: string): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const res  = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/${name}?key=${GEMINI_API_KEY}`,
    )
    const data = await res.json() as {
      state?: string
      error?: { message?: string }
    }

    if (data.state === 'ACTIVE') return
    if (data.state === 'FAILED') {
      throw new Error(`Gemini file processing failed: ${data.error?.message ?? 'unknown'}`)
    }
    // PROCESSING — back off 3 s and retry (max 60 s total)
    await new Promise((resolve) => setTimeout(resolve, 3_000))
  }
  throw new Error('Gemini file processing timed out after 60 s')
}

/**
 * Extracts the storage object path from any Supabase storage URL shape:
 *   - Public URL:  .../object/public/{bucket}/{path}
 *   - Signed URL:  .../object/sign/{bucket}/{path}?token=...
 *   - Raw path:    {path}  (returned as-is)
 */
function extractStoragePath(videoUrl: string, bucket: string): string {
  if (!videoUrl.startsWith('http')) return videoUrl  // already a raw path

  for (const segment of [`/object/public/${bucket}/`, `/object/sign/${bucket}/`]) {
    const idx = videoUrl.indexOf(segment)
    if (idx !== -1) {
      return decodeURIComponent(videoUrl.slice(idx + segment.length).split('?')[0])
    }
  }

  // Fallback: strip query string and return whatever is after the last known prefix
  return videoUrl.split('?')[0]
}

function guessMimeType(url: string): string {
  if (url.includes('.mp4'))  return 'video/mp4'
  if (url.includes('.mov'))  return 'video/quicktime'
  if (url.includes('.webm')) return 'video/webm'
  return 'video/mp4'
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type':                 'application/json',
      'Access-Control-Allow-Origin':  '*',
    },
  })
}

function jsonError(message: string, status: number) {
  return json({ error: message }, status)
}
