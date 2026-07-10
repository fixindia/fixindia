/**
 * Escalation & agency-routing helpers (Track 2).
 *
 * - resolveAgency(): maps a civic issue to the responsible department. Pure and
 *   keyword-based so it runs inline in the (latency-sensitive) report-submit path
 *   with zero external calls. Covers the standard categories plus a broad keyword
 *   sweep of free-text "Other" descriptions.
 * - draftComplaint(): produces a formal complaint letter a citizen can send to
 *   their MLA / the agency. Uses the LLM for natural prose when a key is
 *   configured, and always falls back to a strong deterministic template so the
 *   feature works with no AI key at all.
 */
import { queryLLM } from '../llm';

export interface ComplaintInput {
  title: string;
  category: string;
  customCategory?: string | null;
  ward?: string | null;
  mla?: string | null;
  mp?: string | null;
  agency?: string | null;
  sanctionedBudget?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  daysOpen?: number | null;
  upvotes?: number | null;
}

export interface Complaint {
  subject: string;
  body: string;
  source: 'ai' | 'template';
}

// Keyword → department. First match wins. Standard categories are exact hits;
// the rest lets free-text "Other" reports still route sensibly.
const AGENCY_RULES: Array<{ re: RegExp; agency: string }> = [
  { re: /pothole|road|tar|asphalt|speed breaker|median/i, agency: 'BBMP Major Roads' },
  { re: /footpath|pavement|sidewalk|kerb|curb/i, agency: 'BBMP Ward Level' },
  { re: /drain|sewage|sewer|manhole|water\s*logg|flood|stagnant|overflow/i, agency: 'BWSSB' },
  { re: /water\s*supply|pipeline|tap|borewell/i, agency: 'BWSSB' },
  { re: /street\s*light|streetlight|lamp|electric|transformer|power|cable|wire/i, agency: 'BESCOM' },
  { re: /garbage|trash|waste|litter|dump|dustbin/i, agency: 'BBMP Solid Waste Management' },
  { re: /tree|branch|park|greenery|encroach/i, agency: 'BBMP Forest Cell' },
  { re: /traffic|signal|parking|congestion/i, agency: 'Bengaluru Traffic Police' },
  { re: /stray|dog|cattle|animal/i, agency: 'BBMP Animal Husbandry' },
];

/**
 * Route a report to the responsible department. Keyword-based (no network),
 * so it is safe to call inline during report submission.
 */
export function resolveAgency(category: string, customCategory?: string | null): string {
  const haystack = `${category} ${customCategory || ''}`;
  for (const { re, agency } of AGENCY_RULES) {
    if (re.test(haystack)) return agency;
  }
  return 'Municipal Corporation';
}

function issueLabel(input: ComplaintInput): string {
  return input.category === 'Other' && input.customCategory
    ? input.customCategory
    : input.category;
}

/** Deterministic, key-free formal complaint. Always available as a fallback. */
export function complaintTemplate(input: ComplaintInput): Complaint {
  const label = issueLabel(input);
  const where = input.ward && input.ward !== 'Unknown Ward' ? input.ward : 'my locality';
  const coords = input.latitude != null && input.longitude != null
    ? ` (approx. ${Number(input.latitude).toFixed(5)}, ${Number(input.longitude).toFixed(5)})`
    : '';
  const days = input.daysOpen != null && input.daysOpen > 0 ? input.daysOpen : null;
  const subject = `Urgent: Unresolved ${label} in ${where} — request for immediate action`;

  const lines: string[] = [];
  lines.push(`To,`);
  lines.push(`${input.mla ? `Hon'ble MLA ${input.mla}` : 'The Concerned Officer'}${input.agency ? `\n${input.agency}` : ''}`);
  lines.push('');
  lines.push(`Subject: ${subject}`);
  lines.push('');
  lines.push(`Respected Sir/Madam,`);
  lines.push('');
  lines.push(
    `I am writing as a concerned citizen to report a civic issue that requires your urgent attention: "${input.title}" — a ${label.toLowerCase()} problem in ${where}${coords}.`,
  );
  if (days) {
    lines.push(
      `This issue has remained unresolved for approximately ${days} day(s) and continues to affect residents' safety and daily life.`,
    );
  }
  if (input.upvotes && input.upvotes > 0) {
    lines.push(`${input.upvotes} resident(s) have independently confirmed this problem on the FixIndia civic platform.`);
  }
  if (input.sanctionedBudget && !/pending|^₹0/i.test(String(input.sanctionedBudget))) {
    lines.push(
      `I note that a sanctioned ward budget of ${input.sanctionedBudget} exists — I request transparency on how these funds are being utilised to address issues such as this.`,
    );
  }
  lines.push('');
  lines.push(
    `I respectfully request that the responsible department (${input.agency || 'the relevant civic body'}) inspect and resolve this at the earliest, and that I be informed of the action taken and the expected timeline.`,
  );
  lines.push('');
  lines.push(`Thank you for your service.`);
  lines.push('');
  lines.push(`Sincerely,`);
  lines.push(`A concerned citizen of ${where}`);

  return { subject, body: lines.join('\n'), source: 'template' };
}

/**
 * Draft a complaint. Tries the LLM for more persuasive, natural prose; on any
 * failure (no key, timeout, bad output) falls back to complaintTemplate().
 *
 * The whole LLM attempt is bounded by an overall deadline so a misconfigured or
 * unreachable provider (which could otherwise burn one 20s per-model timeout ×
 * several models) can never stall the request — we fall back to the template.
 */
const LLM_DRAFT_DEADLINE_MS = 12000;

export async function draftComplaint(input: ComplaintInput): Promise<Complaint> {
  const fallback = complaintTemplate(input);
  const label = issueLabel(input);

  const system =
    'You are helping an Indian citizen write a firm but respectful formal complaint to their local elected representative (MLA) and municipal agency about an unresolved civic issue. ' +
    'Return ONLY a JSON object: {"subject": string, "body": string}. The body must be a complete letter (To/Subject/Salutation/paragraphs/Sincerely), polite, specific, factual, and no more than ~220 words. Do not invent facts beyond those given.';

  const facts = [
    `Issue title: ${input.title}`,
    `Category: ${label}`,
    input.ward ? `Ward/area: ${input.ward}` : null,
    input.mla ? `MLA: ${input.mla}` : null,
    input.agency ? `Responsible agency: ${input.agency}` : null,
    input.sanctionedBudget ? `Sanctioned ward budget: ${input.sanctionedBudget}` : null,
    input.daysOpen ? `Days unresolved: ${input.daysOpen}` : null,
    input.upvotes ? `Residents who confirmed the issue: ${input.upvotes}` : null,
  ].filter(Boolean).join('\n');

  try {
    const raw = await Promise.race([
      queryLLM(`Write the complaint using these facts:\n${facts}`, system),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('LLM draft deadline exceeded')), LLM_DRAFT_DEADLINE_MS),
      ),
    ]);
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return fallback;
    const parsed = JSON.parse(match[0]) as { subject?: string; body?: string };
    if (parsed.body && parsed.body.length > 60) {
      return {
        subject: parsed.subject?.trim() || fallback.subject,
        body: parsed.body.trim(),
        source: 'ai',
      };
    }
    return fallback;
  } catch {
    return fallback;
  }
}
