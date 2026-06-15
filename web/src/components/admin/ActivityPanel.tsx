/**
 * UC6 — Billing Activity Digest (Admin only).
 *
 * Pick a consultant + window, generate a digest aggregated from live Maxio data
 * (scoped to that consultant's subscriptions tracked this session), and render
 * the figures with the reconciliation caveat.
 */
import { useEffect, useState } from 'react';
import {
  ApiError,
  fetchConsultants,
  postDigest,
  type Consultant,
  type DigestResponse,
} from '../../api';
import type { AdminCredentials } from '../../adminAuth';

interface ActivityPanelProps {
  creds: AdminCredentials;
}

const WINDOWS = [7, 30, 90];

export function ActivityPanel({ creds }: ActivityPanelProps) {
  const [consultants, setConsultants] = useState<Consultant[]>([]);
  const [loadingMeta, setLoadingMeta] = useState(true);
  const [metaError, setMetaError] = useState<string | null>(null);

  const [consultantId, setConsultantId] = useState('');
  const [windowDays, setWindowDays] = useState(30);

  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<DigestResponse | null>(null);
  const [transportError, setTransportError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoadingMeta(true);
      setMetaError(null);
      try {
        const c = await fetchConsultants();
        if (cancelled) return;
        setConsultants(c);
        setConsultantId((prev) => prev || c[0]?.id || '');
      } catch (err) {
        if (!cancelled) setMetaError(err instanceof Error ? err.message : 'Failed to load consultants');
      } finally {
        if (!cancelled) setLoadingMeta(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleGenerate(event: React.FormEvent) {
    event.preventDefault();
    setGenerating(true);
    setResult(null);
    setTransportError(null);
    try {
      const response = await postDigest({ consultantId, windowDays }, creds);
      setResult(response);
    } catch (err) {
      setTransportError(err instanceof ApiError ? err.message : 'Unexpected error');
    } finally {
      setGenerating(false);
    }
  }

  const ok = result?.status === 'ok' ? result : null;

  return (
    <section className="card">
      <h2>Billing Activity Digest</h2>
      <p className="subtitle">
        A per-consultant summary aggregated from live Maxio data, scoped to the
        subscriptions created in this session.
      </p>

      {metaError && <div className="banner banner-error">{metaError}</div>}

      <form onSubmit={handleGenerate} className="form" noValidate>
        <div className="row">
          <label className="field">
            <span>Consultant</span>
            <select
              value={consultantId}
              onChange={(e) => setConsultantId(e.target.value)}
              disabled={generating || loadingMeta}
              required
            >
              {consultants.length === 0 && <option value="">—</option>}
              {consultants.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Window</span>
            <select
              value={windowDays}
              onChange={(e) => setWindowDays(Number(e.target.value))}
              disabled={generating}
            >
              {WINDOWS.map((w) => (
                <option key={w} value={w}>
                  Last {w} days
                </option>
              ))}
            </select>
          </label>
        </div>

        <button type="submit" className="btn-primary" disabled={generating || loadingMeta || !consultantId}>
          {generating ? 'Generating…' : 'Generate digest'}
        </button>
      </form>

      {transportError && <div className="banner banner-error">{transportError}</div>}

      {result && result.status !== 'ok' && <DigestFailure result={result} />}

      {ok && (
        <div className="banner banner-info">
          <h3>📈 Billing digest — {ok.digest.consultantName}</h3>
          <p className="muted">Last {ok.digest.windowDays} days</p>
          <div className="metrics">
            <Metric label="Active subscriptions" value={String(ok.digest.activeCount)} />
            <Metric label="MRR" value={ok.digest.mrrFormatted} />
            <Metric label="New signups" value={String(ok.digest.newSignups)} />
            <Metric label="Churn" value={String(ok.digest.churn)} />
            <Metric label="Open invoices" value={String(ok.digest.openInvoices)} />
            <Metric label="Outstanding" value={ok.digest.outstandingFormatted} />
          </div>
          <p className="muted">
            {ok.digest.postedToChannel
              ? `Posted to Slack channel ${ok.digest.postedToChannel}.`
              : 'Not posted to Slack (no digest channel configured).'}
          </p>
          <p className="muted">{ok.digest.note}</p>
        </div>
      )}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span className="metric-value">{value}</span>
      <span className="metric-label">{label}</span>
    </div>
  );
}

function DigestFailure({
  result,
}: {
  result:
    | { status: 'invalid'; errors: { field: string; message: string }[] }
    | { status: 'maxio_failed'; error: string };
}) {
  if (result.status === 'maxio_failed') {
    return (
      <div className="banner banner-error">
        <h3>⚠️ Digest failed</h3>
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
