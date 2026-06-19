import { buildDiscoveryQueue, evaluateWalletBatch } from './traderScorer.js';
import { runPicksRefresh } from './recommender.js';
import { runSignalLifecycle } from './signalLifecycle.js';
import { setMeta, getMeta, getActiveTrackedWallets } from './db.js';

const INITIAL_WALLETS = Number(process.env.BOOTSTRAP_DISCOVERY_LIMIT) || 100;
const BATCH_SIZE = Number(process.env.DISCOVERY_BATCH_SIZE) || 12;
const PICKS_EVERY_BATCHES = 1;

let discoveryState = {
  running: false,
  phase: null,
  error: null,
  evaluated: 0,
  total: 0,
  qualified: 0,
  complete: false,
};

let queueCache = null;

export function getDiscoveryState() {
  return { ...discoveryState, source: 'discovery' };
}

function updatePhase() {
  const { evaluated, total, qualified } = discoveryState;
  if (discoveryState.complete) {
    discoveryState.phase = null;
    return;
  }
  if (total === 0) {
    discoveryState.phase = null;
    return;
  }
  discoveryState.phase = `Background scan… ${evaluated}/${total} (${qualified} elite)`;
}

async function getQueue() {
  if (queueCache) return queueCache;
  queueCache = await buildDiscoveryQueue({
    leaderboardLimit: Number(process.env.DISCOVERY_LEADERBOARD_LIMIT) || 100,
    holderMarketCount: Number(process.env.DISCOVERY_HOLDER_MARKETS) || 0,
    holdersPerMarket: Number(process.env.DISCOVERY_HOLDERS_PER_MARKET) || 0,
  });
  setMeta('discovery_queue_total', String(queueCache.addresses.length));
  return queueCache;
}

export async function refreshSignalsFromCache(reason) {
  console.log(`Refreshing signals (${reason})…`);
  await runSignalLifecycle();
  const batch = await runPicksRefresh(['swing', 'intraday'], {
    quick: true,
    finalPriceCheck: true,
  });
  setMeta('last_manual_refresh', String(Math.floor(Date.now() / 1000)));
  setMeta('last_picks_count', String(batch.swing?.length ?? 0));
  setMeta('last_intraday_count', String(batch.intraday?.length ?? 0));
  console.log(`Signals: ${batch.swing?.length ?? 0} swing, ${batch.intraday?.length ?? 0} daily`);
  return batch;
}

/** Fast first pass: scan leaderboard in small batches and publish signals as wallets qualify. */
export async function runInitialBootstrap(onProgress) {
  const queue = await buildDiscoveryQueue({
    leaderboardLimit: INITIAL_WALLETS,
    holderMarketCount: 0,
    holdersPerMarket: 0,
  });
  queueCache = queue;
  const total = queue.addresses.length;
  setMeta('discovery_queue_total', String(total));

  const batchSize = Number(process.env.BOOTSTRAP_BATCH_SIZE) || BATCH_SIZE;
  let nextIndex = 0;
  let lastBatch = { evaluated: 0, qualified: 0, newQualified: 0 };

  onProgress?.(`Loading traders… 0/${total}`);

  while (nextIndex < total) {
    lastBatch = await evaluateWalletBatch(queue, nextIndex, batchSize, {
      forceRefresh: true,
      onProgress: ({ evaluated }) => {
        onProgress?.(
          `Loading traders… ${nextIndex + evaluated}/${total} (${getActiveTrackedWallets().length} elite)`
        );
      },
    });

    nextIndex += lastBatch.evaluated;
    setMeta('discovery_next_index', String(nextIndex));
    setMeta('last_discovery_evaluated', String(nextIndex));
    setMeta('last_discovery_qualified', String(getActiveTrackedWallets().length));

    const trackedCount = getActiveTrackedWallets().length;
    if (trackedCount > 0) {
      onProgress?.(`Generating signals… (${trackedCount} elite wallets)`);
      try {
        await refreshSignalsFromCache(`bootstrap ${nextIndex}/${total}`);
      } catch (err) {
        console.warn(`Bootstrap picks refresh at ${nextIndex}/${total} failed:`, err.message);
      }
    }

    console.log(`Bootstrap batch: ${nextIndex}/${total} scanned, ${trackedCount} tracked elite`);
    await new Promise((r) => setTimeout(r, 300));
  }

  setMeta('last_discovery', String(Math.floor(Date.now() / 1000)));
  setMeta('bootstrap_complete', 'true');

  if (getActiveTrackedWallets().length > 0) {
    onProgress?.('Final signal refresh…');
    await refreshSignalsFromCache('initial bootstrap complete');
  }

  return { ...lastBatch, queueTotal: total, evaluated: nextIndex };
}

export function maybeStartBackgroundDiscovery() {
  if (process.env.SKIP_BACKGROUND_DISCOVERY === 'true') {
    discoveryState.complete = true;
    discoveryState.running = false;
    discoveryState.phase = null;
    return;
  }
  startBackgroundDiscovery();
}

export function startBackgroundDiscovery() {
  if (discoveryState.running || discoveryState.complete) return;
  if (process.env.SKIP_BACKGROUND_DISCOVERY === 'true') return;

  runBackgroundDiscoveryLoop().catch((err) => {
    discoveryState.error = err.message;
    discoveryState.running = false;
    console.error('Background discovery failed:', err.message);
  });
}

async function runBackgroundDiscoveryLoop() {
  const queue = await getQueue();
  const total = queue.addresses.length;
  let nextIndex = Number(getMeta('discovery_next_index') || INITIAL_WALLETS);

  if (nextIndex >= total) {
    discoveryState = {
      running: false,
      phase: null,
      error: null,
      evaluated: total,
      total,
      qualified: getActiveTrackedWallets().length,
      complete: true,
    };
    return;
  }

  discoveryState = {
    running: true,
    phase: null,
    error: null,
    evaluated: nextIndex,
    total,
    qualified: getActiveTrackedWallets().length,
    complete: false,
  };
  updatePhase();
  console.log(`Background discovery: ${nextIndex}/${total}`);

  let batchesSincePicks = 0;

  while (nextIndex < total) {
    const batch = await evaluateWalletBatch(queue, nextIndex, BATCH_SIZE, {
      forceRefresh: true,
    });

    nextIndex += batch.evaluated;
    discoveryState.evaluated = nextIndex;
    discoveryState.qualified = getActiveTrackedWallets().length;
    setMeta('discovery_next_index', String(nextIndex));
    setMeta('last_discovery_evaluated', String(nextIndex));
    setMeta('last_discovery_qualified', String(discoveryState.qualified));
    updatePhase();

    batchesSincePicks++;
    if (batch.newQualified > 0 && batchesSincePicks >= PICKS_EVERY_BATCHES) {
      try {
        await refreshSignalsFromCache(`+${batch.newQualified} wallets`);
        batchesSincePicks = 0;
      } catch (err) {
        console.warn('Discovery picks refresh failed:', err.message);
      }
    }

    await new Promise((r) => setTimeout(r, 500));
  }

  discoveryState.running = false;
  discoveryState.complete = true;
  discoveryState.phase = null;
  console.log(`Background discovery complete: ${discoveryState.qualified} elite of ${total} scanned`);

  try {
    await refreshSignalsFromCache('discovery complete');
  } catch (err) {
    console.warn('Final discovery picks refresh failed:', err.message);
  }
}
