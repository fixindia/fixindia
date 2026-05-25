/* eslint-disable @typescript-eslint/no-explicit-any */
import sql from './db';
import { sanitizeInput, sanitizeTitle } from './security';

interface VolunteerSubmission {
  type: 'report' | 'news' | 'mla';
  data: any;
  submittedBy: string;
  submitterEmail?: string;
}

// Valid submission types (whitelist)
const VALID_TYPES = ['report', 'news', 'mla'];

// Max submissions per user per hour (anti-spam)
const MAX_SUBMISSIONS_PER_HOUR = 10;
const submissionTracker = new Map<string, { count: number; resetAt: number }>();

/**
 * Submit data for verification.
 * Rate-limited per user to prevent flooding.
 */
export async function submitVolunteerData(submission: VolunteerSubmission) {
  const { type, data, submittedBy, submitterEmail } = submission;

  // Validate type
  if (!VALID_TYPES.includes(type)) {
    throw new Error(`Invalid submission type: ${type}`);
  }

  // Validate submittedBy is present
  if (!submittedBy || typeof submittedBy !== 'string' || submittedBy.length < 1) {
    throw new Error('Submitter ID is required');
  }

  // Per-user submission rate limiting
  const now = Date.now();
  const tracker = submissionTracker.get(submittedBy);
  if (tracker && now < tracker.resetAt) {
    if (tracker.count >= MAX_SUBMISSIONS_PER_HOUR) {
      throw new Error('Too many submissions. Please wait before submitting again.');
    }
    tracker.count++;
  } else {
    submissionTracker.set(submittedBy, { count: 1, resetAt: now + 60 * 60 * 1000 });
  }

  // Sanitize the data fields before storing
  const sanitizedData = sanitizeSubmissionData(type, data);

  // Insert into pending_verifications table
  const [pending] = await sql`
    INSERT INTO pending_verifications (
      data_type,
      raw_data,
      submitted_by,
      submitter_email,
      status
    )
    VALUES (
      ${type},
      ${JSON.stringify(sanitizedData)},
      ${submittedBy},
      ${submitterEmail || null},
      'pending'
    )
    RETURNING id, created_at
  `;

  return pending;
}

/**
 * Sanitize submission data based on type before storage.
 */
function sanitizeSubmissionData(type: string, data: any): any {
  if (!data || typeof data !== 'object') return {};

  if (type === 'report') {
    return {
      title: sanitizeTitle(String(data.title || '')),
      category: sanitizeInput(String(data.category || ''), 50),
      latitude: typeof data.latitude === 'number' ? data.latitude : null,
      longitude: typeof data.longitude === 'number' ? data.longitude : null,
      severity: ['low', 'medium', 'high', 'critical'].includes(data.severity) ? data.severity : 'medium',
      ward_name: sanitizeInput(String(data.ward_name || ''), 100),
      mla_name: sanitizeInput(String(data.mla_name || ''), 100),
      source_url: typeof data.source_url === 'string' ? data.source_url.slice(0, 500) : null,
    };
  }

  if (type === 'news') {
    return {
      headline: sanitizeTitle(String(data.headline || '')),
      url: typeof data.url === 'string' ? data.url.slice(0, 500) : '',
      source: sanitizeInput(String(data.source || ''), 100),
      snippet: sanitizeInput(String(data.snippet || ''), 500),
      latitude: typeof data.latitude === 'number' ? data.latitude : null,
      longitude: typeof data.longitude === 'number' ? data.longitude : null,
      city: sanitizeInput(String(data.city || ''), 50),
    };
  }

  if (type === 'mla') {
    return {
      id: typeof data.id === 'number' ? data.id : null,
      name: sanitizeInput(String(data.name || ''), 100),
      party: sanitizeInput(String(data.party || ''), 100),
      constituency: sanitizeInput(String(data.constituency || ''), 100),
      city: sanitizeInput(String(data.city || ''), 50),
      state: sanitizeInput(String(data.state || ''), 50),
      contact: sanitizeInput(String(data.contact || ''), 50),
      email: typeof data.email === 'string' ? data.email.slice(0, 100) : null,
      latitude: typeof data.latitude === 'number' ? data.latitude : null,
      longitude: typeof data.longitude === 'number' ? data.longitude : null,
    };
  }

  return {};
}

