// ALDRIG importera denna fil i frontend-kod
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.VITE_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('[RIDVAN-E002] Missing server Supabase env vars')
}

export const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey)
