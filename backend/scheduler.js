import cron from 'node-cron';
import { runTraderDiscovery } from './traderScorer.js';
import { runPicksRefresh, generateDailyPicks, generateIntradayPicks } from './recommender.js';
import { sendDailyPicksAlert } from './telegram.js';
import { setMeta, getMeta, getActiveWalletCount } from './db.js';
import { runSignalLifecycle } from './signalLifecycle.js';

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

export function getRefreshState() {
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
  if (walletCount > 0 && picksCount && Number(picksCount) > 0) {
    console.log(`Bootstrap skipped: ${walletCount} active wallets, ${picksCount} picks cached`);
    return;
  }

  if (bootstrapState.running) return;

  const isRender = Boolean(process.env.RENDER);
  const discoveryLimit = Number(process.env.BOOTSTRAP_DISCOVERY_LIMIT) || (isRender ? 50 : 120);

  bootstrapState = { running: true, phase: 'Starting wallet scan…', error: null };
  console.log(`Bootstrap: discovery limit ${discoveryLimit}${isRender ? ' (Render fast mode)' : ''}...`);

  try {
    bootstrapState.phase = 'Scanning wallets… 0/?';
    const discovery = await runTraderDiscovery({
      limit: discoveryLimit,
      forceRefresh: true,
      onProgress: ({ evaluated, total, qualified }) => {
        bootstrapState.phase = `Scanning wallets… ${evaluated}/${total} (${qualified} qualified)`;
      },
    });
    setMeta('last_discovery', String(Math.floor(Date.now() / 1000)));
    setMeta('last_discovery_evaluated', String(discovery.evaluated));
    setMeta('last_discovery_qualified', String(discovery.qualified));
    console.log(`Bootstrap discovery: ${discovery.qualified}/${discovery.evaluated} qualified`);

    bootstrapState.phase = 'Generating signals…';
    await runSignalLifecycle();
    const batch = await runPicksRefresh(['swing', 'intraday'], {
      quick: true,
      finalPriceCheck: true,
    });
    setMeta('last_manual_refresh', String(Math.floor(Date.now() / 1000)));
    setMeta('last_picks_count', String(batch.swing?.length ?? 0));
    setMeta('last_intraday_count', String(batch.intraday?.length ?? 0));
    console.log(`Bootstrap picks: ${batch.swing?.length ?? 0} swing, ${batch.intraday?.length ?? 0} daily`);
    console.log('Bootstrap complete');
  } catch (err) {
    bootstrapState.error = err.message;
    console.error('Bootstrap failed:', err.message);
  } finally {
    bootstrapState = { running: false, phase: null, error: bootstrapState.error };
  }
}

export async function runManualRefresh(type = 'all') {
  if (refreshState.running) {
    throw new Error('Refresh already in progress');
  }

  refreshState = {
    running: true,
    phase: 'starting',
    startedAt: Date.now(),
    error: null,
    results: null,
    source: 'manual',
  };

  const results = {};
  const onPhase = (msg) => setPhase(msg);

  try {
    if (type === 'all' || type === 'discovery') {
      const isRender = Boolean(process.env.RENDER);
      const discoveryLimit = Number(process.env.BOOTSTRAP_DISCOVERY_LIMIT) || (isRender ? 50 : 120);
      setPhase('Scanning wallets… 0/?');
      console.log('Starting trader discovery...');
      results.discovery = await runTraderDiscovery({
        limit: discoveryLimit,
        forceRefresh: true,
        onProgress: ({ evaluated, total, qualified }) => {
          setPhase(`Scanning wallets… ${evaluated}/${total} (${qualified} qualified)`);
        },
      });
      setMeta('last_discovery', String(Math.floor(Date.now() / 1000)));
      setMeta('last_discovery_evaluated', String(results.discovery.evaluated));
      setMeta('last_discovery_qualified', String(results.discovery.qualified));
      console.log(`Discovery: ${results.discovery.qualified}/${results.discovery.evaluated} qualified`);
    }

    if (type === 'all') {
      setPhase('Generating all picks…');
      await runSignalLifecycle();
      const batch = await runPicksRefresh(['swing', 'intraday'], {
        quick: true,
        finalPriceCheck: true,
        onPhase,
      });
      results.picks = batch.swing ?? [];
      results.intraday = batch.intraday ?? [];
      await sendDailyPicksAlert(results.picks, 'swing');
      setMeta('last_manual_refresh', String(Math.floor(Date.now() / 1000)));
    } else if (type === 'picks') {
      setPhase('Generating swing + today picks…');
      await runSignalLifecycle();
      const batch = await runPicksRefresh(['swing', 'intraday'], {
        quick: true,
        finalPriceCheck: true,
        onPhase,
      });
      results.picks = batch.swing ?? [];
      results.intraday = batch.intraday ?? [];
      setMeta('last_manual_refresh', String(Math.floor(Date.now() / 1000)));
    } else if (type === 'swing') {
      await runSignalLifecycle();
      const batch = await runPicksRefresh(['swing'], {
        quick: true,
        finalPriceCheck: true,
        onPhase,
      });
      results.picks = batch.swing ?? [];
      setMeta('last_manual_refresh', String(Math.floor(Date.now() / 1000)));
    } else if (type === 'intraday') {
      await runSignalLifecycle();
      const batch = await runPicksRefresh(['intraday'], {
        quick: true,
        finalPriceCheck: true,
        onPhase,
      });
      results.intraday = batch.intraday ?? [];
      setMeta('last_manual_refresh', String(Math.floor(Date.now() / 1000)));
    }

    refreshState.results = {
      discovery: results.discovery
        ? { evaluated: results.discovery.evaluated, qualified: results.discovery.qualified }
        : null,
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

export function runManualRefreshAsync(type = 'all') {
  if (bootstrapState.running || refreshState.running) return false;
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
