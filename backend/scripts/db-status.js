import { getDb, getActiveTrackedWallets, getTodaysPicks, getTodaysIntradayPicks } from '../db.js';

getDb();
const db = getDb();
console.log({
  db: process.env.DATABASE_PATH || 'default',
  tracked: getActiveTrackedWallets().length,
  walletStats: db.prepare("SELECT COUNT(*) AS n FROM wallet_stats WHERE status='ACTIVE'").get().n,
  elite: db.prepare('SELECT COUNT(*) AS n FROM elite_traders').get().n,
  positions: db.prepare('SELECT COUNT(*) AS n FROM trader_positions').get().n,
  swingEnterable: getTodaysPicks().length,
  dailyEnterable: getTodaysIntradayPicks().length,
  swingActive: db.prepare("SELECT COUNT(*) AS n FROM daily_picks WHERE status='ACTIVE'").get().n,
  dailyActive: db.prepare("SELECT COUNT(*) AS n FROM intraday_picks WHERE status='ACTIVE'").get().n,
  bootstrapComplete: db.prepare("SELECT value FROM meta WHERE key='bootstrap_complete'").get()?.value,
});
