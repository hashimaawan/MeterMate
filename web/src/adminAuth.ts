/**
 * Admin credentials held in memory for the current page session (never
 * persisted). The placeholder admin uses HTTP Basic auth; this builds the
 * header the admin-guarded endpoints expect.
 */
export interface AdminCredentials {
  user: string;
  password: string;
}

export function basicAuthHeader(creds: AdminCredentials): string {
  return `Basic ${btoa(`${creds.user}:${creds.password}`)}`;
}
