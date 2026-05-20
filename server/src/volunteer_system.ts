import sql from './db';

interface VolunteerSubmission {
  type: 'report' | 'news' | 'mla';
  data: any;
  submittedBy: string;
  submitterEmail?: string;
}

/**
 * Submit data for verification
 */
export async function submitVolunteerData(submission: VolunteerSubmission) {
  const { type, data, submittedBy, submitterEmail } = submission;

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
      ${JSON.stringify(data)},
      ${submittedBy},
      ${submitterEmail || null},
      'pending'
    )
    RETURNING id, created_at
  `;

  return pending;
}

/**
 * Get pending submissions for verification
 */
export async function getPendingSubmissions(limit: number = 50) {
  const pending = await sql`
    SELECT
      id, data_type, raw_data, submitted_by, submitter_email,
      verification_count, required_verifications, created_at
    FROM pending_verifications
    WHERE status = 'pending'
    ORDER BY created_at ASC
    LIMIT ${limit}
  `;

  return pending;
}

/**
 * Verify a submission
 */
export async function verifySubmission(
  submissionId: string,
  verifierId: string,
  approved: boolean,
  notes?: string
) {
  // Record verification
  await sql`
    INSERT INTO volunteer_verifications (submission_id, verifier_id, approved, notes)
    VALUES (${submissionId}, ${verifierId}, ${approved}, ${notes || null})
  `;

  // Update verification count
  await sql`
    UPDATE pending_verifications
    SET verification_count = verification_count + 1
    WHERE id = ${submissionId}
  `;

  // Check if we have enough verifications
  const [submission] = await sql`
    SELECT
      id, data_type, raw_data, verification_count, required_verifications
    FROM pending_verifications
    WHERE id = ${submissionId}
  `;

  if (submission.verification_count >= submission.required_verifications) {
    // Check approval ratio
    const verifications = await sql`
      SELECT COUNT(*) as total, SUM(CASE WHEN approved THEN 1 ELSE 0 END) as approved
      FROM volunteer_verifications
      WHERE submission_id = ${submissionId}
    `;

    const approvalRatio = Number(verifications[0].approved) / Number(verifications[0].total);

    if (approvalRatio >= 0.67) { // 2 out of 3 approved
      // Auto-publish
      await publishVerifiedData(submission);

      await sql`
        UPDATE pending_verifications
        SET status = 'approved', updated_at = NOW()
        WHERE id = ${submissionId}
      `;

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
 * Publish verified data to main tables
 */
async function publishVerifiedData(submission: any) {
  const data = JSON.parse(submission.raw_data);

  if (submission.data_type === 'report') {
    await sql`
      INSERT INTO reports (
        title, category, location, severity, ward_name, mla_name, creator_id
      )
      VALUES (
        ${data.title},
        ${data.category},
        ST_SetSRID(ST_MakePoint(${data.longitude}, ${data.latitude}), 4326)::geography,
        ${data.severity || 'medium'},
        ${data.ward_name || 'Unknown'},
        ${data.mla_name || 'TBD'},
        'volunteer-verified'
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
      INSERT INTO mlas (name, party, constituency, city, state, contact, email)
      VALUES (
        ${data.name},
        ${data.party},
        ${data.constituency},
        ${data.city},
        ${data.state},
        ${data.contact || null},
        ${data.email || null}
      )
      ON CONFLICT (name, constituency) DO UPDATE SET
        party = EXCLUDED.party,
        contact = COALESCE(EXCLUDED.contact, mlas.contact),
        email = COALESCE(EXCLUDED.email, mlas.email)
    `;
  }
}
