import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { DB } from './db.ts';
import { get, run, type Boundary } from './repo/base.ts';

export const SESSION_COOKIE = 'bos_session';
const SESSION_DAYS = 30;
/** The family lens re-locks itself after this long; it never stays open by accident. */
export const FAMILY_LENS_MINUTES = 60;

export interface AuthConfig {
  password: string;
  sessionSecret: string;
}

export class Auth {
  private salt = randomBytes(16);
  private passwordHash: Buffer;
  private attempts = new Map<string, { count: number; resetAt: number }>();
  db: DB;
  config: AuthConfig;

  constructor(db: DB, config: AuthConfig) {
    this.db = db;
    this.config = config;
    if (config.password.length < 8) throw new Error('BRAD_OS_PASSWORD must be at least 8 characters');
    if (config.sessionSecret.length < 16) throw new Error('SESSION_SECRET must be at least 16 characters');
    this.passwordHash = scryptSync(config.password, this.salt, 32);
  }

  checkPassword(candidate: string): boolean {
    const h = scryptSync(String(candidate ?? ''), this.salt, 32);
    return timingSafeEqual(h, this.passwordHash);
  }

  /** Simple fixed-window limiter: 8 attempts per 15 minutes per client. */
  rateLimited(key: string): boolean {
    const nowMs = Date.now();
    const a = this.attempts.get(key);
    if (!a || a.resetAt < nowMs) {
      this.attempts.set(key, { count: 1, resetAt: nowMs + 15 * 60_000 });
      return false;
    }
    a.count++;
    return a.count > 8;
  }

  clearAttempts(key: string) {
    this.attempts.delete(key);
  }

  private sign(id: string) {
    return createHmac('sha256', this.config.sessionSecret).update(id).digest('base64url');
  }

  createSession(): string {
    const id = randomBytes(24).toString('base64url');
    const expires = new Date(Date.now() + SESSION_DAYS * 86400_000).toISOString();
    run(this.db, 'INSERT INTO sessions (id, expires_at) VALUES (?, ?)', id, expires);
    run(this.db, 'DELETE FROM sessions WHERE expires_at < ?', new Date().toISOString());
    return `${id}.${this.sign(id)}`;
  }

  /** Returns the session with its *effective* lens (family lens auto-expires). */
  readSession(token: string | undefined): { id: string; lens: Boundary; lensUntil: string | null } | null {
    if (!token) return null;
    const [id, sig] = token.split('.');
    if (!id || !sig) return null;
    const expected = this.sign(id);
    if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    const s = get<{ id: string; lens: Boundary; lens_until: string | null; expires_at: string }>(
      this.db,
      'SELECT id, lens, lens_until, expires_at FROM sessions WHERE id = ?',
      id,
    );
    if (!s || s.expires_at < new Date().toISOString()) return null;
    if (s.lens === 'family' && (!s.lens_until || s.lens_until < new Date().toISOString())) {
      run(this.db, "UPDATE sessions SET lens = 'work', lens_until = NULL WHERE id = ?", id);
      return { id, lens: 'work', lensUntil: null };
    }
    return { id, lens: s.lens, lensUntil: s.lens_until };
  }

  setLens(sessionId: string, lens: Boundary) {
    const until = lens === 'family' ? new Date(Date.now() + FAMILY_LENS_MINUTES * 60_000).toISOString() : null;
    run(this.db, 'UPDATE sessions SET lens = ?, lens_until = ? WHERE id = ?', lens, until, sessionId);
    return until;
  }

  destroySession(sessionId: string) {
    run(this.db, 'DELETE FROM sessions WHERE id = ?', sessionId);
  }
}
