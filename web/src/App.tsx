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
import type { TxnSummary } from './transactions';

type Role = 'client' | 'admin';
type ClientView = 'book' | 'usage' | 'plan' | 'lifecycle';

export default function App() {
  const [role, setRole] = useState<Role>('client');
  const [clientView, setClientView] = useState<ClientView>('book');
  const [transactions, setTransactions] = useState<TxnSummary[]>([]);

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
            disabled
            title="Admin tools arrive with UC5–UC6"
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
      </main>
    </div>
  );
}
