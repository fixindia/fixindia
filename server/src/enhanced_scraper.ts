/* eslint-disable @typescript-eslint/no-unused-vars */
import Parser from 'rss-parser';
import * as cheerio from 'cheerio';
import { queryLLM } from './llm';
import sql from './db';
import { NEWS_SOURCES, INDIAN_CITIES } from './config/cities';

const parser = new Parser({
  timeout: 15000,
  headers: {
    'User-Agent': 'FixIndia.org News Aggregator (civic@fixindia.org)',
  }
});

interface NewsArticle {
  headline: string;
  url: string;
  source: string;
  snippet: string;
  publishedAt?: Date;
  city?: string;
}

// RSS Feed URLs for major news sources
const RSS_FEEDS = {
  'thehindu.com': [
    'https://www.thehindu.com/news/cities/bangalore/feeder/default.rss',
    'https://www.thehindu.com/news/cities/Delhi/feeder/default.rss',
    'https://www.thehindu.com/news/cities/Mumbai/feeder/default.rss',
  ],
  'timesofindia.indiatimes.com': [
    'https://timesofindia.indiatimes.com/rssfeeds/2950623.cms', // Bangalore
    'https://timesofindia.indiatimes.com/rssfeeds/-2128936835.cms', // Delhi
    'https://timesofindia.indiatimes.com/rssfeeds/1898055.cms', // Mumbai
  ],
  'indianexpress.com': [
    'https://indianexpress.com/section/cities/bangalore/feed/',
    'https://indianexpress.com/section/cities/delhi/feed/',
    'https://indianexpress.com/section/cities/mumbai/feed/',
  ],
  'deccanherald.com': [
    'https://www.deccanherald.com/rss/bengaluru.xml',
  ],
};

// Infrastructure keywords for filtering
const INFRA_KEYWORDS = /pothole|road|drain|flood|sewer|footpath|traffic|bridge|water|pipe|metro|bus|accident|crater|construction|repair|bbmp|bwssb|bescom|civic|infrastructure|collapse|rain|storm|waterlog|flyover|highway|signal|street\s*light|garbage|waste|lake|tank|bund|erosion|landslide|nala|slum|smart\s*city|tender|contractor|bmtc|bmrcl|ghmc|mcgm|pmc|mla|corporator|ward|municipality/i;

/**
 * Scrape RSS feeds from all configured sources
 */
async function scrapeRSSFeeds(): Promise<NewsArticle[]> {
  const articles: NewsArticle[] = [];

  for (const [domain, feeds] of Object.entries(RSS_FEEDS)) {
    for (const feedUrl of feeds) {
      try {
        console.log(`[RSS] Fetching ${feedUrl}...`);
        const feed = await parser.parseURL(feedUrl);

        for (const item of feed.items.slice(0, 20)) {
          if (!item.title || !item.link) continue;

          // Filter by infrastructure keywords
          if (!INFRA_KEYWORDS.test(item.title)) continue;

          articles.push({
            headline: item.title.trim(),
            url: item.link,
            source: domain.split('.')[0],
            snippet: item.contentSnippet?.slice(0, 200) || '',
            publishedAt: item.pubDate ? new Date(item.pubDate) : new Date(),
          });
        }

        console.log(`[RSS] ✓ ${domain}: ${feed.items.length} articles`);
      } catch (e) {
        console.error(`[RSS] Failed ${feedUrl}:`, (e as Error).message);
      }
    }
  }

  return articles;
}

/**
 * AI-based geocoding and verification
 */
const GEOCODE_SYSTEM_PROMPT = `You are an Indian city geography expert. Given a news headline about civic infrastructure, extract:
1. The city name (Bengaluru, Mumbai, Delhi, Hyderabad, Chennai, Kolkata, etc.)
2. Specific area/neighborhood/road mentioned
3. Approximate latitude and longitude
4. Whether this involves death, injury, or tragedy
5. One-line summary (max 120 chars)
6. Whether this is genuinely about civic infrastructure

Respond ONLY in valid JSON:
{"city": "string", "neighborhood": "string", "lat": number, "lng": number, "is_tragic": boolean, "snippet": "string", "confidence": 0-100, "is_infrastructure": boolean}

Rules:
- Confidence 90+ = exact location (e.g. "MG Road Bengaluru")
- Confidence 60-89 = area mentioned (e.g. "East Mumbai")
- Confidence 30-59 = city mentioned but vague
- Confidence 0-29 = not infrastructure or unclear location
- If not about Indian civic infrastructure, set is_infrastructure to false`;

