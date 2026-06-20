import cron from 'node-cron';
import { runPicksRefresh, generateDailyPicks, generateIntradayPicks } from './recommender.js';
import { sendDailyPicksAlert } from './telegram.js';
import {
  setMeta,
  getMeta,
  getActiveWalletCount,
  getActiveTrackedWallets,
  getTodaysPicks,
  getTodaysIntradayPicks,
  getDbPath,
  getDb,
} from './db.js';
import { runSignalLifecycle } from './signalLifecycle.js';
import {
  runCuratedStartup,
  needsFullCuratedRefresh,
  maybeStartBackgroundDiscovery,
  refreshSignalsFromCache,
  refreshCuratedWallets,
  getDiscoveryState,
} from './discoveryWorker.js';
import { isWalletDiscoveryEnabled } from './curatedWallets.js';

let refreshState = {
  running: false,
  phase: null,
  startedAt: null,
  error: null,
  results: null,
  source: null,
};

let bootstrapState = {
  running: false,
  error: null,
  complete: false,
};

export function getBootstrapState() {
  return { ...bootstrapState };
}

export function getManualRefreshState() {
  if (refreshState.running) {
    return { ...refreshState };
  }
  return {
    running: false,
    phase: null,
    error: refreshState.error,
    results: refreshState.results,
    source: null,
  };
}

/** UI-facing refresh state — manual refresh only (no wallet scan banners). */
export function getRefreshState() {
  if (refreshState.running) {
    return { ...refreshState };
  }
  return {
    running: false,
    phase: null,
    error: null,
    results: refreshState.results,
    source: null,
  };
}

function setPhase(phase) {
  refreshState.phase = phase;
}

export function startScheduler() {
  if (isWalletDiscoveryEnabled()) {
    cron.schedule('0 0 * * *', async () => {
      console.log('[cron] Starting midnight trader discovery...');
      try {
        const { runTraderDiscovery } = await import('./traderScorer.js');
        const result = await runTraderDiscovery({ limit: 200, forceRefresh: true });
        setMeta('last_discovery', String(Math.floor(Date.now() / 1000)));
        setMeta('last_discovery_evaluated', String(result.evaluated));
        setMeta('last_discovery_qualified', String(result.qualified));
        console.log(`[cron] Discovery complete: ${result.qualified}/${result.evaluated} qualified`);
      } catch (err) {
        console.error('[cron] Discovery failed:', err.message);
      }
    });
  }

  cron.schedule('0 */6 * * *', async () => {
    if (isWalletDiscoveryEnabled()) return;
    console.log('[cron] Refreshing curated wallet positions…');
    try {
      await refreshCuratedWallets();
      await refreshSignalsFromCache('curated cron');
    } catch (err) {
      console.error('[cron] Curated refresh failed:', err.message);
    }
  });

  cron.schedule('0 7 * * *', async () => {
    console.log('[cron] Starting 7AM swing picks...');
    try {
      await runSignalLifecycle();
      const picks = await generateDailyPicks({ finalPriceCheck: true, quick: false });
      await sendDailyPicksAlert(picks, 'swing');
      console.log(`[cron] Swing picks complete: ${picks.length} picks`);
    } catch (err) {
      console.error('[cron] Swing picks failed:', err.message);
    }
  });

  cron.schedule('0 8,12,16,20 * * *', async () => {
    console.log('[cron] Starting intraday picks...');
    try {
      await runSignalLifecycle();
      const picks = await generateIntradayPicks({ finalPriceCheck: true, quick: true });
      console.log(`[cron] Intraday picks complete: ${picks.length} picks`);
    } catch (err) {
      console.error('[cron] Intraday picks failed:', err.message);
    }
  });

  cron.schedule('*/15 * * * *', async () => {
    try {
      await runSignalLifecycle();
    } catch (err) {
      console.error('[cron] Signal lifecycle failed:', err.message);
    }
  });

  cron.schedule('*/10 * * * *', async () => {
    try {
      const tracked = getActiveTrackedWallets().length;
      const enterable = getTodaysPicks().length + getTodaysIntradayPicks().length;
      if (tracked > 0 && enterable === 0 && getMeta('bootstrap_complete') === 'true') {
        console.log('[cron] No enterable picks — retrying signal refresh…');
        await refreshSignalsFromCache('empty picks cron');
      }
    } catch (err) {
      console.error('[cron] Empty picks retry failed:', err.message);
    }
  });

  console.log(
    isWalletDiscoveryEnabled()
      ? 'Scheduler started: discovery @ midnight, swing @ 7AM, intraday @ 8/12/4/8PM, lifecycle every 15m'
      : 'Scheduler started: curated refresh every 6h, swing @ 7AM, intraday @ 8/12/4/8PM, lifecycle every 15m'
  );
}

