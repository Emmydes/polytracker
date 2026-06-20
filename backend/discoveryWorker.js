import { fetchPositions, normalizePosition } from './polymarketApi.js';
import { runPicksRefresh } from './recommender.js';
import { runSignalLifecycle } from './signalLifecycle.js';
import {
  setMeta,
  getMeta,
  getActiveTrackedWallets,
  getTodaysPicks,
  getTodaysIntradayPicks,
  upsertTraderPositions,
  ensureCuratedWalletsInDb,
  getCuratedWallets,
  getDb,
} from './db.js';
import {
  CURATED_WALLET_LIST,
  isWalletDiscoveryEnabled,
} from './curatedWallets.js';

const POSITION_CONCURRENCY = 8;

let discoveryState = {
  running: false,
  phase: null,
  error: null,
  evaluated: 0,
  total: 0,
  qualified: 0,
  complete: false,
};

export function getDiscoveryState() {
  if (isWalletDiscoveryEnabled()) {
    return { ...discoveryState, source: 'discovery' };
  }
  const curated = getCuratedWallets();
  return {
    running: false,
    phase: null,
    error: null,
    evaluated: curated.length,
    total: curated.length,
    qualified: getActiveTrackedWallets().length,
    complete: true,
    source: 'curated',
  };
}

/** Ensure curated wallets exist in DB (instant, no API). */
export function seedCuratedWalletsIfNeeded() {
  const existing = getCuratedWallets();
  if (existing.length >= CURATED_WALLET_LIST.length) {
    return { seeded: false, count: existing.length };
  }
  const count = ensureCuratedWalletsInDb(CURATED_WALLET_LIST);
  setMeta('curated_seeded_at', String(Math.floor(Date.now() / 1000)));
  setMeta('curated_wallet_count', String(count));
  console.log(`Seeded ${count} curated wallets into database`);
  return { seeded: true, count };
}

/** Fetch open positions for curated wallets only — no leaderboard scan. */
export async function refreshCuratedWallets(options = {}) {
  const { onProgress = null, forceRefresh = true } = options;
  seedCuratedWalletsIfNeeded();

  const traders = getActiveTrackedWallets();
  const total = traders.length;
  if (total === 0) {
    console.warn('No curated wallets in DB after seed');
    return { wallets: 0, positions: 0 };
  }

  onProgress?.(`Fetching positions for ${total} curated wallets…`);
  console.log(`Refreshing positions for ${total} curated wallets…`);

  let positionCount = 0;
  let done = 0;

  for (let i = 0; i < traders.length; i += POSITION_CONCURRENCY) {
    const chunk = traders.slice(i, i + POSITION_CONCURRENCY);
    await Promise.all(
      chunk.map(async (trader) => {
        try {
          const rawPositions = await fetchPositions(trader.address);
          const normalized = rawPositions
            .map(normalizePosition)
            .filter((p) => p.conditionId && p.size > 0);
          const active = normalized.filter((p) => p.isActive);

          upsertTraderPositions(
            trader.address,
            active.map((p) => ({
              condition_id: p.conditionId,
              market_title: p.marketTitle,
              side: p.side,
              size: p.size,
              avg_price: p.avgPrice,
              entry_timestamp: p.entryTimestamp,
              token_id: p.tokenId,
              fetched_at: Math.floor(Date.now() / 1000),
            }))
          );
          positionCount += active.length;
        } catch (err) {
          console.error(`Failed to fetch positions for ${trader.address}:`, err.message);
        } finally {
          done++;
          onProgress?.(`Positions ${done}/${total}…`);
        }
      })
    );
  }

  setMeta('last_curated_refresh', String(Math.floor(Date.now() / 1000)));
  setMeta('last_curated_positions', String(positionCount));
  console.log(`Curated refresh: ${total} wallets, ${positionCount} open positions`);
  return { wallets: total, positions: positionCount };
}

export async function refreshSignalsFromCache(reason) {
  console.log(`Refreshing signals (${reason})…`);
  await runSignalLifecycle();
  const tracked = getActiveTrackedWallets().length;

  let batch = await runPicksRefresh(['swing', 'intraday'], {
    quick: true,
    finalPriceCheck: tracked >= 8,
    enforceMinimums: true,
  });

  const swingCount = batch.swing?.length ?? 0;
  const dailyCount = batch.intraday?.length ?? 0;

  setMeta('last_manual_refresh', String(Math.floor(Date.now() / 1000)));
  setMeta('last_picks_count', String(swingCount));
  setMeta('last_intraday_count', String(dailyCount));
  console.log(`Signals: ${swingCount} swing, ${dailyCount} daily`);
  return batch;
}

export function needsFullCuratedRefresh() {
  seedCuratedWalletsIfNeeded();
  const db = getDb();
  const positions = db.prepare('SELECT COUNT(*) AS n FROM trader_positions').get().n;
  const tracked = getActiveTrackedWallets().length;
  const curatedCount = getCuratedWallets().length;
  return (
    curatedCount < CURATED_WALLET_LIST.length ||
    tracked < 10 ||
    positions < 50 ||
    getMeta('bootstrap_complete') !== 'true'
  );
}

/** Fast startup: seed curated wallets → fetch positions → generate picks. */
export async function runCuratedStartup(onProgress) {
  onProgress?.('Loading curated wallets…');
  seedCuratedWalletsIfNeeded();

  onProgress?.('Fetching wallet positions…');
  const { wallets, positions } = await refreshCuratedWallets({ onProgress });

  if (wallets === 0) {
    throw new Error('No curated wallets available');
  }

  onProgress?.(`Generating signals (${positions} positions)…`);
  await refreshSignalsFromCache('curated startup');

  setMeta('bootstrap_complete', 'true');
  return { wallets, positions };
}

