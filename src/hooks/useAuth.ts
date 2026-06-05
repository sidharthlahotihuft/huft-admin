import { useState } from 'react'
import { supabase } from '@/lib/supabase'

type AuthState = {
  loading: boolean
  error: string | null
  accessDenied: boolean
}

export function useAuth(allowedRoles: readonly string[]) {
  const [state, setState] = useState<AuthState>({
    loading: false,
    error: null,
    accessDenied: false,
  })

  async function signIn(email: string, password: string): Promise<{ success: boolean }> {
    setState({ loading: true, error: null, accessDenied: false })

    const { data, error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      setState({ loading: false, error: error.message, accessDenied: false })
      return { success: false }
    }

    const { data: staff, error: staffError } = await supabase
      .from('staff')
      .select('*')
      .eq('id', data.user.id)
      .single()

    if (staffError || !staff) {
      // Don't signOut — just show error
      setState({ loading: false, error: 'No staff record found for this account.', accessDenied: false })
      return { success: false }
    }

    if (!allowedRoles.includes(staff.role)) {
      // Don't signOut — just show access denied
      setState({ loading: false, error: null, accessDenied: true })
      return { success: false }
    }

    setState({ loading: false, error: null, accessDenied: false })
    return { success: true }
  }

  return { ...state, signIn }
}
