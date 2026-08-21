import { useEffect, useState } from 'react'
import type { FamilyContext } from '../../types/domain'
import { getSupabaseClient } from '../../lib/supabase'
import { activeFamilyStorageKey, chooseActiveFamily } from './family-context'

export function useFamilyContext(userId: string) {
  const [family, setFamily] = useState<FamilyContext | null>(null)
  const [families, setFamilies] = useState<FamilyContext[]>([])
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const supabase = getSupabaseClient()
    if (!supabase) {
      setError('Brak konfiguracji Supabase')
      setLoading(false)
      return
    }
    const client = supabase

    async function load() {
      const { data, error: queryError } = await client
        .from('family_members')
        .select('family_id, role, status, display_name, families(name)')
        .eq('user_id', userId)
        .eq('status', 'active')
        .order('created_at', { ascending: true })
      const { data: platformAdmin } = await client.rpc('is_platform_admin')

      if (cancelled) return
      if (queryError) {
        setError(queryError.message)
      } else {
        const memberships = (data ?? []).map((row) => {
          const familyName = Array.isArray(row.families) ? row.families[0]?.name : (row.families as { name?: string } | null)?.name
          return { familyId: row.family_id, familyName: familyName ?? 'Moja rodzina', userId, displayName: row.display_name, role: row.role, status: row.status } as FamilyContext
        })
        const stored = localStorage.getItem(activeFamilyStorageKey(userId))
        const selected = chooseActiveFamily(memberships, stored)
        setFamilies(memberships); setFamily(selected); setIsPlatformAdmin(platformAdmin === true)
        if (selected) localStorage.setItem(activeFamilyStorageKey(userId), selected.familyId)
      }
      setLoading(false)
    }
    void load()

    return () => { cancelled = true }
  }, [userId])

  function selectFamily(familyId: string) {
    const selected = families.find((item) => item.familyId === familyId)
    if (!selected) return
    localStorage.setItem(activeFamilyStorageKey(userId), selected.familyId)
    setFamily(selected)
  }

  return { family, families, selectFamily, isPlatformAdmin, loading, error }
}
