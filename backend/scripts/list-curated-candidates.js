import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * List wallet candidates for manual curation.
 * Usage: node scripts/list-curated-candidates.js [--min-win-rate=0.85] [--min-resolved=100] [--limit=30]
 */
async function main() {
  const { getDb } = await import('../db.js');
  const { CURATED_CRITERIA } = await import('../curatedWallets.js');

  const args = Object.fromEntries(
    process.argv.slice(2).map((a) => {
      const [k, v] = a.replace(/^--/, '').split('=');
      return [k, v ?? 'true'];
    })
  );

  const minWinRate = Number(args['min-win-rate'] ?? CURATED_CRITERIA.minWinRate);
  const minResolved = Number(args['min-resolved'] ?? CURATED_CRITERIA.minResolvedTrades);
  const limit = Number(args.limit ?? 30);

  const dbPath = process.env.DATABASE_PATH || path.join(__dirname, '../polytracker.db');
  if (!fs.existsSync(dbPath)) {
    console.error(`Database not found: ${dbPath}`);
    console.error('Run locally with a warm DB, or pass DATABASE_PATH=...');
    process.exit(1);
  }

  getDb();
  const db = getDb();

  const rows = db
    .prepare(`
      SELECT et.address, et.win_rate, et.resolved_trades, et.total_trades, et.total_profit,
             ws.status, cw.address IS NOT NULL AS is_curated
      FROM elite_traders et
      LEFT JOIN wallet_stats ws ON LOWER(et.address) = LOWER(ws.wallet)
      LEFT JOIN curated_wallets cw ON LOWER(et.address) = LOWER(cw.address)
      WHERE et.is_cooling_off = 0
        AND et.win_rate >= ?
        AND et.resolved_trades >= ?
      ORDER BY et.resolved_trades DESC, et.win_rate DESC
      LIMIT ?
    `)
    .all(minWinRate, minResolved, limit);

  console.log(`Candidates (win_rate >= ${(minWinRate * 100).toFixed(0)}%, resolved >= ${minResolved}):`);
  console.log('');
  for (const r of rows) {
    const flag = r.is_curated ? '[curated]' : r.status === 'ACTIVE' ? '[active]' : `[${r.status ?? 'unknown'}]`;
    console.log(
      `${flag} ${r.address}  WR=${(r.win_rate * 100).toFixed(1)}%  resolved=${r.resolved_trades}  trades=${r.total_trades}`
    );
  }
  console.log('');
  console.log(`Total: ${rows.length} wallets`);
  console.log('');
  console.log('To add a wallet: append to CURATED_WALLET_LIST in backend/curatedWallets.js');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
