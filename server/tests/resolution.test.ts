import { test, expect, describe } from 'bun:test';
import {
  nextResolutionStatus,
  RESOLVE_CONSENSUS,
  PROGRESS_QUORUM,
} from '../src/lib/resolution';

describe('nextResolutionStatus', () => {
  test('constants match the documented thresholds', () => {
    expect(RESOLVE_CONSENSUS).toBe(3);
    expect(PROGRESS_QUORUM).toBe(2);
  });

  test('open → resolved once 3 concurring "fixed" votes exist', () => {
    expect(nextResolutionStatus('open', 0, 2)).toBeNull();
    expect(nextResolutionStatus('open', 0, 3)).toBe('resolved');
    expect(nextResolutionStatus('open', 5, 4)).toBe('resolved');
  });

  test('in_progress → resolved at consensus (fixed wins over working)', () => {
    expect(nextResolutionStatus('in_progress', 10, 3)).toBe('resolved');
    expect(nextResolutionStatus('in_progress', 10, 2)).toBeNull();
  });

  test('open → in_progress at 2 "working" votes, but not from in_progress', () => {
    expect(nextResolutionStatus('open', 1, 0)).toBeNull();
    expect(nextResolutionStatus('open', 2, 0)).toBe('in_progress');
    // Already in_progress: a working quorum does not re-transition.
    expect(nextResolutionStatus('in_progress', 5, 0)).toBeNull();
  });

  test('a single actor can never resolve alone', () => {
    // Even with a working quorum, one "fixed" vote is not enough.
    expect(nextResolutionStatus('open', 2, 1)).toBe('in_progress');
    expect(nextResolutionStatus('open', 0, 1)).toBeNull();
  });

  test('terminal / non-live statuses never transition', () => {
    for (const s of ['pending_verification', 'resolved', 'rejected', 'weird']) {
      expect(nextResolutionStatus(s, 9, 9)).toBeNull();
    }
  });
});
