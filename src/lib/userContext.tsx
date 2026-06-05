import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { supabase } from './supabase'
import type { Staff } from '@/types'

type UserContextValue = {
  user: Staff | null
  loading: boolean
}

const UserContext = createContext<UserContextValue>({ user: null, loading: true })

export function UserProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Staff | null>(null)
  const [loading, setLoading] = useState(true)

  async function loadUser(userId: string) {
    const { data, error } = await supabase
      .from('staff')
      .select('*')
      .eq('id', userId)
      .single()
    if (!error && data) {
      let store = undefined
      if (data.store_id) {
        const { data: storeData } = await supabase
          .from('stores')
          .select('*')
          .eq('id', data.store_id)
          .single()
        store = storeData ?? undefined
      }
      setUser({ ...data, store } as Staff)
    } else {
      setUser(null)
    }
    setLoading(false)
  }

  useEffect(() => {
    // Hydrate from existing session on first load
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        loadUser(session.user.id)
      } else {
        setLoading(false)
      }
    })

    // Keep in sync with Supabase auth events (login / logout / token refresh)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        loadUser(session.user.id)
      } else {
        setUser(null)
        setLoading(false)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  return <UserContext.Provider value={{ user, loading }}>{children}</UserContext.Provider>
}

export function useUser() {
  return useContext(UserContext)
}