export async function bootstrapIfEmpty() {
  if (bootstrapState.running) return;

  bootstrapState = { running: true, error: null, complete: false };

  try {
    if (needsFullCuratedRefresh()) {
      console.log('Startup: loading curated wallets and fetching positions…');
      await runCuratedStartup((msg) => console.log(`Startup: ${msg}`));
    } else {
      const tracked = getActiveTrackedWallets().length;
      const positions = getDb().prepare('SELECT COUNT(*) AS n FROM trader_positions').get().n;
      console.log(`Startup: ${tracked} wallets, ${positions} cached positions — refreshing signals`);
      await refreshSignalsFromCache('startup');
      setMeta('bootstrap_complete', 'true');
    }
    bootstrapState.complete = true;
    const swing = getTodaysPicks().length;
    const daily = getTodaysIntradayPicks().length;
    const tracked = getActiveTrackedWallets().length;
    console.log(`Startup complete: ${tracked} wallets, ${swing} swing, ${daily} daily picks`);
  } catch (err) {
    bootstrapState.error = err.message;
    console.error('Startup failed:', err.message);
    if (getActiveTrackedWallets().length > 0) {
      try {
        await refreshSignalsFromCache('startup recovery');
        setMeta('bootstrap_complete', 'true');
        bootstrapState.complete = true;
      } catch (recoveryErr) {
        bootstrapState.error = recoveryErr.message;
      }
    }
  } finally {
    bootstrapState = {
      running: false,
      error: bootstrapState.error,
      complete: bootstrapState.complete || getMeta('bootstrap_complete') === 'true',
    };
    maybeStartBackgroundDiscovery();
  }
}

export async function runManualRefresh(type = 'swing') {
  if (refreshState.running) {
    throw new Error('Refresh already in progress');
  }

  refreshState = {
    running: true,
    phase: 'Updating signals…',
    startedAt: Date.now(),
    error: null,
    results: null,
    source: 'manual',
  };

  const results = {};
  const onPhase = (msg) => setPhase(msg);

  try {
    if (type === 'discovery' || type === 'all') {
      type = 'picks';
    }

    await runSignalLifecycle();

    if (!isWalletDiscoveryEnabled()) {
      const lastRefresh = Number(getMeta('last_curated_refresh') || 0);
      const positionsStale = Math.floor(Date.now() / 1000) - lastRefresh > 6 * 3600;
      if (positionsStale) {
        setPhase('Scanning curated wallet positions…');
        await refreshCuratedWallets({ onProgress: setPhase });
      }
    }

    if (type === 'picks') {
      setPhase('Refreshing swing + daily signals…');
      const batch = await runPicksRefresh(['swing', 'intraday'], {
        quick: true,
        finalPriceCheck: true,
        enforceMinimums: true,
        onPhase,
      });
      results.picks = batch.swing ?? [];
      results.intraday = batch.intraday ?? [];
      setMeta('last_manual_refresh', String(Math.floor(Date.now() / 1000)));
      setMeta('last_picks_count', String(results.picks.length));
      setMeta('last_intraday_count', String(results.intraday.length));
    } else if (type === 'swing') {
      setPhase('Refreshing swing signals…');
      const batch = await runPicksRefresh(['swing'], {
        quick: true,
        finalPriceCheck: true,
        onPhase,
      });
      results.picks = batch.swing ?? [];
      setMeta('last_manual_refresh', String(Math.floor(Date.now() / 1000)));
      setMeta('last_picks_count', String(results.picks.length));
    } else if (type === 'intraday') {
      setPhase('Refreshing daily signals…');
      const batch = await runPicksRefresh(['intraday'], {
        quick: true,
        finalPriceCheck: true,
        onPhase,
      });
      results.intraday = batch.intraday ?? [];
      setMeta('last_manual_refresh', String(Math.floor(Date.now() / 1000)));
      setMeta('last_intraday_count', String(results.intraday.length));
    }

    refreshState.results = {
      picksCount: results.picks?.length ?? null,
      intradayCount: results.intraday?.length ?? null,
    };
    setPhase('done');
    return results;
  } catch (err) {
    refreshState.error = err.message;
    setPhase(`Failed: ${err.message}`);
    throw err;
  } finally {
    refreshState.running = false;
  }
}

