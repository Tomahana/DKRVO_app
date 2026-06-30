import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

function projectRefFromUrl(url: string | undefined): string | null {
  if (!url) return null
  try {
    return new URL(url).hostname.split('.')[0] ?? null
  } catch {
    return null
  }
}

function projectRefFromAnonKey(key: string | undefined): string | null {
  if (!key) return null
  try {
    const payload = key.split('.')[1]
    if (!payload) return null
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
    const decoded = atob(padded)
    const parsed = JSON.parse(decoded) as { ref?: string }
    return parsed.ref ?? null
  } catch {
    return null
  }
}

const envProjectRef = projectRefFromUrl(supabaseUrl)
const keyProjectRef = projectRefFromAnonKey(supabaseAnonKey)
const effectiveSupabaseUrl =
  keyProjectRef && (!envProjectRef || envProjectRef !== keyProjectRef)
    ? `https://${keyProjectRef}.supabase.co`
    : supabaseUrl

let initError: Error | null = null

export const supabase = (() => {
  if (!effectiveSupabaseUrl || !supabaseAnonKey) {
    initError = new Error(
      `Supabase není nakonfigurovaný — URL: "${effectiveSupabaseUrl ?? supabaseUrl ?? 'chybí'}", KEY: "${supabaseAnonKey ? 'OK' : 'chybí'}"`
    )
    return null
  }

  try {
    return createClient(effectiveSupabaseUrl, supabaseAnonKey)
  } catch (error) {
    initError = error instanceof Error ? error : new Error(String(error))
    return null
  }
})()

export const supabaseInitError = initError
