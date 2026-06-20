import { getDb, getActiveTrackedWallets } from '../db.js';
import { runPicksRefresh } from '../recommender.js';

getDb();
const tracked = getActiveTrackedWallets();
console.log('tracked', tracked.length);

for (const mode of ['quick', 'full']) {
  const batch = await runPicksRefresh(['swing', 'intraday'], {
    quick: mode === 'quick',
    finalPriceCheck: mode === 'quick',
  });
  console.log(mode, 'swing', batch.swing?.length ?? 0, 'daily', batch.intraday?.length ?? 0);
}
