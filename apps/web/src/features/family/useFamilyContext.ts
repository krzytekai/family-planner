import { useEffect, useState } from 'react'
import type { FamilyContext } from '../../types/domain'
import { getSupabaseClient } from '../../lib/supabase'

export function useFamilyContext(userId: string) {
  const [family, setFamily] = useState<FamilyContext | null>(null)
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

    ;(async () => {
      const { data, error: queryError } = await supabase
        .from('family_members')
        .select('family_id, role, status, display_name, families(name)')
        .eq('user_id', userId)
        .eq('status', 'active')
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle()

      if (cancelled) return
      if (queryError) {
        setError(queryError.message)
      } else if (data) {
        const familyName = Array.isArray(data.families) ? data.families[0]?.name : (data.families as { name?: string } | null)?.name
        setFamily({
          familyId: data.family_id,
          familyName: familyName ?? 'Moja rodzina',
          userId,
          displayName: data.display_name,
          role: data.role,
          status: data.status,
        } as FamilyContext)
      }
      setLoading(false)
    })()

    return () => { cancelled = true }
  }, [userId])

  return { family, loading, error }
}