export function runManualRefreshAsync(type = 'swing') {
  if (refreshState.running) return false;
  runManualRefresh(type).catch((err) => {
    console.error('Background refresh failed:', err.message);
  });
  return true;
}

export function getLastUpdated() {
  return {
    discovery: getMeta('last_discovery'),
    picks: getMeta('last_picks_generated'),
    manualRefresh: getMeta('last_manual_refresh'),
    discoveryEvaluated: getMeta('last_discovery_evaluated'),
    discoveryQualified: getMeta('last_discovery_qualified'),
    picksCount: getMeta('last_picks_count'),
    intraday: getMeta('last_intraday_generated'),
    intradayCount: getMeta('last_intraday_count'),
    activeWalletCount: getActiveWalletCount(),
    refresh: getRefreshState(),
  };
}

export function getAppStatus() {
  const lastUpdated = getLastUpdated();
  const bootstrap = getBootstrapState();
  const discovery = getDiscoveryState();
  const enterableSwing = getTodaysPicks().length;
  const enterableDaily = getTodaysIntradayPicks().length;
  const db = getDb();
  const rawSwing = db.prepare("SELECT COUNT(*) AS n FROM daily_picks WHERE status = 'ACTIVE'").get()?.n ?? 0;
  const rawDaily = db.prepare("SELECT COUNT(*) AS n FROM intraday_picks WHERE status = 'ACTIVE'").get()?.n ?? 0;
  const walletCount = getActiveWalletCount();
  const trackedCount = getActiveTrackedWallets().length;
  const bootstrapComplete =
    getMeta('bootstrap_complete') === 'true' ||
    (!bootstrap.running && trackedCount > 0 && (enterableSwing > 0 || enterableDaily > 0));

  return {
    ...lastUpdated,
    bootstrapComplete,
    bootstrapRunning: bootstrap.running,
    walletCount,
    trackedWalletCount: trackedCount,
    enterableSwingCount: enterableSwing,
    enterableDailyCount: enterableDaily,
    rawActiveSwingCount: rawSwing,
    rawActiveDailyCount: rawDaily,
    lastError: bootstrap.error || discovery.error || null,
    databasePath: getDbPath(),
    skipBackgroundDiscovery: process.env.SKIP_BACKGROUND_DISCOVERY === 'true',
    walletDiscoveryEnabled: isWalletDiscoveryEnabled(),
    curatedMode: !isWalletDiscoveryEnabled(),
    discovery: discovery.running
      ? {
          phase: discovery.phase,
          evaluated: discovery.evaluated,
          total: discovery.total,
          qualified: discovery.qualified,
        }
      : null,
  };
}
