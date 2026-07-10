import sql from './db';
import { readFileSync, existsSync } from 'fs';
import path from 'path';

async function seed() {
  console.log('🌱 Seeding FixIndia.org database...');

  // ─── Real Bengaluru Ward + MLA Data ──────────
  let wards = [];
  const currentFilePath = new URL(import.meta.url).pathname;
  const currentDir = path.dirname(currentFilePath);
  const fullDataPath = path.join(currentDir, 'utils', 'bengaluru_wards_full.json');
  
  if (existsSync(fullDataPath)) {
    console.log('  📄 Loading full 243-ward dataset from NammaKasa mapping...');
    wards = JSON.parse(readFileSync(fullDataPath, 'utf8'));
  } else {
    console.warn('  ⚠️ Full ward dataset not found, using minimal sample.');
    wards = [
      { ward_number: 76, ward_name: 'Ward 76 - Richmond Town', mla_name: 'N.A. Haris', assembly: 'Shanti Nagar', budget: 1.5, city: 'Bengaluru' },
      { ward_number: 147, ward_name: 'Ward 147 - Koramangala', mla_name: 'Ramalinga Reddy', assembly: 'BTM Layout', budget: 4.0, city: 'Bengaluru' },
      // ... (keeping a few for fallback)
      { ward_number: 27, ward_name: 'Ward 27 - Yelahanka', mla_name: 'S.R. Vishwanath', assembly: 'Yelahanka', budget: 4.5, city: 'Bengaluru' },
    ];
  }

  for (const w of wards) {
    const budgetValue = w.budget || 0;
    const boundaryWkb = w.boundary_wkb;
    
    await sql`
      INSERT INTO wards (
        ward_number, ward_name, mla_name, constituency, 
        sanctioned_budget, city, zone, parliamentary_constituency, mp_name, boundaries
      )
      VALUES (
        ${w.ward_number}, ${w.ward_name}, ${w.mla_name}, ${w.assembly}, 
        ${budgetValue}, ${w.city}, ${w.zone || null}, ${w.parliament || null}, ${w.mp_name || null},
        ${boundaryWkb ? sql`ST_GeomFromWKB(decode(${boundaryWkb}, 'hex'), 4326)` : null}
      )
      ON CONFLICT (ward_number) WHERE ward_number IS NOT NULL DO UPDATE SET
        mla_name = EXCLUDED.mla_name,
        sanctioned_budget = EXCLUDED.sanctioned_budget,
        zone = EXCLUDED.zone,
        parliamentary_constituency = EXCLUDED.parliamentary_constituency,
        mp_name = EXCLUDED.mp_name,
        boundaries = COALESCE(EXCLUDED.boundaries, wards.boundaries)
    `;
  }

  console.log(`  ✓ ${wards.length} wards seeded`);

  console.log(`  ✓ ${wards.length} wards seeded`);

  console.log('\n✅ Database seeded successfully!');
  await sql.end();
  process.exit(0);
}

seed().catch(e => {
  console.error('Seed failed:', e);
  process.exit(1);
});
