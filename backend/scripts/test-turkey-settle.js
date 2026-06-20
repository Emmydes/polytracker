/**
 * Simulate Turkey snap election NO pick settlement.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const testDb = path.join(__dirname, '../test-turkey-settle.db');
if (fs.existsSync(testDb)) fs.unlinkSync(testDb);

process.env.DATABASE_PATH = testDb;

const { getDb, saveDailyPicks } = await import('../db.js');
const { runSignalLifecycle } = await import('../signalLifecycle.js');
const { getResolvedSignals } = await import('../db.js');
const { fetchMarketByConditionId, didSignalWin } = await import('../polymarketApi.js');
const { isMarketClosed } = await import('../signalLifecycle.js');

const cid = '0x382aac7b65a1974e236ed5c9d8221bd00e173543fa713b044fe3795ae4b737b3';
const market = await fetchMarketByConditionId(cid);
console.log('market', market?.question, 'closed', isMarketClosed(market));
console.log('NO won?', didSignalWin(market, 'NO', null));

getDb();
const today = new Date().toISOString().slice(0, 10);
saveDailyPicks(today, [{
  date: today,
  signal_date: today,
  market_id: cid,
  market_title: 'Turkey snap presidential election called before July?',
  recommended_side: 'NO',
  current_price: 0.85,
  entry_price: 0.72,
  drift_pct: 5,
  potential_return: 40,
  is_late_entry: 0,
  is_best_value: 1,
  elite_trader_count: 4,
  avg_win_rate: 0.92,
  liquidity: 50000,
  market_url: 'https://polymarket.com/event/turkey-snap-presidential-election-called-before-july',
  close_date: '2025-06-30T00:00:00Z',
  coordination_flag: 0,
  created_at: Math.floor(Date.now() / 1000),
  status: 'ACTIVE',
  confidence: 75,
  strength: 'STRONG',
  token_id: null,
}]);

await runSignalLifecycle();
const results = getResolvedSignals('swing', 10, true);
console.log('Results:', results.map((r) => ({ title: r.market_title, side: r.recommended_side, status: r.status })));

const ok = results.some((r) => r.market_id === cid && r.status === 'WON' && r.recommended_side === 'NO');
console.log(ok ? 'PASS' : 'FAIL');
process.exit(ok ? 0 : 1);
