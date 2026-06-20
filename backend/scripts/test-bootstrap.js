import { getDb, getActiveTrackedWallets, getTodaysPicks, getTodaysIntradayPicks } from '../db.js';
import { runInitialBootstrap } from '../discoveryWorker.js';

getDb();
console.log('DB:', process.env.DATABASE_PATH);
console.log('Starting bootstrap simulation...');
const t0 = Date.now();
await runInitialBootstrap((p) => console.log('phase:', p));
console.log('elapsed sec', ((Date.now() - t0) / 1000).toFixed(1));
console.log('tracked', getActiveTrackedWallets().length);
console.log('swing enterable', getTodaysPicks().length);
console.log('daily enterable', getTodaysIntradayPicks().length);
const elite = getDb().prepare('SELECT COUNT(*) AS n FROM elite_traders').get();
const stats = getDb().prepare("SELECT COUNT(*) AS n FROM wallet_stats WHERE status = 'ACTIVE'").get();
const swingSaved = getDb().prepare("SELECT COUNT(*) AS n FROM daily_picks WHERE status = 'ACTIVE'").get();
const dailySaved = getDb().prepare("SELECT COUNT(*) AS n FROM intraday_picks WHERE status = 'ACTIVE'").get();
console.log({ elite: elite.n, statsActive: stats.n, swingActive: swingSaved.n, dailyActive: dailySaved.n });
