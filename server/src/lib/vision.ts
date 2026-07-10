/**
 * AI photo analysis (Track 3). Given an uploaded civic-issue photo, suggest a
 * category + severity so reporting is faster and more consistent. Uses a vision
 * model when configured; returns null on any failure so the client silently
 * falls back to manual selection (today's behaviour). Bounded by an overall
 * deadline so a slow/unreachable model never stalls the report flow.
 */
import { queryVision } from '../llm';

export interface ImageAnalysis {
  category: string;       // one of the app's categories, or 'Other'
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;    // short human-readable summary
  isCivicIssue: boolean;  // false if the photo isn't a public-infrastructure problem
  confidence: number;     // 0..1
}

const CATEGORIES = ['Pothole', 'Broken Footpath', 'Drainage', 'Streetlight', 'Other'];
const SEVERITIES = ['low', 'medium', 'high', 'critical'];
const VISION_DEADLINE_MS = 15000;

const SYSTEM =
  'You are a civic-infrastructure triage assistant for an Indian city. Look at the photo and classify the public issue. ' +
  `Respond with ONLY a JSON object: {"category": one of ${JSON.stringify(CATEGORIES)}, ` +
  `"severity": one of ${JSON.stringify(SEVERITIES)}, "description": a short factual phrase (max 12 words), ` +
  '"isCivicIssue": boolean (false if this is not a public-infrastructure problem), "confidence": number 0..1}. ' +
  'Pick "Other" if none of the specific categories fit. Base severity on public-safety impact.';

/**
 * Analyze a data-URL-encoded image. Returns a suggestion or null (fall back to
 * manual). Never throws.
 */
export async function analyzeCivicImage(imageDataUrl: string): Promise<ImageAnalysis | null> {
  try {
    const raw = await Promise.race([
      queryVision(imageDataUrl, 'Classify the civic issue shown in this photo.', SYSTEM),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('vision deadline exceeded')), VISION_DEADLINE_MS),
      ),
    ]);
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const p = JSON.parse(match[0]) as Partial<ImageAnalysis>;

    const category = CATEGORIES.includes(String(p.category)) ? String(p.category) : 'Other';
    const severity = (SEVERITIES.includes(String(p.severity)) ? p.severity : 'medium') as ImageAnalysis['severity'];
    const confidence = typeof p.confidence === 'number' ? Math.max(0, Math.min(1, p.confidence)) : 0.5;

    return {
      category,
      severity,
      description: (p.description || '').toString().slice(0, 120),
      isCivicIssue: p.isCivicIssue !== false,
      confidence,
    };
  } catch {
    return null;
  }
}
