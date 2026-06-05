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
  staff:  { name: string } | null
  store:  { name: string } | null
  theme:  { title: string; brief_text: string } | null
}

type Override = {
  override_score: number
  trainer_notes:  string | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildPrompt(
  submission: Submission,
  overrides: Override[],
): string {
  const themeBrief = submission.theme?.brief_text ?? ''
  const themeTitle = submission.theme?.title     ?? 'Unknown Theme'
  const staffName  = submission.staff?.name      ?? 'Staff member'
  const storeName  = submission.store?.name      ?? 'Unknown store'

  const examplesBlock = overrides.length > 0
    ? `\n\n## Trainer-calibrated examples for this theme\nThese are scores that a human trainer has manually reviewed and corrected for this theme. Use them to calibrate your judgment:\n\n${
        overrides.map((o, i) =>
          `Example ${i + 1}: Trainer gave ${o.override_score}/100${o.trainer_notes ? ` — Notes: "${o.trainer_notes}"` : ''}`
        ).join('\n')
      }`
    : ''

  return `You are a retail training assessor for HUFT (Heads Up For Tails), a premium pet-care brand in India.

## Submission context
Staff: ${staffName}
Store: ${storeName}
Theme: ${themeTitle}

## Theme brief
${themeBrief}
${examplesBlock}

## Task
Watch the video submission carefully and evaluate the staff member's roleplay performance.

Score each of the following dimensions from 0–100:

1. **Product Knowledge** — Does the staff show accurate knowledge of products, ingredients, and use cases?
2. **Tone & Empathy** — Is the tone warm, patient, and customer-focused?
3. **Closing Technique** — Does the staff guide the customer toward a purchase or next step naturally?

Also produce an **Overall Score** (0–100) that reflects holistic performance.

## Output format
Respond with valid JSON only — no markdown fences, no extra text:

{
  "overall": <number>,
  "breakdown": [
    { "dimension": "Product Knowledge", "score": <number>, "feedback": "<one sentence>" },
    { "dimension": "Tone & Empathy",    "score": <number>, "feedback": "<one sentence>" },
    { "dimension": "Closing Technique", "score": <number>, "feedback": "<one sentence>" }
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
    const { submission_id } = await req.json() as { submission_id: string }
    if (!submission_id) return jsonError('submission_id is required', 400)

    // ── 1. Fetch submission ───────────────────────────────────────────────────
    const { data: sub, error: subErr } = await supabase
      .from('roleplay_submissions')
      .select('*, staff:staff!roleplay_submissions_staff_id_fkey(name), store:stores!roleplay_submissions_store_id_fkey(name), theme:themes!roleplay_submissions_theme_id_fkey(title, brief_text)')
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
    const aiScore  = JSON.parse(jsonText)

    // Basic validation
    if (typeof aiScore.overall !== 'number' || !Array.isArray(aiScore.breakdown)) {
      throw new Error('Gemini returned unexpected shape')
    }

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
