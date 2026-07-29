import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, DEV_PASSWORD, DEV_USERS } from './supabase';

/** The current user's id + display name, for presence/collaboration. Null when
 *  signed out. Name resolves from the seeded users (a real profile later). */
export function useMe(): { userId: string; name: string } | null {
  const { session } = useSession();
  if (!session?.user) return null;
  const email = session.user.email;
  const name = DEV_USERS.find((u) => u.email === email)?.name ?? email ?? 'You';
  return { userId: session.user.id, name };
}

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
