import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDb } from '../db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEED_DIR = path.join(__dirname, '../seed');
const SEED_PATH = path.join(SEED_DIR, 'wallet-cache.json');

getDb();
const db = getDb();

const eliteTraders = db.prepare('SELECT * FROM elite_traders ORDER BY address').all();
const walletStats = db.prepare('SELECT * FROM wallet_stats ORDER BY wallet').all();
const traderPositions = db
  .prepare('SELECT address, condition_id, market_title, side, size, avg_price, entry_timestamp, token_id, fetched_at FROM trader_positions ORDER BY address, condition_id')
  .all();

const seed = {
  version: 1,
  exportedAt: new Date().toISOString(),
  eliteTraders,
  walletStats,
  traderPositions,
  counts: {
    eliteTraders: eliteTraders.length,
    walletStats: walletStats.length,
    traderPositions: traderPositions.length,
  },
};

fs.mkdirSync(SEED_DIR, { recursive: true });
fs.writeFileSync(SEED_PATH, JSON.stringify(seed));

console.log(`Wrote ${SEED_PATH}`);
console.log(seed.counts);
