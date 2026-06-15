/**
 * UC5 — Invoice Issue + Send form (Admin only).
 *
 * Builds an ad-hoc invoice from one or more line items, optionally emails it,
 * and surfaces the issued invoice (amount due, due date, hosted Pay link).
 * Requires admin credentials (passed from the authenticated shell).
 */
import { useEffect, useMemo, useState } from 'react';
import { ApiError, postInvoice, type InvoiceResponse } from '../../api';
import type { AdminCredentials } from '../../adminAuth';
import type { TxnSummary } from '../../transactions';

interface InvoiceFormProps {
  transactions: TxnSummary[];
  creds: AdminCredentials;
}

interface LineItemRow {
  title: string;
  quantity: string;
  unitPrice: string;
}

const EMPTY_ROW: LineItemRow = { title: '', quantity: '1', unitPrice: '' };

export function InvoiceForm({ transactions, creds }: InvoiceFormProps) {
  const [txnRef, setTxnRef] = useState('');
  const [manualTxn, setManualTxn] = useState('');
  const [rows, setRows] = useState<LineItemRow[]>([{ ...EMPTY_ROW }]);
  const [memo, setMemo] = useState('');
  const [sendEmail, setSendEmail] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<InvoiceResponse | null>(null);
  const [transportError, setTransportError] = useState<string | null>(null);

  useEffect(() => {
    if (!txnRef && transactions.length > 0) setTxnRef(transactions[0]!.txnId);
  }, [transactions, txnRef]);

  const usingManual = transactions.length === 0 || txnRef === '__manual__';
  const effectiveTxnRef = usingManual ? manualTxn.trim() : txnRef;

  const total = useMemo(
    () =>
      rows.reduce((sum, r) => {
        const q = Number(r.quantity);
        const p = Number(r.unitPrice);
        return sum + (Number.isFinite(q) && Number.isFinite(p) ? q * p : 0);
      }, 0),
    [rows],
  );

  const fieldErrors = useMemo(() => {
    const map: Record<string, string> = {};
    if (result?.status === 'invalid') for (const e of result.errors) map[e.field] = e.message;
    return map;
  }, [result]);

  function updateRow(index: number, patch: Partial<LineItemRow>) {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }
  function addRow() {
    setRows((prev) => [...prev, { ...EMPTY_ROW }]);
  }
  function removeRow(index: number) {
    setRows((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev));
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setResult(null);
    setTransportError(null);
    try {
      const lineItems = rows.map((r) => ({
        title: r.title.trim(),
        quantity: Number(r.quantity),
        unitPrice: Number(r.unitPrice),
      }));
      const response = await postInvoice(
        { txnRef: effectiveTxnRef, lineItems, ...(memo.trim() ? { memo: memo.trim() } : {}), sendEmail },
        creds,
      );
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
      <h2>Issue Invoice</h2>
      <p className="subtitle">
        Create and issue an itemized invoice for a subscription, optionally
        emailing it to the client. A hosted payment link is returned.
      </p>

      {transactions.length === 0 && (
        <div className="banner banner-info">
          No bookings tracked in this session yet. Create one in the Client view
          first, or paste a transaction id below.
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

        <div className="field">
          <span>Line items</span>
          {rows.map((row, i) => (
            <div className="lineitem" key={i}>
              <input
                type="text"
                placeholder="Description"
                value={row.title}
                onChange={(e) => updateRow(i, { title: e.target.value })}
                disabled={submitting}
                required
              />
              <input
                type="number"
                min="0"
                step="any"
                placeholder="Qty"
                value={row.quantity}
                onChange={(e) => updateRow(i, { quantity: e.target.value })}
                disabled={submitting}
                required
              />
              <input
                type="number"
                min="0"
                step="any"
                placeholder="Unit price"
                value={row.unitPrice}
                onChange={(e) => updateRow(i, { unitPrice: e.target.value })}
                disabled={submitting}
                required
              />
              <button
                type="button"
                className="btn-icon"
                onClick={() => removeRow(i)}
                disabled={submitting || rows.length === 1}
                title="Remove line"
                aria-label="Remove line"
              >
                ✕
              </button>
            </div>
          ))}
          {(fieldErrors.lineItems ||
            Object.keys(fieldErrors).some((k) => k.startsWith('lineItems'))) && (
            <small className="err">
              {fieldErrors.lineItems ??
                fieldErrors[Object.keys(fieldErrors).find((k) => k.startsWith('lineItems'))!]}
            </small>
          )}
          <button type="button" className="btn-secondary" onClick={addRow} disabled={submitting}>
            + Add line item
          </button>
          <div className="lineitem-total">Estimated total: ${total.toFixed(2)}</div>
        </div>

        <label className="field">
          <span>Memo (optional)</span>
          <input
            type="text"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            placeholder="e.g. Thanks for your business"
            disabled={submitting}
          />
        </label>

        <label className="checkbox">
          <input
            type="checkbox"
            checked={sendEmail}
            onChange={(e) => setSendEmail(e.target.checked)}
            disabled={submitting}
          />
          <span>Email the invoice to the client</span>
        </label>

        <button type="submit" className="btn-primary" disabled={submitting || !effectiveTxnRef}>
          {submitting ? 'Issuing…' : 'Issue Invoice'}
        </button>
      </form>

      {transportError && <div className="banner banner-error">{transportError}</div>}

      {result && result.status !== 'ok' && <InvoiceFailure result={result} />}

      {ok && (
        <div className="banner banner-success">
          <h3>🧾 Invoice issued</h3>
          <dl className="facts">
            <div>
              <dt>Invoice</dt>
              <dd>#{ok.invoice.number}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>
                <code>{ok.invoice.status}</code>
              </dd>
            </div>
            <div>
              <dt>Amount due</dt>
              <dd>
                <strong>{ok.invoice.dueAmountFormatted}</strong>
              </dd>
            </div>
            <div>
              <dt>Due date</dt>
              <dd>{ok.invoice.dueDate ?? '—'}</dd>
            </div>
            <div>
              <dt>Emailed</dt>
              <dd>{ok.invoice.emailed ? 'Yes' : 'No'}</dd>
            </div>
          </dl>
          {ok.invoice.publicUrl && (
            <a className="btn-link" href={ok.invoice.publicUrl} target="_blank" rel="noreferrer">
              Pay Invoice ↗
            </a>
          )}
        </div>
      )}
    </section>
  );
}

function InvoiceFailure({
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
        <h3>⚠️ Invoice failed</h3>
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
