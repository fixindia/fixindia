import * as cheerio from 'cheerio';
import { queryLLM } from './llm';
import sql from './db';
import { INDIAN_CITIES } from './config/cities';

interface MLAData {
  name: string;
  party: string;
  constituency: string;
  city: string;
  state: string;
  contact?: string;
  email?: string;
}

const SCRAPE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; FixIndia.org/1.0; +https://fixindia.org)',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
};

/**
 * Scrape MLA data from Wikipedia for a given state
 */
async function scrapeMlasFromWikipedia(city: string, wikiUrl: string): Promise<MLAData[]> {
  const mlas: MLAData[] = [];
  const cityConfig = INDIAN_CITIES[city as keyof typeof INDIAN_CITIES];

  try {
    console.log(`[MLA] Scraping ${cityConfig.name}...`);
    const res = await fetch(wikiUrl, {
      headers: SCRAPE_HEADERS,
      signal: AbortSignal.timeout(20000),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    const $ = cheerio.load(html);

    // Wikipedia tables usually have class 'wikitable'
    $('table.wikitable tr').each((_, row) => {
      const cells = $(row).find('td');
      if (cells.length < 3) return;

      const constituency = $(cells[0]).text().trim();
      const mlaName = $(cells[1]).text().trim();
      const party = $(cells[2]).text().trim();

      if (mlaName && constituency && mlaName.length > 2) {
        mlas.push({
          name: mlaName,
          party: party || 'Independent',
          constituency,
          city: cityConfig.name,
          state: cityConfig.state,
        });
      }
    });

    console.log(`[MLA] ✓ ${cityConfig.name}: Found ${mlas.length} MLAs`);
  } catch (e) {
    console.error(`[MLA] Failed ${cityConfig.name}:`, (e as Error).message);
  }

  return mlas;
}

/**
 * Use AI to extract contact information from government websites
 */
async function enrichMLAData(mla: MLAData): Promise<MLAData> {
  // This would query government websites for contact info
  // For now, return as-is (can be enhanced later)
  return mla;
}

/**
 * Run multi-city MLA scraper
 */
export async function runMultiCityMLAScraper(): Promise<number> {
  console.log('[Multi-City MLA Scraper] Starting...');
  let totalInserted = 0;

  for (const [cityKey, cityConfig] of Object.entries(INDIAN_CITIES)) {
    if (!cityConfig.enabled) {
      console.log(`[MLA] Skipping ${cityConfig.name} (disabled)`);
      continue;
    }

    const mlas = await scrapeMlasFromWikipedia(cityKey, cityConfig.sources.mla);

    for (const mla of mlas) {
      try {
        // Check if MLA already exists
        const existing = await sql`
          SELECT id FROM mlas
          WHERE name = ${mla.name}
          AND constituency = ${mla.constituency}
        `;

        if (existing.length > 0) {
          // Update existing
          await sql`
            UPDATE mlas SET
              party = ${mla.party},
              city = ${mla.city},
              state = ${mla.state},
              updated_at = NOW()
            WHERE name = ${mla.name}
            AND constituency = ${mla.constituency}
          `;
        } else {
          // Insert new
          await sql`
            INSERT INTO mlas (name, party, constituency, city, state)
            VALUES (${mla.name}, ${mla.party}, ${mla.constituency}, ${mla.city}, ${mla.state})
          `;
          totalInserted++;
        }
      } catch (e) {
        console.error(`[MLA] Insert failed for ${mla.name}:`, (e as Error).message);
      }
    }

    // Rate limit between cities
    await new Promise(r => setTimeout(r, 2000));
  }

  console.log(`[Multi-City MLA Scraper] Complete. Inserted/Updated ${totalInserted} MLAs.`);
  return totalInserted;
}
