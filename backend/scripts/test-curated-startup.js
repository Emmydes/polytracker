/**
 * Simulate Render cold start with empty DB.
 * Usage: node scripts/test-curated-startup.js
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const testDb = path.join(__dirname, '../test-render-curated.db');

if (fs.existsSync(testDb)) fs.unlinkSync(testDb);
process.env.DATABASE_PATH = testDb;
process.env.SKIP_BACKGROUND_DISCOVERY = 'true';

const start = Date.now();

const { runCuratedStartup } = await import('../discoveryWorker.js');
const {
  getActiveTrackedWallets,
  getTodaysPicks,
  getTodaysIntradayPicks,
  getDb,
  closeDb,
} = await import('../db.js');

console.log(`Testing curated startup with ${testDb}`);

await runCuratedStartup((msg) => console.log(`  ${msg}`));

const elapsed = ((Date.now() - start) / 1000).toFixed(1);
const tracked = getActiveTrackedWallets().length;
const swing = getTodaysPicks().length;
const daily = getTodaysIntradayPicks().length;
const positions = getDb().prepare('SELECT COUNT(*) AS n FROM trader_positions').get().n;
const curated = getDb().prepare('SELECT COUNT(*) AS n FROM curated_wallets').get().n;

console.log('');
console.log('=== Results ===');
console.log(`Time: ${elapsed}s`);
console.log(`Curated wallets in DB: ${curated}`);
console.log(`Tracked wallets: ${tracked}`);
console.log(`Cached positions: ${positions}`);
console.log(`Swing picks (enterable): ${swing}`);
console.log(`Daily picks (enterable): ${daily}`);

closeDb();
if (fs.existsSync(testDb)) {
  try {
    fs.unlinkSync(testDb);
  } catch {
    /* WAL lock on Windows — test results still valid */
  }
}

process.exit(tracked >= 10 && swing >= 1 && daily >= 3 ? 0 : 1);
