/**
 * UC1 — Book & Subscribe form (Client role).
 *
 * Loads the consultant + plan dropdowns from the backend, submits a booking,
 * and renders the discriminated result: success (subscription facts + the Slack
 * channel that was created/reused), validation errors, or a Maxio failure.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  ApiError,
  fetchConsultants,
  fetchProducts,
  postBook,
  type BookResponse,
  type CollectionMethod,
  type Consultant,
  type Product,
} from '../../api';
import type { TxnSummary } from '../../transactions';

interface BookFormProps {
  /** Called when a booking succeeds, so the session can track the new txn. */
  onBooked?: (txn: TxnSummary) => void;
}

interface FormState {
  firstName: string;
  lastName: string;
  email: string;
  consultantId: string;
  productHandle: string;
  collectionMethod: CollectionMethod;
  couponCode: string;
}

const EMPTY_FORM: FormState = {
  firstName: '',
  lastName: '',
  email: '',
  consultantId: '',
  productHandle: '',
  collectionMethod: 'remittance',
  couponCode: '',
};

export function BookForm({ onBooked }: BookFormProps) {
  const [consultants, setConsultants] = useState<Consultant[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loadingMeta, setLoadingMeta] = useState(true);
  const [metaError, setMetaError] = useState<string | null>(null);

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<BookResponse | null>(null);
  const [transportError, setTransportError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoadingMeta(true);
      setMetaError(null);
      try {
        const [c, p] = await Promise.all([fetchConsultants(), fetchProducts()]);
        if (cancelled) return;
        setConsultants(c);
        setProducts(p);
        // Preselect sensible defaults so the form is usable immediately.
        setForm((prev) => ({
          ...prev,
          consultantId: prev.consultantId || c[0]?.id || '',
          productHandle: prev.productHandle || p[0]?.handle || '',
        }));
      } catch (err) {
        if (!cancelled) {
          setMetaError(err instanceof Error ? err.message : 'Failed to load form data');
        }
      } finally {
        if (!cancelled) setLoadingMeta(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const fieldErrors = useMemo(() => {
    const map: Record<string, string> = {};
    if (result?.status === 'invalid') {
      for (const e of result.errors) map[e.field] = e.message;
    }
    return map;
  }, [result]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setResult(null);
    setTransportError(null);
    try {
      const response = await postBook({
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        email: form.email.trim(),
        consultantId: form.consultantId,
        productHandle: form.productHandle,
        collectionMethod: form.collectionMethod,
        ...(form.couponCode.trim() ? { couponCode: form.couponCode.trim() } : {}),
      });
      setResult(response);
      if (response.status === 'ok' && onBooked) {
        onBooked({
          txnId: response.txnId,
          label: `${response.subscription.customerName} · ${response.subscription.planName}`,
          channelName: response.channelName,
        });
      }
    } catch (err) {
      setTransportError(err instanceof ApiError ? err.message : 'Unexpected error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="card">
      <h2>Book &amp; Subscribe</h2>
      <p className="subtitle">
        Book a session with a consultant and enroll on a plan. A private Slack
        channel is created for the transaction.
      </p>

      {metaError && <div className="banner banner-error">{metaError}</div>}

      <form onSubmit={handleSubmit} className="form" noValidate>
        <div className="row">
          <label className="field">
            <span>First name</span>
            <input
              type="text"
              value={form.firstName}
              onChange={(e) => update('firstName', e.target.value)}
              required
              disabled={submitting}
            />
            {fieldErrors.firstName && <small className="err">{fieldErrors.firstName}</small>}
          </label>
          <label className="field">
            <span>Last name</span>
            <input
              type="text"
              value={form.lastName}
              onChange={(e) => update('lastName', e.target.value)}
              required
              disabled={submitting}
            />
            {fieldErrors.lastName && <small className="err">{fieldErrors.lastName}</small>}
          </label>
        </div>

        <label className="field">
          <span>Client email</span>
          <input
            type="email"
            value={form.email}
            onChange={(e) => update('email', e.target.value)}
            placeholder="client@example.com"
            required
            disabled={submitting}
          />
          {fieldErrors.email && <small className="err">{fieldErrors.email}</small>}
        </label>

        <div className="row">
          <label className="field">
            <span>Consultant</span>
            <select
              value={form.consultantId}
              onChange={(e) => update('consultantId', e.target.value)}
              disabled={submitting || loadingMeta}
              required
            >
              {consultants.length === 0 && <option value="">—</option>}
              {consultants.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            {fieldErrors.consultantId && <small className="err">{fieldErrors.consultantId}</small>}
          </label>

          <label className="field">
            <span>Plan</span>
            <select
              value={form.productHandle}
              onChange={(e) => update('productHandle', e.target.value)}
              disabled={submitting || loadingMeta}
              required
            >
              {products.length === 0 && <option value="">—</option>}
              {products.map((p) => (
                <option key={p.handle} value={p.handle}>
                  {p.name} — {p.priceFormatted}
                </option>
              ))}
            </select>
            {fieldErrors.productHandle && <small className="err">{fieldErrors.productHandle}</small>}
          </label>
        </div>

        <div className="row">
          <label className="field">
            <span>Payment collection</span>
            <select
              value={form.collectionMethod}
              onChange={(e) => update('collectionMethod', e.target.value as CollectionMethod)}
              disabled={submitting}
            >
              <option value="remittance">Remittance (invoice / pay later)</option>
              <option value="automatic">Automatic (requires card on file)</option>
            </select>
            {fieldErrors.collectionMethod && (
              <small className="err">{fieldErrors.collectionMethod}</small>
            )}
          </label>

          <label className="field">
            <span>Coupon code (optional)</span>
            <input
              type="text"
              value={form.couponCode}
              onChange={(e) => update('couponCode', e.target.value)}
              disabled={submitting}
            />
            {fieldErrors.couponCode && <small className="err">{fieldErrors.couponCode}</small>}
          </label>
        </div>

        <button type="submit" className="btn-primary" disabled={submitting || loadingMeta}>
          {submitting ? 'Booking…' : 'Book & Subscribe'}
        </button>
      </form>

      {transportError && <div className="banner banner-error">{transportError}</div>}

      {result && <ResultPanel result={result} />}
    </section>
  );
}

function ResultPanel({ result }: { result: BookResponse }) {
  if (result.status === 'ok') {
    const s = result.subscription;
    return (
      <div className="banner banner-success">
        <h3>🎉 Subscription active</h3>
        <dl className="facts">
          <div>
            <dt>Customer</dt>
            <dd>
              {s.customerName} ({s.customerEmail})
            </dd>
          </div>
          <div>
            <dt>Plan</dt>
            <dd>{s.planName}</dd>
          </div>
          <div>
            <dt>MRR</dt>
            <dd>{s.mrrFormatted} / month</dd>
          </div>
          <div>
            <dt>State</dt>
            <dd>
              <code>{s.state}</code>
            </dd>
          </div>
          <div>
            <dt>Next assessment</dt>
            <dd>{s.nextAssessmentAt ?? '—'}</dd>
          </div>
          <div>
            <dt>Slack channel</dt>
            <dd>{result.channelName ? `#${result.channelName}` : '— (not created)'}</dd>
          </div>
        </dl>
        <a className="btn-link" href={s.manageUrl} target="_blank" rel="noreferrer">
          View in Maxio ↗
        </a>
      </div>
    );
  }

  if (result.status === 'maxio_failed') {
    return (
      <div className="banner banner-error">
        <h3>⚠️ Booking failed</h3>
        <p>{result.error}</p>
        {result.channelName && (
          <p className="muted">
            A failure note was posted to <strong>#{result.channelName}</strong>.
          </p>
        )}
      </div>
    );
  }

  // invalid — field-level messages are already shown inline; summarize here too.
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
