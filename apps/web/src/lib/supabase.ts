import { createClient } from '@supabase/supabase-js';

/**
 * Browser Supabase client — used ONLY for auth (signing a seeded user in to
 * get a token). All data goes through our API, never straight to Supabase.
 */
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
  { auth: { persistSession: true, autoRefreshToken: true } },
);

/**
 * The seeded development users. Auth is not an MVP focus, so instead of a login
 * screen we sign one of these in on demand — the "dev switcher". Real accounts
 * and a login page replace this later; nothing else changes.
 */
export const DEV_USERS = [
  { email: 'priya@seed.local', name: 'Priya Sharma', role: 'Admin (owner)', org: 'Brightrays' },
  { email: 'ishita@seed.local', name: 'Ishita Rao', role: 'Editor', org: 'Brightrays' },
  { email: 'abuzar@seed.local', name: 'Abuzar Qureshi', role: 'Writer', org: 'Brightrays' },
  { email: 'rahul@seed.local', name: 'Rahul Menon', role: 'Admin (owner)', org: 'Acme' },
] as const;

export const DEV_PASSWORD = 'dev-password-not-secret';
