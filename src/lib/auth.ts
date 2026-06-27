import { supabase } from './supabase'

export interface Profil {
  id: string
  email: string
  jmeno: string | null
  prijmeni: string | null
  role: 'admin' | 'prorektor' | 'prodekan' | 'spravce_obd'
  fakulta_kod: string | null
  aktivni: boolean
}

// Přihlášení email + heslo
export async function prihlasit(
  email: string,
  heslo: string
): Promise<{ chyba: string | null }> {
  if (!supabase) {
    return { chyba: 'Supabase není nakonfigurovaný (chybí VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY).' }
  }

  const { error } = await supabase.auth.signInWithPassword({ email, password: heslo })
  if (error) {
    if (error.message.includes('Invalid login')) {
      return { chyba: 'Nesprávný email nebo heslo.' }
    }
    return { chyba: error.message }
  }
  return { chyba: null }
}

// Odhlášení
export async function odhlasit(): Promise<void> {
  if (!supabase) return
  await supabase.auth.signOut()
}

// Načti profil přihlášeného uživatele
export async function nactiProfil(): Promise<Profil | null> {
  try {
    if (!supabase) return null

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null

    const { data, error } = await supabase
      .from('profily')
      .select('*')
      .eq('id', user.id)
      .single()

    if (error || !data) return null
    return data as Profil
  } catch {
    return null
  }
}

// Počet čekajících návrhů (pro odznak v navigaci)
export async function pocetCekajicichNavrhu(): Promise<number> {
  if (!supabase) return 0

  const { count } = await supabase
    .from('navrhy_zmen')
    .select('*', { count: 'exact', head: true })
    .eq('stav', 'ceka')
  return count ?? 0
}
