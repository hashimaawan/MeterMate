/**
 * App shell. The plan models two roles (Client / Admin) selectable here. UC1 is
 * a Client action, so the Client view is active. Admin forms arrive with their
 * use cases (UC5/UC6); the role switch is structured so they slot in cleanly.
 */
import { useState } from 'react';
import { BookForm } from './components/client/BookForm';

type Role = 'client' | 'admin';

export default function App() {
  const [role, setRole] = useState<Role>('client');

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
        {role === 'client' && <BookForm />}
      </main>
    </div>
  );
}
