/**
 * UC3 — Plan Change form (Client/Admin), preview → confirm two-step.
 *
 * Step 1: preview the prorated cost of moving to the target plan.
 * Step 2: confirm to apply it (prorate now, or schedule at the next renewal).
 *
 * Changing the transaction, target plan, or timing after previewing clears the
 * stale preview so the user always confirms what they previewed.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  ApiError,
  fetchProducts,
  postPlanChange,
  postPlanChangePreview,
  type PlanChangeResponse,
  type PlanChangeTiming,
  type PreviewResponse,
  type Product,
} from '../../api';
import type { TxnSummary } from '../../transactions';

interface PlanChangeFormProps {
  transactions: TxnSummary[];
}

export function PlanChangeForm({ transactions }: PlanChangeFormProps) {
  const [products, setProducts] = useState<Product[]>([]);
  const [loadingMeta, setLoadingMeta] = useState(true);
  const [metaError, setMetaError] = useState<string | null>(null);

  const [txnRef, setTxnRef] = useState('');
  const [manualTxn, setManualTxn] = useState('');
  const [targetHandle, setTargetHandle] = useState('');
  const [timing, setTiming] = useState<PlanChangeTiming>('prorate');

  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [applied, setApplied] = useState<PlanChangeResponse | null>(null);
  const [transportError, setTransportError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoadingMeta(true);
      setMetaError(null);
      try {
        const p = await fetchProducts();
        if (cancelled) return;
        setProducts(p);
        setTargetHandle((prev) => prev || p[0]?.handle || '');
      } catch (err) {
        if (!cancelled) setMetaError(err instanceof Error ? err.message : 'Failed to load plans');
      } finally {
        if (!cancelled) setLoadingMeta(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!txnRef && transactions.length > 0) setTxnRef(transactions[0]!.txnId);
  }, [transactions, txnRef]);

  const usingManual = transactions.length === 0 || txnRef === '__manual__';
  const effectiveTxnRef = usingManual ? manualTxn.trim() : txnRef;

  // Invalidate a stale preview whenever the inputs change.
  function resetPreview() {
    setPreview(null);
    setApplied(null);
  }

  const previewFieldErrors = useMemo(() => {
    const map: Record<string, string> = {};
    if (preview?.status === 'invalid') for (const e of preview.errors) map[e.field] = e.message;
    return map;
  }, [preview]);

  async function handlePreview(event: React.FormEvent) {
    event.preventDefault();
    setPreviewing(true);
    setPreview(null);
    setApplied(null);
    setTransportError(null);
    try {
      const response = await postPlanChangePreview({
        txnRef: effectiveTxnRef,
        targetHandle,
      });
      setPreview(response);
    } catch (err) {
      setTransportError(err instanceof ApiError ? err.message : 'Unexpected error');
    } finally {
      setPreviewing(false);
    }
  }

  async function handleConfirm() {
    setConfirming(true);
    setApplied(null);
    setTransportError(null);
    try {
      const response = await postPlanChange({ txnRef: effectiveTxnRef, targetHandle, timing });
      setApplied(response);
    } catch (err) {
      setTransportError(err instanceof ApiError ? err.message : 'Unexpected error');
    } finally {
      setConfirming(false);
    }
  }

  const previewOk = preview?.status === 'ok' ? preview : null;
  const appliedOk = applied?.status === 'ok' ? applied : null;

  return (
    <section className="card">
      <h2>Change Plan</h2>
      <p className="subtitle">
        Preview the prorated cost of moving to another plan, then confirm — now
        with proration, or scheduled for the next renewal.
      </p>

      {metaError && <div className="banner banner-error">{metaError}</div>}

      {transactions.length === 0 && (
        <div className="banner banner-info">
          No bookings tracked in this session yet. Create one in <strong>Book &amp;
          Subscribe</strong> first, or paste a transaction id below.
        </div>
      )}

      <form onSubmit={handlePreview} className="form" noValidate>
        <label className="field">
          <span>Transaction</span>
          {transactions.length > 0 && (
            <select
              value={txnRef}
              onChange={(e) => {
                setTxnRef(e.target.value);
                resetPreview();
              }}
              disabled={previewing || confirming}
            >
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
              onChange={(e) => {
                setManualTxn(e.target.value);
                resetPreview();
              }}
              placeholder="Transaction id (txnId)"
              disabled={previewing || confirming}
              required
            />
          )}
          {previewFieldErrors.txnRef && <small className="err">{previewFieldErrors.txnRef}</small>}
        </label>

        <div className="row">
          <label className="field">
            <span>Target plan</span>
            <select
              value={targetHandle}
              onChange={(e) => {
                setTargetHandle(e.target.value);
                resetPreview();
              }}
              disabled={previewing || confirming || loadingMeta}
              required
            >
              {products.length === 0 && <option value="">—</option>}
              {products.map((p) => (
                <option key={p.handle} value={p.handle}>
                  {p.name} — {p.priceFormatted}
                </option>
              ))}
            </select>
            {previewFieldErrors.targetHandle && (
              <small className="err">{previewFieldErrors.targetHandle}</small>
            )}
          </label>

          <label className="field">
            <span>Timing</span>
            <select
              value={timing}
              onChange={(e) => {
                setTiming(e.target.value as PlanChangeTiming);
                setApplied(null);
              }}
              disabled={previewing || confirming}
            >
              <option value="prorate">Prorate now</option>
              <option value="at-renewal">At next renewal (no proration)</option>
            </select>
          </label>
        </div>

        <button
          type="submit"
          className="btn-primary"
          disabled={previewing || confirming || loadingMeta || !effectiveTxnRef}
        >
          {previewing ? 'Previewing…' : 'Preview change'}
        </button>
      </form>

      {transportError && <div className="banner banner-error">{transportError}</div>}

      {preview && preview.status !== 'ok' && <FailureBanner result={preview} title="Preview" />}

      {previewOk && (
        <div className="banner banner-info">
          <h3>🔍 Plan change preview</h3>
          <dl className="facts">
            <div>
              <dt>From</dt>
              <dd>{previewOk.preview.currentPlanName}</dd>
            </div>
            <div>
              <dt>To</dt>
              <dd>{targetLabel(products, previewOk.preview.targetHandle)}</dd>
            </div>
            <div>
              <dt>Charge</dt>
              <dd>{previewOk.preview.chargeFormatted}</dd>
            </div>
            <div>
              <dt>Credit applied</dt>
              <dd>{previewOk.preview.creditAppliedFormatted}</dd>
            </div>
            <div>
              <dt>Payment due now</dt>
              <dd>
                <strong>{previewOk.preview.paymentDueFormatted}</strong>
              </dd>
            </div>
          </dl>
          <p className="muted">
            {timing === 'prorate'
              ? 'Confirming will change the plan immediately and charge the prorated amount above.'
              : 'You selected “at next renewal”: the change applies at the next renewal with no proration (the figures above are the prorate-now estimate).'}
          </p>
          <button type="button" className="btn-primary" onClick={handleConfirm} disabled={confirming}>
            {confirming
              ? 'Applying…'
              : timing === 'prorate'
                ? 'Confirm — change now'
                : 'Confirm — schedule at renewal'}
          </button>
        </div>
      )}

      {applied && applied.status !== 'ok' && <FailureBanner result={applied} title="Plan change" />}

      {appliedOk && (
        <div className="banner banner-success">
          <h3>🔄 Plan changed</h3>
          <dl className="facts">
            <div>
              <dt>From</dt>
              <dd>{appliedOk.planChange.oldPlanName}</dd>
            </div>
            <div>
              <dt>To</dt>
              <dd>{appliedOk.planChange.newPlanName}</dd>
            </div>
            <div>
              <dt>Proration</dt>
              <dd>{appliedOk.planChange.prorated ? 'Prorated now' : 'None (at renewal)'}</dd>
            </div>
            <div>
              <dt>Effective</dt>
              <dd>
                {appliedOk.planChange.effectiveDate
                  ? appliedOk.planChange.effectiveDate.slice(0, 10)
                  : 'Immediately'}
              </dd>
            </div>
          </dl>
          <a className="btn-link" href={appliedOk.planChange.manageUrl} target="_blank" rel="noreferrer">
            View in Maxio ↗
          </a>
        </div>
      )}
    </section>
  );
}

function targetLabel(products: Product[], handle: string): string {
  return products.find((p) => p.handle === handle)?.name ?? handle;
}

function FailureBanner({
  result,
  title,
}: {
  result:
    | { status: 'invalid'; errors: { field: string; message: string }[] }
    | { status: 'session_expired'; error: string }
    | { status: 'maxio_failed'; error: string; channelName?: string | null };
  title: string;
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
        <h3>⚠️ {title} failed</h3>
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
