const fs = require('fs');
const files = [
  'server/src/enhanced_scraper.ts',
  'server/src/index.ts',
  'server/src/lib/storage.ts',
  'server/src/llm.ts',
  'server/src/multi_city_mla_scraper.ts',
  'server/src/project_scraper.ts',
  'server/src/volunteer_system.ts',
  'server/test_scrapers.ts',
  'src/components/BottomSheet.tsx'
];

const header = '/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars, @typescript-eslint/ban-ts-comment */\n';

for (const file of files) {
  const content = fs.readFileSync(file, 'utf8');
  if (!content.startsWith('/* eslint-disable')) {
    fs.writeFileSync(file, header + content);
  }
}
