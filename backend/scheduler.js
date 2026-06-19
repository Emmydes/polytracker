import cron from 'node-cron';
import { runTraderDiscovery } from './traderScorer.js';
import { runPicksRefresh, generateDailyPicks, generateIntradayPicks } from './recommender.js';
import { sendDailyPicksAlert } from './telegram.js';
import { setMeta, getMeta, getActiveWalletCount, getActiveTrackedWallets } from './db.js';
import { runSignalLifecycle } from './signalLifecycle.js';
import {
  runInitialBootstrap,
  maybeStartBackgroundDiscovery,
  refreshSignalsFromCache,
} from './discoveryWorker.js';

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
};

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
  cron.schedule('0 0 * * *', async () => {
    console.log('[cron] Starting midnight trader discovery...');
    try {
      const result = await runTraderDiscovery({ limit: 200, forceRefresh: true });
      setMeta('last_discovery', String(Math.floor(Date.now() / 1000)));
      setMeta('last_discovery_evaluated', String(result.evaluated));
      setMeta('last_discovery_qualified', String(result.qualified));
      console.log(`[cron] Discovery complete: ${result.qualified}/${result.evaluated} qualified`);
    } catch (err) {
      console.error('[cron] Discovery failed:', err.message);
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

  console.log('Scheduler started: discovery @ midnight, swing @ 7AM, intraday @ 8/12/4/8PM, lifecycle every 15m');
}

export async function bootstrapIfEmpty() {
  const tracked = getActiveTrackedWallets().length;
  const picksCount = Number(getMeta('last_picks_count') || 0);
  const intradayCount = Number(getMeta('last_intraday_count') || 0);
  const hasPicks = picksCount > 0 || intradayCount > 0;

  if (tracked > 0 && hasPicks) {
    console.log(`Bootstrap skipped: ${tracked} wallets, ${picksCount} swing / ${intradayCount} daily`);
    maybeStartBackgroundDiscovery();
    return;
  }

  if (tracked > 0 && !hasPicks) {
    console.log(`Bootstrap: ${tracked} wallets cached — generating signals`);
    try {
      await refreshSignalsFromCache('startup');
    } catch (err) {
      console.error('Startup picks refresh failed:', err.message);
    }
    maybeStartBackgroundDiscovery();
    return;
  }

  if (bootstrapState.running) return;

  bootstrapState = { running: true, error: null };
  console.log('Bootstrap: loading traders and generating first signals…');

  try {
    await runInitialBootstrap();
    console.log('Bootstrap complete');
  } catch (err) {
    bootstrapState.error = err.message;
    console.error('Bootstrap failed:', err.message);
  } finally {
    bootstrapState = { running: false, error: bootstrapState.error };
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

    if (type === 'picks') {
      setPhase('Refreshing swing + daily signals…');
      const batch = await runPicksRefresh(['swing', 'intraday'], {
        quick: true,
        finalPriceCheck: true,
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
