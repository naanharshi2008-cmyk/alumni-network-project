import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// True only when real credentials are present. Pages check this before
// querying so the app degrades to a friendly "connect Supabase" state
// instead of crashing when .env.local hasn't been filled in yet.
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

// Fall back to harmless placeholders so createClient never throws at import
// time. Any real request in an unconfigured app fails the same way it always
// would, but the UI never sees that because it guards on isSupabaseConfigured.
export const supabase = createClient(
  supabaseUrl ?? 'https://placeholder.supabase.co',
  supabaseAnonKey ?? 'placeholder-anon-key'
);
