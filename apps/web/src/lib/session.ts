import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, DEV_PASSWORD } from './supabase';

/** Tracks the current Supabase session. */
export function useSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  return { session, loading };
}

/** Dev-only: sign a seeded user in. Replaced by a real login later. */
export async function signInAs(email: string) {
  const { error } = await supabase.auth.signInWithPassword({
    email,
    password: DEV_PASSWORD,
  });
  if (error) throw error;
}

export async function signOut() {
  await supabase.auth.signOut();
}
