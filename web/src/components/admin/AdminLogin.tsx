/**
 * Admin login gate (placeholder auth). Validates the hardcoded operator
 * credentials against the guarded check endpoint, then hands them up to be held
 * in memory for admin requests. Not a real auth flow — a clean seam for later.
 */
import { useState } from 'react';
import { checkAdmin } from '../../api';
import type { AdminCredentials } from '../../adminAuth';

interface AdminLoginProps {
  onAuthenticated: (creds: AdminCredentials) => void;
}

export function AdminLogin({ onAuthenticated }: AdminLoginProps) {
  const [user, setUser] = useState('');
  const [password, setPassword] = useState('');
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setChecking(true);
    setError(null);
    const creds: AdminCredentials = { user: user.trim(), password };
    try {
      const ok = await checkAdmin(creds);
      if (ok) {
        onAuthenticated(creds);
      } else {
        setError('Invalid admin credentials.');
      }
    } catch {
      setError('Could not reach the server.');
    } finally {
      setChecking(false);
    }
  }

  return (
    <section className="card">
      <h2>Admin sign-in</h2>
      <p className="subtitle">
        Operator access for invoicing and the activity digest. (Placeholder auth —
        hardcoded credentials this phase.)
      </p>

      <form onSubmit={handleSubmit} className="form" noValidate>
        <label className="field">
          <span>Username</span>
          <input
            type="text"
            value={user}
            onChange={(e) => setUser(e.target.value)}
            autoComplete="username"
            disabled={checking}
            required
          />
        </label>
        <label className="field">
          <span>Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            disabled={checking}
            required
          />
        </label>
        <button type="submit" className="btn-primary" disabled={checking || !user || !password}>
          {checking ? 'Checking…' : 'Sign in'}
        </button>
      </form>

      {error && <div className="banner banner-error">{error}</div>}
    </section>
  );
}
