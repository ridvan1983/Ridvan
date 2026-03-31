// ALDRIG importera denna fil i frontend-kod
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { requireServerEnv } from '~/lib/env.server'

let cachedSupabaseAdmin: SupabaseClient | null = null

function getSupabaseAdminClient() {
  if (cachedSupabaseAdmin) {
    return cachedSupabaseAdmin
  }

  const supabaseUrl = requireServerEnv('VITE_SUPABASE_URL', undefined, '[RIDVAN-E002] Missing server Supabase env var:')
  const serviceRoleKey = requireServerEnv('SUPABASE_SERVICE_ROLE_KEY', undefined, '[RIDVAN-E002] Missing server Supabase env var:')

  cachedSupabaseAdmin = createClient(supabaseUrl, serviceRoleKey)
  return cachedSupabaseAdmin
}

export const supabaseAdmin = new Proxy({} as SupabaseClient, {
  get(_target, prop, receiver) {
    return Reflect.get(getSupabaseAdminClient(), prop, receiver)
  },
})
