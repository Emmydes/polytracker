import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDb, setMeta } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEED_PATH = path.join(__dirname, 'seed', 'wallet-cache.json');

export function importSeedIfEmpty() {
  const db = getDb();
  const eliteCount = db.prepare('SELECT COUNT(*) AS n FROM elite_traders').get().n;
  if (eliteCount > 0) {
    return { imported: false, reason: 'database already has elite traders' };
  }

  if (!fs.existsSync(SEED_PATH)) {
    return { imported: false, reason: 'seed file missing' };
  }

  const seed = JSON.parse(fs.readFileSync(SEED_PATH, 'utf8'));
  const eliteTraders = seed.eliteTraders ?? [];
  const walletStats = seed.walletStats ?? [];
  const traderPositions = seed.traderPositions ?? [];

  if (eliteTraders.length === 0) {
    return { imported: false, reason: 'seed has no elite traders' };
  }

  const insertElite = db.prepare(`
    INSERT INTO elite_traders (
      address, win_rate, total_profit, total_trades, resolved_trades,
      trading_days_30, last_10_win_rate, is_cooling_off, last_fetched
    ) VALUES (
      @address, @win_rate, @total_profit, @total_trades, @resolved_trades,
      @trading_days_30, @last_10_win_rate, @is_cooling_off, @last_fetched
    )
  `);

  const insertWallet = db.prepare(`
    INSERT INTO wallet_stats (wallet, win_rate, total_resolved, avg_roi, last_checked, status)
    VALUES (@wallet, @win_rate, @total_resolved, @avg_roi, @last_checked, @status)
  `);

  const insertPosition = db.prepare(`
    INSERT INTO trader_positions (
      address, condition_id, market_title, side, size, avg_price,
      entry_timestamp, token_id, fetched_at
    ) VALUES (
      @address, @condition_id, @market_title, @side, @size, @avg_price,
      @entry_timestamp, @token_id, @fetched_at
    )
  `);

  const tx = db.transaction(() => {
    for (const row of eliteTraders) insertElite.run(row);
    for (const row of walletStats) insertWallet.run(row);
    for (const row of traderPositions) insertPosition.run(row);
  });
  tx();

  setMeta('seed_imported_at', String(Math.floor(Date.now() / 1000)));
  setMeta('seed_version', String(seed.version ?? 1));

  const counts = {
    eliteTraders: db.prepare('SELECT COUNT(*) AS n FROM elite_traders').get().n,
    walletStats: db.prepare('SELECT COUNT(*) AS n FROM wallet_stats').get().n,
    traderPositions: db.prepare('SELECT COUNT(*) AS n FROM trader_positions').get().n,
  };

  console.log(
    `Seed import complete: ${counts.eliteTraders} elite wallets, ${counts.traderPositions} cached positions`
  );

  return { imported: true, counts, exportedAt: seed.exportedAt ?? null };
}
