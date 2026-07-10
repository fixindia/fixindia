/**
 * Tiny structured logger — no external dependency.
 *
 * - Respects LOG_LEVEL env (default "info").
 * - Emits one JSON object per line in production (NODE_ENV=production),
 *   pretty text otherwise (dev).
 * - Never logs secrets: redacts values whose key looks like a secret.
 * - Exposes a per-request id via `logger.withRequestId(id)`.
 */

type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

import { env } from '../config';

const configuredLevel = env.LOG_LEVEL as Level;
const MIN_LEVEL = LEVEL_ORDER[configuredLevel] ?? LEVEL_ORDER.info;
const IS_PROD = env.isProduction;

// Keys whose values must never be logged.
const SECRET_KEY_RE = /(api[_-]?key|secret|password|passwd|token|access[_-]?key|clerk[_-]?secret)/i;

function redactSecrets(obj: unknown): unknown {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(redactSecrets);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    out[k] = SECRET_KEY_RE.test(k) && v != null ? '[redacted]' : redactSecrets(v);
  }
  return out;
}

function format(level: Level, msg: string, meta?: Record<string, unknown>): string {
  const ts = new Date().toISOString();
  const cleanedMeta = meta ? (redactSecrets(meta) as Record<string, unknown>) : undefined;
  if (IS_PROD) {
    return JSON.stringify({ ts, level, msg, ...(cleanedMeta || {}) });
  }
  // Pretty (dev) — keep the emoji flair for local readability only.
  const emoji: Record<Level, string> = { debug: '•', info: '✓', warn: '⚠️', error: '❌' };
  const metaStr = cleanedMeta && Object.keys(cleanedMeta).length
    ? ' ' + JSON.stringify(cleanedMeta)
    : '';
  return `${emoji[level]} [${ts}] ${level.toUpperCase()} ${msg}${metaStr}`;
}

function emit(level: Level, msg: string, meta?: Record<string, unknown>): void {
  if (LEVEL_ORDER[level] < MIN_LEVEL) return;
  const line = format(level, msg, meta);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

interface Logger {
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
  /** Returns a child logger that stamps `requestId` into every meta. */
  withRequestId(requestId: string): Logger;
}

function withRequestId(base: Logger, requestId: string): Logger {
  return {
    debug: (m, meta) => base.debug(m, { ...meta, requestId }),
    info: (m, meta) => base.info(m, { ...meta, requestId }),
    warn: (m, meta) => base.warn(m, { ...meta, requestId }),
    error: (m, meta) => base.error(m, { ...meta, requestId }),
    withRequestId: (id) => withRequestId(base, id),
  };
}

export const logger: Logger = {
  debug: (m, meta) => emit('debug', m, meta),
  info: (m, meta) => emit('info', m, meta),
  warn: (m, meta) => emit('warn', m, meta),
  error: (m, meta) => emit('error', m, meta),
  withRequestId: (id) => withRequestId(logger, id),
};
