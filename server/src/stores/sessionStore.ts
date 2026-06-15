/**
 * In-memory session store: holds the current submission + last result per
 * sessionId so multi-step flows (e.g. UC3 preview → confirm) survive without
 * re-sending everything. TTL-swept so idle sessions don't grow unbounded.
 *
 * DB-ready: the public surface (get/put/touch/delete/sweep) is all any caller
 * uses — swapping the Map for Redis/Postgres is a single-file change.
 */
import { config } from '../config.js';
import { createLogger } from '../logger.js';
import type { SessionData } from '../types.js';

const log = createLogger('sessionStore');

const TTL_MS = config.app.sessionTtlMinutes * 60 * 1000;
const SWEEP_INTERVAL_MS = 60 * 1000;

const sessions = new Map<string, SessionData>();

function now(): number {
  return Date.now();
}

export const sessionStore = {
  get(sessionId: string): SessionData | undefined {
    const session = sessions.get(sessionId);
    if (!session) return undefined;
    if (now() - session.updatedAt > TTL_MS) {
      sessions.delete(sessionId);
      return undefined;
    }
    return session;
  },

  /** Create the session if absent, otherwise return the existing one. */
  ensure(sessionId: string): SessionData {
    const existing = this.get(sessionId);
    if (existing) return existing;
    const created: SessionData = {
      sessionId,
      lastTxnId: null,
      lastResult: null,
      createdAt: now(),
      updatedAt: now(),
    };
    sessions.set(sessionId, created);
    return created;
  },

  put(session: SessionData): SessionData {
    const next = { ...session, updatedAt: now() };
    sessions.set(session.sessionId, next);
    return next;
  },

  /** Record the most recent transaction id + result for a session. */
  recordResult(sessionId: string, txnId: string, result: unknown): SessionData {
    const session = this.ensure(sessionId);
    return this.put({ ...session, lastTxnId: txnId, lastResult: result });
  },

  delete(sessionId: string): void {
    sessions.delete(sessionId);
  },

  /** Remove sessions idle longer than the TTL. Returns the count removed. */
  sweep(): number {
    const cutoff = now() - TTL_MS;
    let removed = 0;
    for (const [id, session] of sessions) {
      if (session.updatedAt < cutoff) {
        sessions.delete(id);
        removed += 1;
      }
    }
    if (removed > 0) log.debug('Swept idle sessions', { removed });
    return removed;
  },

  size(): number {
    return sessions.size;
  },

  /** Test helper — clears all state. */
  _reset(): void {
    sessions.clear();
  },
};

let sweepTimer: NodeJS.Timeout | null = null;

/** Start the periodic TTL sweep. Idempotent; unref'd so it never blocks exit. */
export function startSessionSweep(): void {
  if (sweepTimer) return;
  sweepTimer = setInterval(() => sessionStore.sweep(), SWEEP_INTERVAL_MS);
  sweepTimer.unref();
}

export function stopSessionSweep(): void {
  if (sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = null;
  }
}