/** Legacy bootstrap — only when ENABLE_WALLET_DISCOVERY=true. */
export async function runInitialBootstrap(onProgress) {
  if (!isWalletDiscoveryEnabled()) {
    return runCuratedStartup(onProgress);
  }

  const { buildDiscoveryQueue, evaluateWalletBatch } = await import('./traderScorer.js');
  const INITIAL_WALLETS = Number(process.env.BOOTSTRAP_DISCOVERY_LIMIT) || 100;
  const BATCH_SIZE = Number(process.env.DISCOVERY_BATCH_SIZE) || 12;
  const holderMarkets = Number(process.env.BOOTSTRAP_HOLDER_MARKETS) || 15;
  const holdersPer = Number(process.env.BOOTSTRAP_HOLDERS_PER_MARKET) || 10;

  const queue = await buildDiscoveryQueue({
    leaderboardLimit: INITIAL_WALLETS,
    holderMarketCount: holderMarkets,
    holdersPerMarket: holdersPer,
  });
  const total = queue.addresses.length;
  setMeta('discovery_queue_total', String(total));

  const batchSize = Number(process.env.BOOTSTRAP_BATCH_SIZE) || BATCH_SIZE;
  const maxEvaluate = Number(process.env.BOOTSTRAP_MAX_EVALUATE) || total;
  const evaluateLimit = Math.min(total, maxEvaluate);
  let nextIndex = 0;

  onProgress?.(`Loading traders… 0/${evaluateLimit}`);

  while (nextIndex < evaluateLimit) {
    const lastBatch = await evaluateWalletBatch(queue, nextIndex, batchSize, {
      forceRefresh: true,
      onProgress: ({ evaluated }) => {
        onProgress?.(
          `Loading traders… ${nextIndex + evaluated}/${evaluateLimit} (${getActiveTrackedWallets().length} elite)`
        );
      },
    });

    nextIndex += lastBatch.evaluated;
    setMeta('discovery_next_index', String(nextIndex));

    if (getActiveTrackedWallets().length > 0) {
      await refreshSignalsFromCache(`bootstrap ${nextIndex}/${total}`);
      const swing = getTodaysPicks().length;
      const daily = getTodaysIntradayPicks().length;
      if (swing > 0 || daily > 0) break;
    }
    await new Promise((r) => setTimeout(r, 300));
  }

  setMeta('bootstrap_complete', 'true');
  return { evaluated: nextIndex, queueTotal: total };
}

export function maybeStartBackgroundDiscovery() {
  if (!isWalletDiscoveryEnabled()) {
    discoveryState.complete = true;
    discoveryState.running = false;
    discoveryState.phase = null;
    return;
  }
  if (process.env.SKIP_BACKGROUND_DISCOVERY === 'true') {
    discoveryState.complete = true;
    return;
  }
  startBackgroundDiscovery();
}

export function startBackgroundDiscovery() {
  if (!isWalletDiscoveryEnabled()) return;
  if (discoveryState.running || discoveryState.complete) return;
  if (process.env.SKIP_BACKGROUND_DISCOVERY === 'true') return;

  runBackgroundDiscoveryLoop().catch((err) => {
    discoveryState.error = err.message;
    discoveryState.running = false;
    console.error('Background discovery failed:', err.message);
  });
}

async function runBackgroundDiscoveryLoop() {
  const { buildDiscoveryQueue, evaluateWalletBatch } = await import('./traderScorer.js');
  const BATCH_SIZE = Number(process.env.DISCOVERY_BATCH_SIZE) || 12;
  const INITIAL_WALLETS = Number(process.env.BOOTSTRAP_DISCOVERY_LIMIT) || 100;

  const queue = await buildDiscoveryQueue({
    leaderboardLimit: Number(process.env.DISCOVERY_LEADERBOARD_LIMIT) || 100,
    holderMarketCount: Number(process.env.DISCOVERY_HOLDER_MARKETS) || 0,
    holdersPerMarket: Number(process.env.DISCOVERY_HOLDERS_PER_MARKET) || 0,
  });
  const total = queue.addresses.length;
  let nextIndex = Number(getMeta('discovery_next_index') || INITIAL_WALLETS);

  if (nextIndex >= total) {
    discoveryState = { running: false, phase: null, error: null, evaluated: total, total, qualified: getActiveTrackedWallets().length, complete: true };
    return;
  }

  discoveryState = { running: true, phase: null, error: null, evaluated: nextIndex, total, qualified: getActiveTrackedWallets().length, complete: false };

  while (nextIndex < total) {
    const batch = await evaluateWalletBatch(queue, nextIndex, BATCH_SIZE, { forceRefresh: true });
    nextIndex += batch.evaluated;
    discoveryState.evaluated = nextIndex;
    discoveryState.qualified = getActiveTrackedWallets().length;
    setMeta('discovery_next_index', String(nextIndex));

    if (batch.newQualified > 0) {
      try {
        await refreshSignalsFromCache(`+${batch.newQualified} wallets`);
      } catch (err) {
        console.warn('Discovery picks refresh failed:', err.message);
      }
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  discoveryState.running = false;
  discoveryState.complete = true;
  await refreshSignalsFromCache('discovery complete');
}
