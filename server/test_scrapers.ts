#!/usr/bin/env bun
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars, @typescript-eslint/ban-ts-comment */
// Test script to run scrapers locally and populate initial data

import { runEnhancedNewsScraper } from './src/enhanced_scraper';
import { runMultiCityMLAScraper } from './src/multi_city_mla_scraper';
import sql from './src/db';

console.log('🧪 FixIndia.org - Local Scraper Test\n');

async function testDatabaseConnection() {
  console.log('1️⃣  Testing database connection...');
  try {
    const result = await sql`SELECT NOW() as time`;
    console.log('   ✅ Database connected:', result[0].time);
    return true;
  } catch (e) {
    console.error('   ❌ Database connection failed:', (e as Error).message);
    return false;
  }
}

async function testEnhancedNewsScraper() {
  console.log('\n2️⃣  Testing Enhanced News Scraper...');
  try {
    const count = await runEnhancedNewsScraper();
    console.log(`   ✅ Scraped ${count} news articles`);

    // Check results
    const stats = await sql`
      SELECT city, COUNT(*) as count
      FROM local_news
      WHERE created_at > NOW() - INTERVAL '1 hour'
      GROUP BY city
    `;

    console.log('   📊 Articles by city:');
    stats.forEach((s: any) => {
      console.log(`      - ${s.city}: ${s.count} articles`);
    });

    return count;
  } catch (e) {
    console.error('   ❌ News scraper failed:', (e as Error).message);
    return 0;
  }
}

async function testMLAScraper() {
  console.log('\n3️⃣  Testing Multi-City MLA Scraper...');
  try {
    const count = await runMultiCityMLAScraper();
    console.log(`   ✅ Scraped ${count} MLAs`);

    // Check results
    const stats = await sql`
      SELECT state, city, COUNT(*) as count
      FROM mlas
      GROUP BY state, city
      ORDER BY count DESC
    `;

    console.log('   📊 MLAs by state/city:');
    stats.forEach((s: any) => {
      console.log(`      - ${s.state} (${s.city}): ${s.count} MLAs`);
    });

    return count;
  } catch (e) {
    console.error('   ❌ MLA scraper failed:', (e as Error).message);
    return 0;
  }
}

async function showDatabaseStats() {
  console.log('\n4️⃣  Database Statistics:');

  const reportCount = await sql`SELECT COUNT(*) as count FROM reports`;
  const newsCount = await sql`SELECT COUNT(*) as count FROM local_news`;
  const mlaCount = await sql`SELECT COUNT(*) as count FROM mlas`;

  console.log(`   📊 Total Reports: ${reportCount[0].count}`);
  console.log(`   📊 Total News: ${newsCount[0].count}`);
  console.log(`   📊 Total MLAs: ${mlaCount[0].count}`);
}

// Run tests
async function main() {
  const dbOk = await testDatabaseConnection();
  if (!dbOk) {
    console.error('\n❌ Cannot proceed without database connection');
    process.exit(1);
  }

  await testEnhancedNewsScraper();
  await testMLAScraper();
  await showDatabaseStats();

  console.log('\n✅ All tests complete!\n');
  process.exit(0);
}

main().catch(console.error);
