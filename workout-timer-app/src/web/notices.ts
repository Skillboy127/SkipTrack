// Web only. A tiny store for the short notices the web app shows on top of any
// screen (rendered by WebNotices in App.web.tsx), so shared screens don't need to
// know about them.

export type WebNotice = { id: number; message: string; durationMs: number };

let current: WebNotice | null = null;
let nextId = 1;
const listeners = new Set<() => void>();

export function showNotice(message: string, durationMs = 6000): void {
  current = { id: nextId++, message, durationMs };
  listeners.forEach(l => l());
}

export function dismissNotice(id?: number): void {
  if (!current || (id !== undefined && current.id !== id)) return;
  current = null;
  listeners.forEach(l => l());
}

export function getNotice(): WebNotice | null {
  return current;
}

export function subscribeNotices(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