/**
 * Get pending submissions for verification.
 * Strips PII fields (submitter_email) from the response.
 */
export async function getPendingSubmissions(limit: number = 50) {
  const pending = await sql`
    SELECT
      id, data_type, raw_data, submitted_by,
      verification_count, required_verifications, created_at
    FROM pending_verifications
    WHERE status = 'pending'
    ORDER BY created_at ASC
    LIMIT ${limit}
  `;

  // Strip submitter_email from response (PII protection)
  return pending;
}

/**
 * Verify a submission.
 *
 * SECURITY: The `authenticatedUserId` MUST come from the verified JWT,
 * NOT from the request body. This prevents Sybil attacks where an attacker
 * could fabricate multiple verifier IDs.
 *
 * The legacy `verifierId` from the body is still accepted but is overridden
 * by `authenticatedUserId` when provided to ensure integrity.
 */
export async function verifySubmission(
  submissionId: string,
  verifierId: string,
  approved: boolean,
  notes?: string,
  authenticatedUserId?: string
) {
  // Use authenticated user ID when available (prevents Sybil attacks)
  const effectiveVerifierId = authenticatedUserId || verifierId;

  if (!effectiveVerifierId || effectiveVerifierId.length < 1) {
    throw new Error('Verifier ID is required');
  }

  // Validate UUID format for submission ID
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(submissionId)) {
    throw new Error('Invalid submission ID format');
  }

  // Fetch submission details first to check for self-voting
  const [submission] = await sql`
    SELECT
      id, data_type, raw_data, submitted_by, verification_count, required_verifications
    FROM pending_verifications
    WHERE id = ${submissionId}
  `;

  if (!submission) {
    throw new Error('Submission not found');
  }

  // Prevent self-verification
  if (submission.submitted_by === effectiveVerifierId) {
    throw new Error('Cannot verify your own submission');
  }

  // Check if already verified by this user (DB unique constraint also prevents this)
  const [existingVote] = await sql`
    SELECT id FROM volunteer_verifications
    WHERE submission_id = ${submissionId} AND verifier_id = ${effectiveVerifierId}
  `;
  if (existingVote) {
    throw new Error('You have already verified this submission');
  }

  // Per-user verification rate limiting (max 20 verifications per hour)
  const recentVerifications = await sql`
    SELECT COUNT(*) as cnt FROM volunteer_verifications
    WHERE verifier_id = ${effectiveVerifierId}
    AND created_at > NOW() - INTERVAL '1 hour'
  `;
  if (Number(recentVerifications[0]?.cnt || 0) >= 20) {
    throw new Error('Verification rate limit reached. Please try again later.');
  }

  // Sanitize notes
  const sanitizedNotes = notes ? sanitizeInput(notes, 500) : null;

  // Record verification
  await sql`
    INSERT INTO volunteer_verifications (submission_id, verifier_id, approved, notes)
    VALUES (${submissionId}, ${effectiveVerifierId}, ${approved}, ${sanitizedNotes})
  `;

  // Update verification count
  await sql`
    UPDATE pending_verifications
    SET verification_count = verification_count + 1
    WHERE id = ${submissionId}
  `;

  // Increment verifier's reports_verified count (+20 points)
  try {
    await sql`
      UPDATE users
      SET reports_verified = reports_verified + 1
      WHERE clerk_id = ${effectiveVerifierId} OR id::text = ${effectiveVerifierId}
    `;
  } catch (err) {
    console.error('Failed to update verifier stats:', err);
  }

  const [updatedSubmission] = await sql`
    SELECT
      id, data_type, raw_data, submitted_by, verification_count, required_verifications
    FROM pending_verifications
    WHERE id = ${submissionId}
  `;

  if (updatedSubmission.verification_count >= updatedSubmission.required_verifications) {
    // Check approval ratio
    const verifications = await sql`
      SELECT COUNT(*) as total, SUM(CASE WHEN approved THEN 1 ELSE 0 END) as approved
      FROM volunteer_verifications
      WHERE submission_id = ${submissionId}
    `;

    const approvalRatio = Number(verifications[0].approved) / Number(verifications[0].total);

    if (approvalRatio >= 0.67) { // 2 out of 3 approved
      // Auto-publish
      await publishVerifiedData(updatedSubmission);

      await sql`
        UPDATE pending_verifications
        SET status = 'approved', updated_at = NOW()
        WHERE id = ${submissionId}
      `;

      // Increment submitter's integrations_helped count (+50 points)
      if (updatedSubmission.submitted_by) {
        try {
          await sql`
            UPDATE users
            SET integrations_helped = integrations_helped + 1
            WHERE clerk_id = ${updatedSubmission.submitted_by} OR id::text = ${updatedSubmission.submitted_by}
          `;
        } catch (err) {
          console.error('Failed to update submitter stats:', err);
        }
      }

      return { status: 'approved', published: true };
    } else {
      await sql`
        UPDATE pending_verifications
        SET status = 'rejected', updated_at = NOW()
        WHERE id = ${submissionId}
      `;

      return { status: 'rejected', published: false };
    }
  }

  return { status: 'pending', published: false };
}

