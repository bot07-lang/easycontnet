import { useEffect, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { DEV_USERS } from '../lib/supabase';
import { signInAs, signOut } from '../lib/session';
import { initials } from '../lib/avatar';

/**
 * Dev-only user switcher. Stands in for a login screen: pick a seeded user and
 * you are signed in as them, so every request carries a real token and RLS
 * applies. Switching users is how you exercise the permission model by hand.
 */
export function DevSwitcher({ session }: { session: Session | null }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const currentEmail = session?.user.email;
  const current = DEV_USERS.find((u) => u.email === currentEmail);

  const pick = async (email: string) => {
    setBusy(true);
    try {
      await signInAs(email);
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-md bg-white/10 px-3 py-1.5 text-sm text-white
                   transition hover:bg-white/20"
      >
        <span className="grid h-6 w-6 place-items-center rounded-full bg-white/25 text-[11px] font-semibold">
          {current ? initials(current.name) : '?'}
        </span>
        <span>{current ? `${current.name}` : 'Choose a user'}</span>
        <span className="text-[9px] opacity-70">▾</span>
      </button>

      {open && (
        <div className="absolute right-0 top-10 z-40 w-72 overflow-hidden rounded-lg border
                        border-slate-200 bg-white shadow-xl">
          <p className="border-b border-slate-100 px-4 py-2 text-[11px] font-semibold
                        uppercase tracking-wide text-slate-400">
            Act as (dev only)
          </p>
          {DEV_USERS.map((u) => (
            <button
              key={u.email}
              type="button"
              disabled={busy}
              onClick={() => pick(u.email)}
              className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition
                          hover:bg-slate-50 disabled:opacity-50 ${
                            u.email === currentEmail ? 'bg-blue-50' : ''
                          }`}
            >
              <span className="grid h-8 w-8 place-items-center rounded-full bg-slate-200 text-[11px] font-semibold text-slate-700">
                {initials(u.name)}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[14px] font-medium text-slate-800">{u.name}</span>
                <span className="block truncate text-[12px] text-slate-500">{u.role} · {u.org}</span>
              </span>
              {u.email === currentEmail && <span className="ml-auto text-blue-600">✓</span>}
            </button>
          ))}
          {session && (
            <button
              type="button"
              onClick={() => { void signOut(); setOpen(false); }}
              className="w-full border-t border-slate-100 px-4 py-2.5 text-left text-[13px]
                         text-slate-500 hover:bg-slate-50"
            >
              Sign out
            </button>
          )}
        </div>
      )}
    </div>
  );
}
