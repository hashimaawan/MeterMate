/**
 * Client-side sessionId handling. A stable id is generated once per browser and
 * persisted to localStorage, then sent with every mutating request so the
 * backend can correlate multi-step flows.
 */
const STORAGE_KEY = 'metermate.sessionId';

function generateId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `s-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function getSessionId(): string {
  let id = localStorage.getItem(STORAGE_KEY);
  if (!id) {
    id = generateId();
    localStorage.setItem(STORAGE_KEY, id);
  }
  return id;
}