/**
 * Publish verified data to main tables.
 * Data has already been sanitized at submission time.
 */
async function publishVerifiedData(submission: any) {
  const data = typeof submission.raw_data === 'string'
    ? JSON.parse(submission.raw_data)
    : submission.raw_data;

  if (submission.data_type === 'report') {
    await sql`
      INSERT INTO reports (
        title, category, location, severity, ward_name, mla_name, creator_id, source_url
      )
      VALUES (
        ${data.title},
        ${data.category},
        ST_SetSRID(ST_MakePoint(${data.longitude}, ${data.latitude}), 4326)::geography,
        ${data.severity || 'medium'},
        ${data.ward_name || 'Unknown'},
        ${data.mla_name || 'TBD'},
        'volunteer-verified',
        ${data.source_url || null}
      )
    `;
  } else if (submission.data_type === 'news') {
    await sql`
      INSERT INTO local_news (
        headline, url, source, snippet, location, city, confidence_score
      )
      VALUES (
        ${data.headline},
        ${data.url},
        ${data.source},
        ${data.snippet || ''},
        ST_SetSRID(ST_MakePoint(${data.longitude}, ${data.latitude}), 4326)::geography,
        ${data.city},
        100
      )
    `;
  } else if (submission.data_type === 'mla') {
    await sql`
      INSERT INTO mlas (name, party, constituency, city, state, contact, email, is_incorrect, latitude, longitude)
      VALUES (
        ${data.name},
        ${data.party},
        ${data.constituency},
        ${data.city},
        ${data.state},
        ${data.contact || null},
        ${data.email || null},
        FALSE,
        ${data.latitude || null},
        ${data.longitude || null}
      )
      ON CONFLICT (name, constituency) DO UPDATE SET
        party = EXCLUDED.party,
        contact = COALESCE(EXCLUDED.contact, mlas.contact),
        email = COALESCE(EXCLUDED.email, mlas.email),
        is_incorrect = FALSE,
        latitude = COALESCE(EXCLUDED.latitude, mlas.latitude),
        longitude = COALESCE(EXCLUDED.longitude, mlas.longitude),
        updated_at = NOW()
    `;
  }
}

/**
 * Direct administrator verification (bypasses normal verification threshold).
 */
export async function adminVerifySubmission(submissionId: string, approved: boolean) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(submissionId)) {
    throw new Error('Invalid submission ID format');
  }

  const [submission] = await sql`
    SELECT id, data_type, raw_data, submitted_by, status, required_verifications
    FROM pending_verifications
    WHERE id = ${submissionId}
  `;

  if (!submission) {
    throw new Error('Submission not found');
  }

  if (submission.status !== 'pending') {
    throw new Error(`Submission already resolved: ${submission.status}`);
  }

  if (approved) {
    await publishVerifiedData(submission);
    await sql`
      UPDATE pending_verifications
      SET status = 'approved', verification_count = required_verifications, updated_at = NOW()
      WHERE id = ${submissionId}
    `;
    
    // Reward points to the submitter
    if (submission.submitted_by) {
      try {
        await sql`
          UPDATE users
          SET integrations_helped = integrations_helped + 1
          WHERE clerk_id = ${submission.submitted_by} OR id::text = ${submission.submitted_by}
        `;
      } catch (err) {
        console.error('Failed to update submitter stats:', err);
      }
    }
  } else {
    await sql`
      UPDATE pending_verifications
      SET status = 'rejected', updated_at = NOW()
      WHERE id = ${submissionId}
    `;
  }
}

