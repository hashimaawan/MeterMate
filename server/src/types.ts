/**
 * Shared domain types used across stores, services, and routes.
 * These are MeterMate's own types — independent of any SDK shape — so the
 * persistence and HTTP layers never depend on Maxio/Slack internals.
 */

export type TransactionType =
  | 'subscription'
  | 'usage'
  | 'plan-change'
  | 'lifecycle'
  | 'invoice';

export type TransactionState = 'started' | 'in_progress' | 'completed' | 'failed';

/**
 * A transaction record scoped to one consultant↔client pairing. Holds the
 * billing identifiers we read back from Maxio plus the Slack channel that
 * narrates this pairing (reused across subsequent actions).
 */
export interface TransactionRecord {
  txnId: string;
  consultantId: string;
  consultantName: string;
  clientEmail: string;
  clientName: string;
  type: TransactionType;
  state: TransactionState;
  /** Maxio subscription id once a subscription exists for this pairing. */
  subscriptionId: number | null;
  /** Maxio customer id once created/resolved. */
  customerId: number | null;
  /** Slack channel that narrates this pairing's transactions. */
  channelId: string | null;
  channelName: string | null;
  /** Whether the client was reachable as a Slack workspace member (tier-1). */
  clientNotifiedByEmailOnly: boolean;
  createdAt: number;
  updatedAt: number;
  lastError: string | null;
}

/** Per-session live state (current submission + last result). */
export interface SessionData {
  sessionId: string;
  lastTxnId: string | null;
  lastResult: unknown;
  createdAt: number;
  updatedAt: number;
}

/** Normalized result of the Slack `ensureTxnChannel` step. */
export interface EnsureChannelResult {
  channelId: string;
  channelName: string;
  created: boolean;
  consultantInvited: boolean;
  clientInvited: boolean;
  /** Human-readable notes (e.g. "client notified by email"). */
  notes: string[];
}

/** Discriminated status returned by every mutating route. */
export type RouteStatus = 'ok' | 'maxio_failed' | 'invalid' | 'session_expired';
