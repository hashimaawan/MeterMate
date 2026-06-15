/**
 * Lightweight client-side record of transactions created this session, so
 * downstream forms (e.g. Usage) can target an existing booking by its txnId
 * without the user copying ids around.
 */
export interface TxnSummary {
  txnId: string;
  /** Human label, e.g. "Mark Meter · Basic Plan". */
  label: string;
  channelName: string | null;
}
