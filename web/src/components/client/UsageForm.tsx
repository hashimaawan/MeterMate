/**
 * UC2 — Report Session Usage form (Client/Admin).
 *
 * Records metered usage against an existing transaction's subscription. The
 * transaction is chosen from this session's bookings (or entered manually if
 * none are tracked yet). Renders the running period total on success.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  ApiError,
  fetchComponents,
  postUsage,
  type Component,
  type UsageResponse,
} from '../../api';
import type { TxnSummary } from '../../transactions';

interface UsageFormProps {
  transactions: TxnSummary[];
}

export function UsageForm({ transactions }: UsageFormProps) {
  const [components, setComponents] = useState<Component[]>([]);
  const [loadingMeta, setLoadingMeta] = useState(true);
  const [metaError, setMetaError] = useState<string | null>(null);

  const [txnRef, setTxnRef] = useState('');
  const [manualTxn, setManualTxn] = useState('');
  const [componentHandle, setComponentHandle] = useState('');
  const [quantity, setQuantity] = useState('30');
  const [memo, setMemo] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<UsageResponse | null>(null);
  const [transportError, setTransportError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoadingMeta(true);
      setMetaError(null);
      try {
        const c = await fetchComponents();
        if (cancelled) return;
        setComponents(c);
        setComponentHandle((prev) => prev || c[0]?.handle || '');
      } catch (err) {
        if (!cancelled) setMetaError(err instanceof Error ? err.message : 'Failed to load components');
      } finally {
        if (!cancelled) setLoadingMeta(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  // Default the transaction selection to the most recent booking.
  useEffect(() => {
    if (!txnRef && transactions.length > 0) {
      setTxnRef(transactions[0]!.txnId);
    }
  }, [transactions, txnRef]);

  const usingManual = transactions.length === 0 || txnRef === '__manual__';
  const effectiveTxnRef = usingManual ? manualTxn.trim() : txnRef;

  const fieldErrors = useMemo(() => {
    const map: Record<string, string> = {};
    if (result?.status === 'invalid') {
      for (const e of result.errors) map[e.field] = e.message;
    }
    return map;
  }, [result]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setResult(null);
    setTransportError(null);
    try {
      const response = await postUsage({
        txnRef: effectiveTxnRef,
        componentHandle,
        quantity: Number(quantity),
        ...(memo.trim() ? { memo: memo.trim() } : {}),
      });
      setResult(response);
    } catch (err) {
      setTransportError(err instanceof ApiError ? err.message : 'Unexpected error');
    } finally {
      setSubmitting(false);
    }
  }

  const selectedComponent = components.find((c) => c.handle === componentHandle);

  return (
    <section className="card">
      <h2>Report Session Usage</h2>
      <p className="subtitle">
        Record metered usage (e.g. consulting minutes) against an existing
        subscription. It accrues to the next invoice and posts to the transaction
        channel.
      </p>

      {metaError && <div className="banner banner-error">{metaError}</div>}

      {transactions.length === 0 && (
        <div className="banner banner-info">
          No bookings tracked in this session yet. Create one in <strong>Book &amp;
          Subscribe</strong> first, or paste a transaction id below.
        </div>
      )}

      <form onSubmit={handleSubmit} className="form" noValidate>
        <label className="field">
          <span>Transaction</span>
          {transactions.length > 0 ? (
            <select
              value={txnRef}
              onChange={(e) => setTxnRef(e.target.value)}
              disabled={submitting}
            >
              {transactions.map((t) => (
                <option key={t.txnId} value={t.txnId}>
                  {t.label}
                  {t.channelName ? ` — #${t.channelName}` : ''}
                </option>
              ))}
              <option value="__manual__">Enter a transaction id manually…</option>
            </select>
          ) : null}
          {usingManual && (
            <input
              type="text"
              value={manualTxn}
              onChange={(e) => setManualTxn(e.target.value)}
              placeholder="Transaction id (txnId)"
              disabled={submitting}
              required
            />
          )}
          {fieldErrors.txnRef && <small className="err">{fieldErrors.txnRef}</small>}
        </label>

        <div className="row">
          <label className="field">
            <span>Component</span>
            <select
              value={componentHandle}
              onChange={(e) => setComponentHandle(e.target.value)}
              disabled={submitting || loadingMeta}
              required
            >
              {components.length === 0 && <option value="">—</option>}
              {components.map((c) => (
                <option key={c.handle} value={c.handle}>
                  {c.name} — {c.priceFormatted}
                </option>
              ))}
            </select>
            {fieldErrors.componentHandle && (
              <small className="err">{fieldErrors.componentHandle}</small>
            )}
          </label>

          <label className="field">
            <span>Quantity{selectedComponent ? ` (${selectedComponent.unitName}s)` : ''}</span>
            <input
              type="number"
              min="0"
              step="any"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              disabled={submitting}
              required
            />
            {fieldErrors.quantity && <small className="err">{fieldErrors.quantity}</small>}
          </label>
        </div>

        <label className="field">
          <span>Memo (optional)</span>
          <input
            type="text"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            placeholder="e.g. Kickoff call"
            disabled={submitting}
          />
          {fieldErrors.memo && <small className="err">{fieldErrors.memo}</small>}
        </label>

        <button
          type="submit"
          className="btn-primary"
          disabled={submitting || loadingMeta || !effectiveTxnRef}
        >
          {submitting ? 'Recording…' : 'Record Usage'}
        </button>
      </form>

      {transportError && <div className="banner banner-error">{transportError}</div>}

      {result && <UsageResultPanel result={result} />}
    </section>
  );
}

function UsageResultPanel({ result }: { result: UsageResponse }) {
  if (result.status === 'ok') {
    const u = result.usage;
    return (
      <div className="banner banner-success">
        <h3>✅ Usage recorded</h3>
        <dl className="facts">
          <div>
            <dt>Component</dt>
            <dd>{u.componentName}</dd>
          </div>
          <div>
            <dt>Recorded</dt>
            <dd>
              {u.quantityRecorded} {u.unit}
              {u.quantityRecorded === 1 ? '' : 's'}
            </dd>
          </div>
          <div>
            <dt>Period total</dt>
            <dd>
              {u.periodTotal} {u.unit}
              {u.periodTotal === 1 ? '' : 's'}
            </dd>
          </div>
          <div>
            <dt>Billing</dt>
            <dd>Accrues to next invoice</dd>
          </div>
          <div>
            <dt>Slack channel</dt>
            <dd>{result.channelName ? `#${result.channelName}` : '—'}</dd>
          </div>
        </dl>
      </div>
    );
  }

  if (result.status === 'session_expired') {
    return (
      <div className="banner banner-error">
        <h3>⌛ Transaction not found</h3>
        <p>{result.error}</p>
      </div>
    );
  }

  if (result.status === 'maxio_failed') {
    return (
      <div className="banner banner-error">
        <h3>⚠️ Usage recording failed</h3>
        <p>{result.error}</p>
        {result.channelName && (
          <p className="muted">
            A failure note was posted to <strong>#{result.channelName}</strong>.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="banner banner-error">
      <h3>Please fix the highlighted fields</h3>
      <ul>
        {result.errors.map((e) => (
          <li key={e.field}>
            <strong>{e.field}</strong>: {e.message}
          </li>
        ))}
      </ul>
    </div>
  );
}
