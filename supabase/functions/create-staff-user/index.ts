import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS })
  }

  try {
    const {
      name,
      phone,
      email,
      password,
      store_id,
      role,
      access_level,
      account_type,
      department,
      is_store_login,
    } = await req.json()

    // ── Validate required fields ──────────────────────────────────────────────
    if (!email || !password || !name) {
      return jsonError('name, email, and password are required', 400)
    }
    if (password.length < 8) {
      return jsonError('password must be at least 8 characters', 400)
    }

    // ── Create auth user ──────────────────────────────────────────────────────
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })
    if (authError) return jsonError(authError.message, 400)

    const userId = authData.user.id

    // ── Insert staff row using the auth user's UUID ───────────────────────────
    const staffRow: Record<string, unknown> = {
      id:             userId,
      name:           name.trim(),
      phone:          phone?.trim() || null,
      email:          email.trim().toLowerCase(),
      role:           role ?? 'staff',
      access_level:   access_level ?? 'single_store',
      account_type:   account_type || null,
      department:     department?.trim() || null,
      is_active:      true,
      is_store_login: is_store_login ?? false,
    }

    // Only include store_id when it's meaningful to avoid NOT NULL / FK errors
    if (store_id) {
      staffRow.store_id = store_id
    }

    const { data: staff, error: staffError } = await supabase
      .from('staff')
      .insert(staffRow)
      .select()
      .single()

    if (staffError) {
      // Auth user was created — roll back to avoid orphaned auth accounts
      await supabase.auth.admin.deleteUser(userId)
      return jsonError(staffError.message, 500)
    }

    return json({ staff }, 201)
  } catch (err) {
    console.error('create-staff-user error:', err)
    return jsonError((err as Error).message, 500)
  }
})

// ── Utils ─────────────────────────────────────────────────────────────────────

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

function jsonError(message: string, status: number) {
  return json({ error: message }, status)
}
