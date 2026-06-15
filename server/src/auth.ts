/**
 * Placeholder admin auth. The lead confirmed hardcoded operator creds for this
 * phase (no signup/login). `adminGuard` protects admin-only routes (UC5/UC6).
 * This is a clean seam: swapping in OAuth/JWT later means replacing this file.
 *
 * Credentials are sent via HTTP Basic on admin routes. Comparison is
 * constant-time to avoid timing leaks.
 */
import { timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { config } from './config.js';
import { createLogger } from './logger.js';

const log = createLogger('auth');

function safeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function parseBasicAuth(header: string | undefined): { user: string; pass: string } | null {
  if (!header || !header.startsWith('Basic ')) return null;
  try {
    const decoded = Buffer.from(header.slice('Basic '.length), 'base64').toString('utf8');
    const idx = decoded.indexOf(':');
    if (idx < 0) return null;
    return { user: decoded.slice(0, idx), pass: decoded.slice(idx + 1) };
  } catch {
    return null;
  }
}

/** Express middleware: allow only requests carrying valid admin Basic auth. */
export function adminGuard(req: Request, res: Response, next: NextFunction): void {
  const creds = parseBasicAuth(req.header('authorization'));
  const ok =
    creds !== null &&
    safeEquals(creds.user, config.admin.user) &&
    safeEquals(creds.pass, config.admin.password);

  if (!ok) {
    log.warn('Admin route rejected', { path: req.path });
    res
      .status(401)
      .set('WWW-Authenticate', 'Basic realm="MeterMate Admin"')
      .json({ status: 'invalid', error: 'Admin authentication required' });
    return;
  }
  next();
}
