import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from './supabase';

/**
 * Live presence + soft-lock + content sync for one content item (Level 2).
 *
 * On the channel `item:<id>`:
 *   - PRESENCE → "who's here" (viewer avatars) + disconnect cleanup.
 *   - BROADCAST 'lock' → the field lock, driven by TYPING (heartbeat while typing,
 *     throttled; receivers keep it while heartbeats arrive and EXPIRE it after a
 *     TTL — releases a few seconds after typing stops; robust vs flaky focus/blur).
 *   - BROADCAST 'field' → the field's content when it's SAVED. Since only one
 *     person edits a field at a time (the lock), everyone else updates their view
 *     to the latest saved value → consistent, no divergence, no reload needed.
 *
 * Nothing is persisted here — all in-memory, cleared on disconnect.
 */

export type Peer = { userId: string; name: string };
type LockMsg = { userId: string; name: string; fieldId: string | null };
type FieldMsg = { userId: string; fieldId: string; value: unknown };
type LockEntry = { userId: string; name: string; at: number };

const LOCK_TTL_MS = 4000; // a lock with no typing-heartbeat for this long releases

export function useItemPresence(
  itemId: string | undefined,
  me: { userId: string; name: string } | null,
  onRemoteField?: (fieldId: string, value: unknown) => void,
) {
  const [peers, setPeers] = useState<Peer[]>([]); // everyone EXCEPT me
  const [locks, setLocks] = useState<Record<string, LockEntry>>({}); // fieldId → owner
  const channelRef = useRef<RealtimeChannel | null>(null);
  // Latest callback, held in a ref so the channel effect doesn't re-subscribe.
  const onRemoteFieldRef = useRef(onRemoteField);
  onRemoteFieldRef.current = onRemoteField;

  useEffect(() => {
    if (!itemId || !me) return;
    const channel = supabase.channel(`item:${itemId}`, {
      config: { presence: { key: me.userId } },
    });
    channelRef.current = channel;

    const syncRoster = () => {
      const state = channel.presenceState<Peer>();
      const all: Peer[] = [];
      for (const key of Object.keys(state)) {
        const m = state[key]?.[0];
        if (m) all.push(m);
      }
      setPeers(all.filter((p) => p.userId !== me.userId));
      const present = new Set(all.map((p) => p.userId));
      setLocks((prev) => {
        const next: typeof prev = {};
        for (const fid of Object.keys(prev)) if (present.has(prev[fid]!.userId)) next[fid] = prev[fid]!;
        return next;
      });
    };

    const applyLock = (l: LockMsg) => {
      if (l.userId === me.userId) return; // ignore my own echo
      setLocks((prev) => {
        const next: typeof prev = {};
        for (const fid of Object.keys(prev)) if (prev[fid]!.userId !== l.userId) next[fid] = prev[fid]!;
        if (l.fieldId) next[l.fieldId] = { userId: l.userId, name: l.name, at: Date.now() };
        return next;
      });
    };

    channel
      .on('presence', { event: 'sync' }, syncRoster)
      .on('broadcast', { event: 'lock' }, ({ payload }) => applyLock(payload as LockMsg))
      .on('broadcast', { event: 'field' }, ({ payload }) => {
        const f = payload as FieldMsg;
        if (f.userId !== me.userId) onRemoteFieldRef.current?.(f.fieldId, f.value);
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') void channel.track({ userId: me.userId, name: me.name });
      });

    // Expire locks whose typing-heartbeat stopped (user stopped typing / left).
    const sweep = setInterval(() => {
      const cutoff = Date.now() - LOCK_TTL_MS;
      setLocks((prev) => {
        let changed = false;
        const next: typeof prev = {};
        for (const fid of Object.keys(prev)) {
          if (prev[fid]!.at >= cutoff) next[fid] = prev[fid]!;
          else changed = true;
        }
        return changed ? next : prev;
      });
    }, 1500);

    return () => {
      clearInterval(sweep);
      void channel.untrack();
      void supabase.removeChannel(channel);
      channelRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId, me?.userId, me?.name]);

  /** Broadcast a lock heartbeat for the field being typed in (null = release). */
  const heartbeatLock = useCallback((fieldId: string | null) => {
    if (channelRef.current && me) {
      void channelRef.current.send({ type: 'broadcast', event: 'lock', payload: { userId: me.userId, name: me.name, fieldId } });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.userId, me?.name]);

  /** Broadcast a field's saved content so collaborators update their view. */
  const broadcastField = useCallback((fieldId: string, value: unknown) => {
    if (channelRef.current && me) {
      void channelRef.current.send({ type: 'broadcast', event: 'field', payload: { userId: me.userId, fieldId, value } });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.userId]);

  const lockedByField = useMemo(() => {
    const m = new Map<string, string>();
    for (const fid of Object.keys(locks)) m.set(fid, locks[fid]!.name);
    return m;
  }, [locks]);

  return { peers, heartbeatLock, broadcastField, lockedByField };
}