interface GeocodedArticle extends NewsArticle {
  city: string;
  neighborhood: string;
  lat: number;
  lng: number;
  is_tragic: boolean;
  confidence: number;
}

async function geocodeArticle(article: NewsArticle): Promise<GeocodedArticle | null> {
  try {
    const prompt = `Headline: "${article.headline}"\nSource: ${article.source}`;
    const response = await queryLLM(prompt, GEOCODE_SYSTEM_PROMPT);

    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]);

    // Skip non-infrastructure stories
    if (parsed.is_infrastructure === false || parsed.confidence < 30) return null;

    // ACCURACY: Do not fabricate coordinates. The old code defaulted any article
    // with missing lat/lng to Bengaluru city center, dropping unrelated stories
    // (Delhi, Mumbai, …) onto Karnataka. If the model can't produce a valid
    // in-India coordinate, skip the article rather than mislocate it.
    const lat = typeof parsed.lat === 'number' ? parsed.lat : NaN;
    const lng = typeof parsed.lng === 'number' ? parsed.lng : NaN;
    const validCoords =
      Number.isFinite(lat) && Number.isFinite(lng) &&
      lat >= 6 && lat <= 37 && lng >= 68 && lng <= 98; // India bounding box
    if (!validCoords) {
      console.warn(`[Geocode] Dropping "${article.headline.slice(0, 60)}" — no valid coordinates.`);
      return null;
    }

    return {
      ...article,
      city: parsed.city || 'Unknown',
      neighborhood: parsed.neighborhood || '',
      lat,
      lng,
      is_tragic: !!parsed.is_tragic,
      snippet: parsed.snippet || article.snippet,
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0,
    };
  } catch (e) {
    console.error(`[Geocode] Failed for: ${article.headline}`, (e as Error).message);
    return null;
  }
}

/**
 * Main enhanced news scraper
 */
export async function runEnhancedNewsScraper(): Promise<number> {
  console.log('[Enhanced News Scraper] Starting...');

  // Scrape RSS feeds
  const rssArticles = await scrapeRSSFeeds();
  console.log(`[Scraper] Found ${rssArticles.length} RSS articles`);

  // Filter by infrastructure relevance
  const filtered = rssArticles.filter(a => INFRA_KEYWORDS.test(a.headline));
  console.log(`[Scraper] ${filtered.length} infrastructure-related after filter`);

  if (filtered.length === 0) {
    console.log('[Scraper] No articles found');
    return 0;
  }

  // Geocode through AI (with rate limiting)
  let inserted = 0;
  for (const article of filtered.slice(0, 30)) {
    // Cost gate: skip the expensive LLM geocode for articles already in the DB.
    // (Race-safety does NOT rely on this check — the INSERT below uses
    // ON CONFLICT (url) DO NOTHING, so a concurrent run can't double-insert.)
    const existing = await sql`SELECT id FROM local_news WHERE url = ${article.url}`;
    if (existing.length > 0) continue;

    const geocoded = await geocodeArticle(article);
    if (!geocoded || geocoded.confidence < 30) continue;

    try {
      // Race-safe idempotent insert (9.2): local_news.url is UNIQUE, so a
      // concurrent run can't double-insert the same article. ON CONFLICT DO
      // NOTHING means re-running the scraper never duplicates rows.
      await sql`
        INSERT INTO local_news (
          headline, url, source, snippet, location,
          is_tragic, confidence_score, published_at, city
        )
        VALUES (
          ${geocoded.headline},
          ${geocoded.url},
          ${geocoded.source},
          ${geocoded.snippet},
          ST_SetSRID(ST_MakePoint(${geocoded.lng}, ${geocoded.lat}), 4326)::geography,
          ${geocoded.is_tragic},
          ${geocoded.confidence},
          ${geocoded.publishedAt || new Date()},
          ${geocoded.city}
        )
        ON CONFLICT (url) DO NOTHING
      `;
      inserted++;
      console.log(`[Scraper] ✓ ${geocoded.city}: "${geocoded.headline.slice(0, 60)}..." (${geocoded.confidence})`);
    } catch (e) {
      console.error(`[Scraper] Insert failed:`, (e as Error).message);
    }

    // Rate limit: 500ms between AI calls
    await new Promise(r => setTimeout(r, 500));
  }

  console.log(`[Enhanced News Scraper] Complete. Inserted ${inserted} articles.`);
  return inserted;
}
