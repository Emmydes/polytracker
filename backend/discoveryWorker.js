import { buildDiscoveryQueue, evaluateWalletBatch } from './traderScorer.js';
import { runPicksRefresh } from './recommender.js';
import { runSignalLifecycle } from './signalLifecycle.js';
import { setMeta, getMeta, getActiveWalletCount } from './db.js';

const INITIAL_WALLETS = Number(process.env.BOOTSTRAP_DISCOVERY_LIMIT) || 60;
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
    discoveryState.phase = `Background scan complete — ${qualified} elite traders tracked`;
    return;
  }
  if (total === 0) {
    discoveryState.phase = 'Preparing wallet list…';
    return;
  }
  discoveryState.phase = `Background scan… ${evaluated}/${total} (${qualified} elite)`;
}

async function getQueue() {
  if (queueCache) return queueCache;
  queueCache = await buildDiscoveryQueue({
    leaderboardLimit: Number(process.env.DISCOVERY_LEADERBOARD_LIMIT) || 100,
    holderMarketCount: Number(process.env.DISCOVERY_HOLDER_MARKETS) || 25,
    holdersPerMarket: Number(process.env.DISCOVERY_HOLDERS_PER_MARKET) || 15,
  });
  setMeta('discovery_queue_total', String(queueCache.addresses.length));
  return queueCache;
}

async function refreshSignalsFromCache(reason) {
  console.log(`Discovery: refreshing signals (${reason})…`);
  await runSignalLifecycle();
  const batch = await runPicksRefresh(['swing', 'intraday'], {
    quick: true,
    finalPriceCheck: true,
  });
  setMeta('last_manual_refresh', String(Math.floor(Date.now() / 1000)));
  setMeta('last_picks_count', String(batch.swing?.length ?? 0));
  setMeta('last_intraday_count', String(batch.intraday?.length ?? 0));
  return batch;
}

/** Fast first pass: scan initial wallets and publish first signals. */
export async function runInitialBootstrap(onProgress) {
  const queue = await getQueue();
  const batchSize = Math.min(INITIAL_WALLETS, queue.addresses.length);

  onProgress?.(`Scanning wallets… 0/${batchSize}`);
  const batch = await evaluateWalletBatch(queue, 0, batchSize, {
    forceRefresh: true,
    onProgress: ({ evaluated, total, qualified }) => {
      onProgress?.(`Scanning wallets… ${evaluated}/${total} (${qualified} qualified)`);
    },
  });

  setMeta('discovery_next_index', String(batchSize));
  setMeta('last_discovery', String(Math.floor(Date.now() / 1000)));
  setMeta('last_discovery_evaluated', String(batchSize));
  setMeta('last_discovery_qualified', String(getActiveWalletCount()));

  onProgress?.('Generating signals…');
  await refreshSignalsFromCache('initial bootstrap');

  return { ...batch, queueTotal: queue.addresses.length };
}

export function startBackgroundDiscovery() {
  if (discoveryState.running || discoveryState.complete) return;
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
      phase: `Background scan complete — ${getActiveWalletCount()} elite traders`,
      error: null,
      evaluated: total,
      total,
      qualified: getActiveWalletCount(),
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
    qualified: getActiveWalletCount(),
    complete: false,
  };
  updatePhase();
  console.log(`Background discovery: resuming at ${nextIndex}/${total}`);

  let batchesSincePicks = 0;

  while (nextIndex < total) {
    const batch = await evaluateWalletBatch(queue, nextIndex, BATCH_SIZE, {
      forceRefresh: true,
      onProgress: ({ evaluated }) => {
        discoveryState.evaluated = nextIndex + evaluated;
        discoveryState.qualified = getActiveWalletCount();
        updatePhase();
      },
    });

    nextIndex += batch.evaluated;
    discoveryState.evaluated = nextIndex;
    discoveryState.qualified = getActiveWalletCount();
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
  discoveryState.evaluated = total;
  discoveryState.qualified = getActiveWalletCount();
  updatePhase();
  console.log(`Background discovery complete: ${discoveryState.qualified} elite of ${total} scanned`);

  try {
    await refreshSignalsFromCache('discovery complete');
  } catch (err) {
    console.warn('Final discovery picks refresh failed:', err.message);
  }
}
