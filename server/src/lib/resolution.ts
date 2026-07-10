/**
 * Pure decision logic for the report resolution lifecycle, extracted so it can
 * be unit-tested without a database. The endpoint (POST /api/reports/:id/resolve)
 * recounts votes inside a transaction and calls this to decide the next status.
 *
 * Rules (mirror the /verify consensus model):
 *   • RESOLVE_CONSENSUS (3) concurring 'fixed' votes  → 'resolved'
 *       (allowed from 'open' or 'in_progress')
 *   • PROGRESS_QUORUM (2) concurring 'working' votes   → 'in_progress'
 *       (allowed only from 'open')
 * A single actor can never resolve alone. Terminal/other statuses yield null.
 */
export const RESOLVE_CONSENSUS = 3;
export const PROGRESS_QUORUM = 2;

export type ResolvableStatus = 'open' | 'in_progress';

/**
 * Given the current report status and the distinct vote counts, return the new
 * status the report should transition to, or `null` if no transition applies.
 */
export function nextResolutionStatus(
  currentStatus: string,
  workingCount: number,
  fixedCount: number,
): 'resolved' | 'in_progress' | null {
  if (currentStatus !== 'open' && currentStatus !== 'in_progress') return null;

  if (fixedCount >= RESOLVE_CONSENSUS) {
    return 'resolved';
  }
  if (workingCount >= PROGRESS_QUORUM && currentStatus === 'open') {
    return 'in_progress';
  }
  return null;
}
