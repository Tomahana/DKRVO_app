import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

let initError: Error | null = null

export const supabase = (() => {
  if (!supabaseUrl || !supabaseAnonKey) {
    initError = new Error(
      `Supabase není nakonfigurovaný — URL: "${supabaseUrl ?? 'chybí'}", KEY: "${supabaseAnonKey ? 'OK' : 'chybí'}"`
    )
    return null
  }

  try {
    return createClient(supabaseUrl, supabaseAnonKey)
  } catch (error) {
    initError = error instanceof Error ? error : new Error(String(error))
    return null
  }
})()

export const supabaseInitError = initError
