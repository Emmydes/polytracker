import { getDb, getActiveTrackedWallets } from '../db.js';
import { runPicksRefresh } from '../recommender.js';

const db = getDb();

// Promote all ACTIVE wallet_stats to elite_traders (simulate preTrack fix)
const stats = db.prepare(`
  SELECT ws.* FROM wallet_stats ws WHERE ws.status = 'ACTIVE' AND ws.win_rate >= 0.85
`).all();

for (const ws of stats) {
  const exists = db.prepare('SELECT 1 FROM elite_traders WHERE address = ?').get(ws.wallet);
  if (!exists) {
    db.prepare(`
      INSERT INTO elite_traders (address, win_rate, total_profit, total_trades, resolved_trades, trading_days_30, last_10_win_rate, is_cooling_off, last_fetched)
      VALUES (?, ?, 0, 0, ?, 0, ?, 0, ?)
    `).run(ws.wallet, ws.win_rate, ws.total_resolved, ws.win_rate, Math.floor(Date.now()/1000));
  }
}

console.log('tracked after promote', getActiveTrackedWallets().length);

const batch = await runPicksRefresh(['swing', 'intraday'], { quick: true, finalPriceCheck: true });
console.log('picks', batch.swing?.length ?? 0, batch.intraday?.length ?? 0);
