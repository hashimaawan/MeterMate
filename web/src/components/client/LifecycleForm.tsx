/**
 * UC4 — Lifecycle Control form (Client/Admin).
 *
 * One form, four actions (pause / resume / cancel / reactivate). The cancel-type
 * selector and reason field appear only when the action is "cancel".
 */
import { useEffect, useMemo, useState } from 'react';
import {
  ApiError,
  postLifecycle,
  type CancelType,
  type LifecycleAction,
  type LifecycleResponse,
} from '../../api';
import type { TxnSummary } from '../../transactions';

interface LifecycleFormProps {
  transactions: TxnSummary[];
}

const ACTIONS: { value: LifecycleAction; label: string }[] = [
  { value: 'pause', label: 'Pause (place on hold)' },
  { value: 'resume', label: 'Resume (from hold)' },
  { value: 'cancel', label: 'Cancel' },
  { value: 'reactivate', label: 'Reactivate (canceled → active)' },
];

export function LifecycleForm({ transactions }: LifecycleFormProps) {
  const [txnRef, setTxnRef] = useState('');
  const [manualTxn, setManualTxn] = useState('');
  const [action, setAction] = useState<LifecycleAction>('pause');
  const [cancelType, setCancelType] = useState<CancelType>('immediate');
  const [reason, setReason] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<LifecycleResponse | null>(null);
  const [transportError, setTransportError] = useState<string | null>(null);

  useEffect(() => {
    if (!txnRef && transactions.length > 0) setTxnRef(transactions[0]!.txnId);
  }, [transactions, txnRef]);

  const usingManual = transactions.length === 0 || txnRef === '__manual__';
  const effectiveTxnRef = usingManual ? manualTxn.trim() : txnRef;
  const isCancel = action === 'cancel';

  const fieldErrors = useMemo(() => {
    const map: Record<string, string> = {};
    if (result?.status === 'invalid') for (const e of result.errors) map[e.field] = e.message;
    return map;
  }, [result]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setResult(null);
    setTransportError(null);
    try {
      const response = await postLifecycle({
        txnRef: effectiveTxnRef,
        action,
        ...(isCancel ? { cancelType } : {}),
        ...(reason.trim() ? { reasonCode: reason.trim() } : {}),
      });
      setResult(response);
    } catch (err) {
      setTransportError(err instanceof ApiError ? err.message : 'Unexpected error');
    } finally {
      setSubmitting(false);
    }
  }

  const ok = result?.status === 'ok' ? result : null;

  return (
    <section className="card">
      <h2>Lifecycle Control</h2>
      <p className="subtitle">
        Pause, resume, cancel, or reactivate a subscription. Cancellation can be
        immediate or scheduled for the end of the current period.
      </p>

      {transactions.length === 0 && (
        <div className="banner banner-info">
          No bookings tracked in this session yet. Create one in <strong>Book &amp;
          Subscribe</strong> first, or paste a transaction id below.
        </div>
      )}

      <form onSubmit={handleSubmit} className="form" noValidate>
        <label className="field">
          <span>Transaction</span>
          {transactions.length > 0 && (
            <select value={txnRef} onChange={(e) => setTxnRef(e.target.value)} disabled={submitting}>
              {transactions.map((t) => (
                <option key={t.txnId} value={t.txnId}>
                  {t.label}
                  {t.channelName ? ` — #${t.channelName}` : ''}
                </option>
              ))}
              <option value="__manual__">Enter a transaction id manually…</option>
            </select>
          )}
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
            <span>Action</span>
            <select
              value={action}
              onChange={(e) => setAction(e.target.value as LifecycleAction)}
              disabled={submitting}
            >
              {ACTIONS.map((a) => (
                <option key={a.value} value={a.value}>
                  {a.label}
                </option>
              ))}
            </select>
          </label>

          {isCancel && (
            <label className="field">
              <span>Cancel type</span>
              <select
                value={cancelType}
                onChange={(e) => setCancelType(e.target.value as CancelType)}
                disabled={submitting}
              >
                <option value="immediate">Immediate</option>
                <option value="end-of-period">At end of period</option>
              </select>
              {fieldErrors.cancelType && <small className="err">{fieldErrors.cancelType}</small>}
            </label>
          )}
        </div>

        {isCancel && (
          <label className="field">
            <span>Reason (optional)</span>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Client paused engagement"
              disabled={submitting}
            />
            {fieldErrors.reasonCode && <small className="err">{fieldErrors.reasonCode}</small>}
          </label>
        )}

        <button
          type="submit"
          className="btn-primary"
          disabled={submitting || !effectiveTxnRef}
        >
          {submitting ? 'Working…' : `Apply: ${action}`}
        </button>
      </form>

      {transportError && <div className="banner banner-error">{transportError}</div>}

      {result && result.status !== 'ok' && <LifecycleFailure result={result} />}

      {ok && (
        <div className="banner banner-success">
          <h3>🚦 Lifecycle updated</h3>
          <dl className="facts">
            <div>
              <dt>Transition</dt>
              <dd>
                <code>
                  {ok.lifecycle.previousState} → {ok.lifecycle.newState}
                  {ok.lifecycle.scheduled ? ' (scheduled)' : ''}
                </code>
              </dd>
            </div>
            <div>
              <dt>Effective</dt>
              <dd>
                {ok.lifecycle.effectiveDate
                  ? ok.lifecycle.effectiveDate.slice(0, 10)
                  : 'Immediately'}
              </dd>
            </div>
            {ok.lifecycle.reason && (
              <div>
                <dt>Reason</dt>
                <dd>{ok.lifecycle.reason}</dd>
              </div>
            )}
          </dl>
          <a className="btn-link" href={ok.lifecycle.manageUrl} target="_blank" rel="noreferrer">
            View in Maxio ↗
          </a>
        </div>
      )}
    </section>
  );
}

function LifecycleFailure({
  result,
}: {
  result:
    | { status: 'invalid'; errors: { field: string; message: string }[] }
    | { status: 'session_expired'; error: string }
    | { status: 'maxio_failed'; error: string; channelName?: string | null };
}) {
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
        <h3>⚠️ Lifecycle action failed</h3>
        <p>{result.error}</p>
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
