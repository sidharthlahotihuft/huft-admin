import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
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
  const initialSessionChecked = useRef(false)

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
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        loadUser(session.user.id)
      } else if (initialSessionChecked.current) {
        setUser(null)
        setLoading(false)
      }
    })

    supabase.auth.getSession().then(({ data: { session } }) => {
      initialSessionChecked.current = true
      if (session?.user) {
        loadUser(session.user.id)
      } else {
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
