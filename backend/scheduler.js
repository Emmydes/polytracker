import cron from 'node-cron';
import { runTraderDiscovery } from './traderScorer.js';
import { runPicksRefresh, generateDailyPicks, generateIntradayPicks } from './recommender.js';
import { sendDailyPicksAlert } from './telegram.js';
import { setMeta, getMeta, getActiveWalletCount } from './db.js';
import { runSignalLifecycle } from './signalLifecycle.js';
import {
  runInitialBootstrap,
  startBackgroundDiscovery,
  getDiscoveryState,
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
  phase: null,
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

export function getRefreshState() {
  if (refreshState.running) {
    return { ...refreshState };
  }
  if (bootstrapState.running) {
    return {
      running: true,
      phase: bootstrapState.phase ?? 'Starting wallet scan…',
      startedAt: null,
      error: bootstrapState.error,
      results: null,
      source: 'bootstrap',
    };
  }
  const discovery = getDiscoveryState();
  if (discovery.running) {
    return {
      running: true,
      phase: discovery.phase,
      startedAt: null,
      error: discovery.error,
      results: null,
      source: 'discovery',
      evaluated: discovery.evaluated,
      total: discovery.total,
      qualified: discovery.qualified,
    };
  }
  return { ...refreshState };
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
  const walletCount = getActiveWalletCount();
  const picksCount = getMeta('last_picks_count');
  const discoveryIndex = Number(getMeta('discovery_next_index') || 0);
  if (walletCount > 0 && picksCount && Number(picksCount) > 0 && discoveryIndex > 0) {
    console.log(`Bootstrap skipped: ${walletCount} active wallets, ${picksCount} picks cached`);
    startBackgroundDiscovery();
    return;
  }

  if (bootstrapState.running) return;

  bootstrapState = { running: true, phase: 'Starting wallet scan…', error: null };
  console.log('Bootstrap: quick initial scan then background discovery…');

  try {
    await runInitialBootstrap((phase) => {
      bootstrapState.phase = phase;
    });
    console.log('Bootstrap initial pass complete — starting background discovery');
  } catch (err) {
    bootstrapState.error = err.message;
    console.error('Bootstrap failed:', err.message);
  } finally {
    bootstrapState = { running: false, phase: null, error: bootstrapState.error };
    startBackgroundDiscovery();
  }
}

export async function runManualRefresh(type = 'swing') {
  if (refreshState.running) {
    throw new Error('Refresh already in progress');
  }

  refreshState = {
    running: true,
    phase: 'Updating signals from tracked wallets…',
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
  const discovery = getDiscoveryState();
  return {
    discovery: getMeta('last_discovery'),
    picks: getMeta('last_picks_generated'),
    manualRefresh: getMeta('last_manual_refresh'),
    discoveryEvaluated: getMeta('last_discovery_evaluated'),
    discoveryQualified: getMeta('last_discovery_qualified'),
    discoveryQueueTotal: getMeta('discovery_queue_total'),
    discoveryNextIndex: getMeta('discovery_next_index'),
    picksCount: getMeta('last_picks_count'),
    intraday: getMeta('last_intraday_generated'),
    intradayCount: getMeta('last_intraday_count'),
    activeWalletCount: getActiveWalletCount(),
    refresh: getRefreshState(),
    backgroundDiscovery: {
      running: discovery.running,
      complete: discovery.complete,
      phase: discovery.phase,
      evaluated: discovery.evaluated,
      total: discovery.total,
      qualified: discovery.qualified,
    },
  };
}
