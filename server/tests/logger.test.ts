import { test, expect, describe, beforeEach, mock } from 'bun:test';
import { logger } from '../src/lib/logger';

describe('logger', () => {
  const logSpy = mock<(msg: unknown) => void>(() => {});
  const warnSpy = mock<(msg: unknown) => void>(() => {});
  const errSpy = mock<(msg: unknown) => void>(() => {});

  beforeEach(() => {
    console.log = logSpy as unknown as typeof console.log;
    console.warn = warnSpy as unknown as typeof console.warn;
    console.error = errSpy as unknown as typeof console.error;
    logSpy.mockClear();
    warnSpy.mockClear();
    errSpy.mockClear();
  });

  test('error level is emitted via console.error', () => {
    logger.error('boom');
    expect(errSpy).toHaveBeenCalledTimes(1);
    expect(String(errSpy.mock.calls[0][0])).toContain('boom');
    expect(String(errSpy.mock.calls[0][0])).toContain('ERROR');
  });

  test('warn level is emitted via console.warn', () => {
    logger.warn('careful');
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0][0])).toContain('careful');
  });

  test('redacts values whose key looks like a secret', () => {
    logger.info('test', { api_key: 'super-secret-value', normal: 'ok' });
    const line = String(logSpy.mock.calls[0][0]);
    expect(line).not.toContain('super-secret-value');
    expect(line).toContain('[redacted]');
    expect(line).toContain('ok');
  });

  test('withRequestId stamps requestId into every call', () => {
    const rl = logger.withRequestId('req-123');
    rl.error('with-id', { foo: 1 });
    const line = String(errSpy.mock.calls[0][0]);
    expect(line).toContain('req-123');
    expect(line).toContain('with-id');
  });
});
