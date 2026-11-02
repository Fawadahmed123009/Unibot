import "server-only";

/**
 * In-memory fixed-window rate limiter (per IP). Good enough for a single
 * server instance; restarts reset the counters, which is acceptable here.
 */
type Entry = { count: number; resetAt: number };

const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_ATTEMPTS = 10;

const hits = new Map<string, Entry>();

/**
 * Defaults (15 min / 10 attempts) keep the auth-route behavior exactly as
 * before; callers may pass their own limit and window (e.g. chat: 20/min).
 * Keys must therefore be namespaced per use case, which existing callers do.
 */
export function rateLimit(
  key: string,
  maxAttempts = MAX_ATTEMPTS,
  windowMs = WINDOW_MS,
): { ok: true } | { ok: false; retryAfterSeconds: number } {
  const now = Date.now();
  const entry = hits.get(key);

  if (!entry || entry.resetAt <= now) {
    hits.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true };
  }

  entry.count += 1;
  if (entry.count > maxAttempts) {
    return { ok: false, retryAfterSeconds: Math.ceil((entry.resetAt - now) / 1000) };
  }
  return { ok: true };
}
