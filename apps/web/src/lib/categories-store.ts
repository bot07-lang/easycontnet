import { useSyncExternalStore } from 'react';

/**
 * Frontend-only category store (until a backend model exists). A project's
 * categories and each item's assignments live in localStorage, so they survive
 * reloads and are shared between the Categories page and the item editor. Swap
 * these getters/setters for API calls once the backend lands.
 */
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

// useSyncExternalStore (below) requires getSnapshot to return the SAME
// reference across calls until something actually changed — otherwise it
// looks like a change on every render, which React either warns about or,
// worse, spins on. localStorage has no such notion of identity (every read is
// a fresh JSON.parse), so this cache is what gives `read` that stability: it
// keeps returning the array it handed out last time until `write` replaces it.
const cache = new Map<string, string[]>();

function read(key: string): string[] {
  const cached = cache.get(key);
  if (cached) return cached;
  let value: string[];
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? '[]');
    value = Array.isArray(v) ? (v as string[]) : [];
  } catch {
    value = [];
  }
  cache.set(key, value);
  return value;
}
function write(key: string, value: string[]) {
  localStorage.setItem(key, JSON.stringify(value));
  cache.set(key, value);
  notify();
}

const projectKey = (projectId: string) => `cw:cats:${projectId}`;
const itemKey = (itemId: string) => `cw:item-cats:${itemId}`;

export const getProjectCategories = (projectId: string) => read(projectKey(projectId));
export const setProjectCategories = (projectId: string, cats: string[]) => write(projectKey(projectId), cats);
export const getItemCategories = (itemId: string) => read(itemKey(itemId));
export const setItemCategories = (itemId: string, cats: string[]) => write(itemKey(itemId), cats);

/** Reactive hook — re-renders when any category data changes. */
export function useCategories<T>(select: () => T): T {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; },
    select,
    select,
  );
}
