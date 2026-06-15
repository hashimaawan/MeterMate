/**
 * App shell. The plan models two roles (Client / Admin). Client use cases are
 * selectable via a sub-nav; UC1 (Book) and UC2 (Usage) are wired here, sharing
 * the session's transaction list so usage can target a prior booking. Admin
 * forms arrive with their use cases (UC5/UC6).
 */
import { useCallback, useState } from 'react';
import { BookForm } from './components/client/BookForm';
import { UsageForm } from './components/client/UsageForm';
import { PlanChangeForm } from './components/client/PlanChangeForm';
import { LifecycleForm } from './components/client/LifecycleForm';
import { AdminLogin } from './components/admin/AdminLogin';
import { InvoiceForm } from './components/admin/InvoiceForm';
import { ActivityPanel } from './components/admin/ActivityPanel';
import type { TxnSummary } from './transactions';
import type { AdminCredentials } from './adminAuth';

type Role = 'client' | 'admin';
type ClientView = 'book' | 'usage' | 'plan' | 'lifecycle';
type AdminView = 'invoice' | 'activity';

export default function App() {
  const [role, setRole] = useState<Role>('client');
  const [clientView, setClientView] = useState<ClientView>('book');
  const [transactions, setTransactions] = useState<TxnSummary[]>([]);
  const [adminCreds, setAdminCreds] = useState<AdminCredentials | null>(null);
  const [adminView, setAdminView] = useState<AdminView>('invoice');

  const addTransaction = useCallback((txn: TxnSummary) => {
    setTransactions((prev) => {
      const withoutDup = prev.filter((t) => t.txnId !== txn.txnId);
      return [txn, ...withoutDup];
    });
  }, []);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo">📟</span>
          <div>
            <h1>MeterMate</h1>
            <p>Billing concierge — every transaction in its own Slack room</p>
          </div>
        </div>
        <nav className="roles" aria-label="Role">
          <button
            type="button"
            className={role === 'client' ? 'role active' : 'role'}
            onClick={() => setRole('client')}
          >
            Client
          </button>
          <button
            type="button"
            className={role === 'admin' ? 'role active' : 'role'}
            onClick={() => setRole('admin')}
          >
            Admin
          </button>
        </nav>
      </header>

      <main className="content">
        {role === 'client' && (
          <>
            <nav className="subnav" aria-label="Client actions">
              <button
                type="button"
                className={clientView === 'book' ? 'subnav-item active' : 'subnav-item'}
                onClick={() => setClientView('book')}
              >
                Book &amp; Subscribe
              </button>
              <button
                type="button"
                className={clientView === 'usage' ? 'subnav-item active' : 'subnav-item'}
                onClick={() => setClientView('usage')}
              >
                Report Usage
              </button>
              <button
                type="button"
                className={clientView === 'plan' ? 'subnav-item active' : 'subnav-item'}
                onClick={() => setClientView('plan')}
              >
                Change Plan
              </button>
              <button
                type="button"
                className={clientView === 'lifecycle' ? 'subnav-item active' : 'subnav-item'}
                onClick={() => setClientView('lifecycle')}
              >
                Lifecycle
              </button>
            </nav>

            {clientView === 'book' && <BookForm onBooked={addTransaction} />}
            {clientView === 'usage' && <UsageForm transactions={transactions} />}
            {clientView === 'plan' && <PlanChangeForm transactions={transactions} />}
            {clientView === 'lifecycle' && <LifecycleForm transactions={transactions} />}
          </>
        )}

        {role === 'admin' &&
          (adminCreds === null ? (
            <AdminLogin onAuthenticated={setAdminCreds} />
          ) : (
            <>
              <div className="admin-bar">
                <span>
                  Signed in as <strong>{adminCreds.user}</strong>
                </span>
                <button type="button" className="btn-secondary" onClick={() => setAdminCreds(null)}>
                  Sign out
                </button>
              </div>
              <nav className="subnav" aria-label="Admin actions">
                <button
                  type="button"
                  className={adminView === 'invoice' ? 'subnav-item active' : 'subnav-item'}
                  onClick={() => setAdminView('invoice')}
                >
                  Issue Invoice
                </button>
                <button
                  type="button"
                  className={adminView === 'activity' ? 'subnav-item active' : 'subnav-item'}
                  onClick={() => setAdminView('activity')}
                >
                  Activity Digest
                </button>
              </nav>
              {adminView === 'invoice' && <InvoiceForm transactions={transactions} creds={adminCreds} />}
              {adminView === 'activity' && <ActivityPanel creds={adminCreds} />}
            </>
          ))}
      </main>
    </div>
  );
}
