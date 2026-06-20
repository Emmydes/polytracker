import { getDb, getResolvedSignals } from '../db.js';

getDb();
const db = getDb();

const turkey = [
  ...db.prepare("SELECT id, 'swing' AS h, market_title, recommended_side, status, outcome, market_id, close_date FROM daily_picks WHERE LOWER(market_title) LIKE '%turkey%'").all(),
  ...db.prepare("SELECT id, 'daily' AS h, market_title, recommended_side, status, outcome, market_id, close_date FROM intraday_picks WHERE LOWER(market_title) LIKE '%turkey%'").all(),
];

console.log('Turkey picks:', turkey);
console.log('Resolved WON/LOST:', getResolvedSignals('all', 50, true));
console.log('Active swing:', db.prepare("SELECT id, market_title, status, outcome FROM daily_picks WHERE status IN ('ACTIVE','EXPIRED') AND COALESCE(outcome,'') NOT IN ('WON','LOST')").all());
