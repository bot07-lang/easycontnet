import { useSyncExternalStore } from 'react';

/**
 * Frontend-only category store (until a backend model exists). A project's
 * categories and each item's assignments live in localStorage, so they survive
 * reloads and are shared between the Categories page and the item editor. Swap
 * these getters/setters for API calls once the backend lands.
 */
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

function read(key: string): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? '[]');
    return Array.isArray(v) ? (v as string[]) : [];
  } catch {
    return [];
  }
}
function write(key: string, value: string[]) {
  localStorage.setItem(key, JSON.stringify(value));
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
