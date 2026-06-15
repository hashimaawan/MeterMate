/**
 * In-memory transaction store + the `(consultant,client) → channelId` reuse map
 * that powers the channel-per-transaction model: the first action for a pairing
 * creates the private channel; subsequent actions reuse it.
 *
 * DB-ready: callers only use the public surface below; the Maps are private.
 */
import { randomUUID } from 'node:crypto';
import { createLogger } from '../logger.js';
import type { TransactionRecord, TransactionType } from '../types.js';

const log = createLogger('transactionStore');

const transactions = new Map<string, TransactionRecord>();
/** Key: `${consultantId}::${clientEmailLower}` → txnId of the pairing record. */
const pairingIndex = new Map<string, string>();

function pairKey(consultantId: string, clientEmail: string): string {
  return `${consultantId}::${clientEmail.trim().toLowerCase()}`;
}

function now(): number {
  return Date.now();
}

export interface CreateTransactionInput {
  consultantId: string;
  consultantName: string;
  clientEmail: string;
  clientName: string;
  type: TransactionType;
}

export const transactionStore = {
  get(txnId: string): TransactionRecord | undefined {
    return transactions.get(txnId);
  },

  /** Find the existing pairing record (channel + ids) for a consultant↔client. */
  findByPair(consultantId: string, clientEmail: string): TransactionRecord | undefined {
    const txnId = pairingIndex.get(pairKey(consultantId, clientEmail));
    return txnId ? transactions.get(txnId) : undefined;
  },

  /**
   * Return the existing pairing record, or create a fresh one. The pairing
   * index guarantees one logical record (and thus one channel) per pair.
   */
  ensurePairing(input: CreateTransactionInput): TransactionRecord {
    const existing = this.findByPair(input.consultantId, input.clientEmail);
    if (existing) return existing;

    const record: TransactionRecord = {
      txnId: randomUUID(),
      consultantId: input.consultantId,
      consultantName: input.consultantName,
      clientEmail: input.clientEmail,
      clientName: input.clientName,
      type: input.type,
      state: 'started',
      subscriptionId: null,
      customerId: null,
      channelId: null,
      channelName: null,
      clientNotifiedByEmailOnly: false,
      createdAt: now(),
      updatedAt: now(),
      lastError: null,
    };
    transactions.set(record.txnId, record);
    pairingIndex.set(pairKey(input.consultantId, input.clientEmail), record.txnId);
    log.info('Created transaction record', { txnId: record.txnId, type: record.type });
    return record;
  },

  /** Apply a partial update and return the new record. */
  update(txnId: string, patch: Partial<TransactionRecord>): TransactionRecord {
    const existing = transactions.get(txnId);
    if (!existing) {
      throw new Error(`Transaction not found: ${txnId}`);
    }
    const next: TransactionRecord = { ...existing, ...patch, updatedAt: now() };
    transactions.set(txnId, next);
    return next;
  },

  list(): TransactionRecord[] {
    return [...transactions.values()].sort((a, b) => b.createdAt - a.createdAt);
  },

  size(): number {
    return transactions.size;
  },

  /** Test helper — clears all state. */
  _reset(): void {
    transactions.clear();
    pairingIndex.clear();
  },
};
