import {
  fetchPositions,
  fetchActiveMarkets,
  fetchMarketsClosingWithin,
  fetchMarketByConditionId,
  fetchMarketHolders,
  fetchTokenPrice,
  fetchPriceHistory,
  normalizePosition,
  getMarketLiquidity,
  getMarketCloseDate,
  getMarketUrl,
  getTokenIdForSide,
  getHoursUntilClose,
  calculatePotentialReturn,
  calculateDriftPct,
  sleep,
} from './polymarketApi.js';
import {
  getActiveTrackedWallets,
  saveDailyPicks,
  saveIntradayPicks,
  upsertTraderPositions,
  getPositionsForTrader,
  setMeta,
} from './db.js';

const MIN_CONSENSUS_SWING = 3;
const MIN_DAILY_SIGNALS = 3;
const MIN_DIVERGENCE_START = 0.05;
const MIN_DIVERGENCE_FLOOR = 0.01;
const MAX_PORTFOLIO_PCT = 0.4;
const MIN_LIQUIDITY = 10000;
const MIN_PRICE = 0.01;
const MAX_PRICE = 0.89;
const BEST_VALUE_MIN = 0.1;
const BEST_VALUE_MAX = 0.7;
const DRIFT_SKIP = 25;
const DRIFT_LATE = 15;
const COORDINATION_WINDOW_MS = 4 * 60 * 60 * 1000;
const HOLDERS_PER_MARKET = 30;

const HORIZONS = {
  swing: {
    label: 'swing',
    minConsensus: 3,
    minHoursToClose: 48,
    maxHoursToClose: null,
    marketsToScan: 100,
    maxPicks: 5,
    fetchMarkets: (n) => fetchActiveMarkets(n),
  },
  intraday: {
    label: 'intraday',
    minConsensus: 1,
    minHoursToClose: 1,
    maxHoursToClose: 24,
    marketsToScan: 150,
    maxPicks: 8,
    minSoloPositionSize: 500,
    minSignals: MIN_DAILY_SIGNALS,
    fetchMarkets: () => fetchMarketsClosingWithin(24, 1, 150),
  },
};

function adaptHorizon(horizonKey, walletCount) {
  const base = HORIZONS[horizonKey];
  if (walletCount >= 8) return { ...base };
  if (walletCount >= 4) {
    return {
      ...base,
      minConsensus: Math.min(base.minConsensus, 2),
      minSignals: 1,
    };
  }
  return {
    ...base,
    minConsensus: 1,
    minSignals: 1,
    minSoloPositionSize: horizonKey === 'intraday' ? 50 : base.minSoloPositionSize,
  };
}

export async function generateDailyPicks(options = {}) {
  const r = await runPicksRefresh(['swing'], options);
  return r.swing ?? [];
}

export async function generateIntradayPicks(options = {}) {
  const r = await runPicksRefresh(['intraday'], options);
  return r.intraday ?? [];
}

/** Load positions once, generate one or more horizon pick sets. */
export async function runPicksRefresh(horizonKeys, options = {}) {
  const { quick = false, finalPriceCheck = true, onPhase = null } = options;
  const eliteTraders = getActiveTrackedWallets();

  if (eliteTraders.length === 0) {
    console.log('No active tracked wallets for picks refresh');
    return {};
  }

  onPhase?.('Loading wallet positions…');
  const eliteMap = new Map(eliteTraders.map((t) => [t.address.toLowerCase(), t]));
  const totalTrackedWallets = eliteTraders.length;
  const positionCtx = quick
    ? await loadElitePositionsFast(eliteTraders)
    : await loadElitePositionsParallel(eliteTraders);

  const out = {};
  for (const key of horizonKeys) {
    onPhase?.(key === 'intraday' ? 'Scanning 24h markets…' : 'Scanning swing markets…');
    out[key] = await generatePicksWithContext(key, {
      quick,
      finalPriceCheck,
      eliteMap,
      totalTrackedWallets,
      ...positionCtx,
    });
  }
  return out;
}

async function generatePicks(horizonKey, options = {}) {
  return (await runPicksRefresh([horizonKey], options))[horizonKey] ?? [];
}

async function generatePicksWithContext(horizonKey, ctx) {
  const { quick, finalPriceCheck, eliteMap, totalTrackedWallets, allPositions, portfolioTotals, positionLookup } = ctx;
  const horizon = adaptHorizon(horizonKey, totalTrackedWallets);
  const date = new Date().toISOString().slice(0, 10);

  console.log(`Generating ${horizonKey} picks (quick=${quick})…`);

  const markets = await horizon.fetchMarkets(horizon.marketsToScan);
  console.log(`${horizonKey}: ${markets.length} markets in window`);

  const marketsCache = new Map();
  for (const m of markets) {
    const id = m.conditionId ?? m.condition_id;
    if (id) marketsCache.set(id, m);
  }

  let marketCandidates = [];
  if (!quick) {
    marketCandidates = await scanMarketHolders(
      eliteMap,
      portfolioTotals,
      positionLookup,
      date,
      markets,
      horizon,
      { skipPriceHistory: false, marketsCache, totalTrackedWallets }
    );
  }

  const positionCandidates = await scanPositionOverlap(
    allPositions,
    portfolioTotals,
    date,
    horizon,
    {
      skipPriceHistory: quick,
      marketsCache,
      restrictToCached: quick && horizonKey === 'intraday',
      totalTrackedWallets,
    }
  );

  const merged = mergeCandidates(marketCandidates, positionCandidates);
  merged.sort((a, b) => {
    if (horizonKey === 'intraday') {
      return (a.hours_until_close ?? 999) - (b.hours_until_close ?? 999) || b.confidence - a.confidence;
    }
    return b.confidence - a.confidence || b.score - a.score;
  });

  let topPicks;
  if (horizonKey === 'intraday') {
    topPicks = selectDailySignals(merged, horizon);
  } else {
    topPicks = merged.slice(0, horizon.maxPicks);
  }

  if (finalPriceCheck && topPicks.length > 0) {
    topPicks = await applyFinalPriceCheck(topPicks);
  }

  if (horizonKey === 'intraday') {
    saveIntradayPicks(date, topPicks);
    setMeta('last_intraday_generated', String(Math.floor(Date.now() / 1000)));
    setMeta('last_intraday_count', String(topPicks.length));
  } else {
    saveDailyPicks(date, topPicks);
    setMeta('last_picks_generated', String(Math.floor(Date.now() / 1000)));
    setMeta('last_picks_count', String(topPicks.length));
  }

  console.log(`Generated ${topPicks.length} ${horizonKey} picks`);
  return topPicks;
}

const POSITION_CONCURRENCY = 8;
const POSITION_CACHE_MAX_AGE = 30 * 60;

async function loadElitePositionsFast(eliteTraders) {
  const stale = [];
  const allPositions = [];
  const allForPortfolio = [];
  const positionLookup = new Map();
  const now = Math.floor(Date.now() / 1000);

  for (const trader of eliteTraders) {
    const cached = getPositionsForTrader(trader.address);
    const freshEnough =
      cached.length > 0 && cached.every((p) => now - (p.fetched_at ?? 0) < POSITION_CACHE_MAX_AGE);

    if (freshEnough) {
      for (const p of cached) {
        const pos = {
          conditionId: p.condition_id,
          marketTitle: p.market_title,
          side: p.side,
          size: p.size,
          avgPrice: p.avg_price,
          entryTimestamp: p.entry_timestamp,
          tokenId: p.token_id,
          isActive: true,
        };
        allForPortfolio.push({ address: trader.address, size: pos.size });
        allPositions.push({ ...pos, address: trader.address, winRate: trader.win_rate });
        positionLookup.set(`${trader.address.toLowerCase()}:${pos.conditionId}:${pos.side}`, pos);
      }
    } else {
      stale.push(trader);
    }
  }

  if (stale.length > 0) {
    console.log(`Fast load: refreshing ${stale.length}/${eliteTraders.length} wallets…`);
    const fresh = await loadElitePositionsParallel(stale);
    allPositions.push(...fresh.allPositions);
    allForPortfolio.push(...fresh.allForPortfolio);
    for (const [k, v] of fresh.positionLookup) positionLookup.set(k, v);
  } else {
    console.log(`Fast load: cached positions for ${eliteTraders.length} wallets`);
  }

  return {
    allPositions,
    portfolioTotals: buildPortfolioTotals(allForPortfolio),
    positionLookup,
  };
}

async function loadElitePositionsParallel(eliteTraders) {
  const allPositions = [];
  const allForPortfolio = [];
  const positionLookup = new Map();

  for (let i = 0; i < eliteTraders.length; i += POSITION_CONCURRENCY) {
    const chunk = eliteTraders.slice(i, i + POSITION_CONCURRENCY);
    await Promise.all(
      chunk.map(async (trader) => {
        try {
          const rawPositions = await fetchPositions(trader.address);
          const normalized = rawPositions
            .map(normalizePosition)
            .filter((p) => p.conditionId && p.size > 0);

          for (const p of normalized) {
            allForPortfolio.push({ address: trader.address, size: p.size });
          }

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

          for (const pos of active) {
            allPositions.push({ ...pos, address: trader.address, winRate: trader.win_rate });
            positionLookup.set(`${trader.address.toLowerCase()}:${pos.conditionId}:${pos.side}`, pos);
          }
        } catch (err) {
          console.error(`Failed to fetch positions for ${trader.address}:`, err.message);
        }
      })
    );
  }

  return {
    allPositions,
    allForPortfolio,
    portfolioTotals: buildPortfolioTotals(allForPortfolio),
    positionLookup,
  };
}

async function scanMarketHolders(eliteMap, portfolioTotals, positionLookup, date, markets, horizon, opts = {}) {
  const marketsCache = opts.marketsCache ?? new Map();
  for (const market of markets) {
    const conditionId = market.conditionId ?? market.condition_id;
    if (conditionId) marketsCache.set(conditionId, market);
  }
  const candidates = [];

  for (const market of markets) {
    const conditionId = market.conditionId ?? market.condition_id;
    if (!conditionId) continue;

    if (!passesMarketFilters(market, horizon)) continue;
    marketsCache.set(conditionId, market);

    let holderGroups;
    try {
      holderGroups = await fetchMarketHolders(conditionId, HOLDERS_PER_MARKET);
    } catch (err) {
      console.warn(`Holders failed for ${conditionId.slice(0, 12)}:`, err.message);
      continue;
    }

    for (const group of holderGroups) {
      const side = group.holders?.[0]?.outcomeIndex === 1 ? 'NO' : 'YES';
      const tokenId = group.token ?? group.holders?.[0]?.asset;

      const traders = [];
      for (const holder of group.holders ?? []) {
        const addr = holder.proxyWallet?.toLowerCase();
        const elite = eliteMap.get(addr);
        if (!elite) continue;

        const posKey = `${addr}:${conditionId}:${side}`;
        const pos = positionLookup.get(posKey);
        const size = Number(holder.amount ?? pos?.size ?? 0);
        if (size <= 0) continue;

        traders.push({
          address: holder.proxyWallet,
          size,
          avgPrice: pos?.avgPrice ?? Number(holder.avgPrice ?? 0),
          entryTimestamp: pos?.entryTimestamp ?? 0,
          winRate: elite.win_rate,
        });
      }

      if (traders.length < horizon.minConsensus) continue;

      const portfolioFiltered = filterByPortfolioSize(
        { conditionId, side, marketTitle: market.question, tokenId, traders },
        portfolioTotals
      );
      if (portfolioFiltered.traders.length < horizon.minConsensus) continue;

      const candidate = await buildCandidate(
        portfolioFiltered,
        market,
        tokenId,
        date,
        marketsCache,
        horizon,
        opts
      );
      if (candidate) candidates.push(candidate);
    }

    await sleep(80);
  }

  return candidates;
}

async function scanPositionOverlap(allPositions, portfolioTotals, date, horizon, opts = {}) {
  const marketsCache = opts.marketsCache ?? new Map();
  const restrictToCached = opts.restrictToCached ?? false;
  const grouped = groupPositions(allPositions);
  const candidates = [];

  for (const group of grouped) {
    if (group.traders.length < horizon.minConsensus) continue;
    if (restrictToCached && !marketsCache.has(group.conditionId)) continue;

    const market =
      marketsCache.get(group.conditionId) ?? (await getMarket(group.conditionId, marketsCache));
    if (!market || !passesMarketFilters(market, horizon)) continue;

    if (horizon.minSoloPositionSize && group.traders.length === 1) {
      if (group.traders[0].size < horizon.minSoloPositionSize) continue;
    }

    const portfolioFiltered = filterByPortfolioSize(group, portfolioTotals);
    if (portfolioFiltered.traders.length < horizon.minConsensus) continue;

    const tokenId = portfolioFiltered.tokenId || getTokenIdForSide(market, group.side);
    const candidate = await buildCandidate(
      portfolioFiltered,
      market,
      tokenId,
      date,
      marketsCache,
      horizon,
      opts
    );
    if (candidate) candidates.push(candidate);
  }

  return candidates;
}

function passesMarketFilters(market, horizon) {
  const liquidity = getMarketLiquidity(market);
  if (liquidity < MIN_LIQUIDITY) return false;

  const hoursLeft = getHoursUntilClose(market);
  if (hoursLeft == null) return false;

  if (hoursLeft < horizon.minHoursToClose) return false;
  if (horizon.maxHoursToClose != null && hoursLeft > horizon.maxHoursToClose) return false;

  return true;
}

async function buildCandidate(group, market, tokenId, date, marketsCache, horizon, opts = {}) {
  const skipPriceHistory = opts.skipPriceHistory ?? false;
  const coordination = detectCoordinatedEntry(group.traders, horizon.minConsensus);
  if (!tokenId) tokenId = getTokenIdForSide(market, group.side);
  if (!tokenId) return null;

  const entryPrices = [];
  for (const t of group.traders) {
    let ep = t.avgPrice;
    if (!skipPriceHistory && (!ep || ep <= 0) && t.entryTimestamp) {
      ep = await fetchPriceHistory(tokenId, t.entryTimestamp);
    }
    if (ep && ep > 0) entryPrices.push(ep);
  }

  const avgEntryPrice = entryPrices.length
    ? entryPrices.reduce((a, b) => a + b, 0) / entryPrices.length
    : group.traders.reduce((s, t) => s + (t.avgPrice || 0), 0) / group.traders.length;

  let currentPrice = await fetchTokenPrice(tokenId);
  if (currentPrice === null && avgEntryPrice > 0) currentPrice = avgEntryPrice;
  if (currentPrice === null) return null;

  if (currentPrice < MIN_PRICE || currentPrice > MAX_PRICE) return null;

  const driftPct = calculateDriftPct(avgEntryPrice, currentPrice);
  if (driftPct > DRIFT_SKIP) return null;

  const avgWinRate = group.traders.reduce((s, t) => s + t.winRate, 0) / group.traders.length;
  const liquidity = getMarketLiquidity(market);
  const liquidityScore = Math.min(liquidity / 10000, 5);
  const score = group.traders.length * 3 + avgWinRate * 2 + liquidityScore;
  const hoursUntilClose = getHoursUntilClose(market);
  const totalTracked = opts.totalTrackedWallets ?? 1;
  const divergenceScore = Math.min(Math.abs(driftPct) / 15, 1);
  const confidence = computeConfidence(group.traders.length, totalTracked, avgWinRate, divergenceScore);
  const strength = computeStrength(confidence, group.traders.length);

  return {
    date,
    signal_date: date,
    market_id: group.conditionId,
    market_title: market.question ?? market.title ?? group.marketTitle,
    recommended_side: group.side,
    current_price: currentPrice,
    entry_price: avgEntryPrice || currentPrice,
    drift_pct: driftPct,
    potential_return: calculatePotentialReturn(currentPrice),
    is_late_entry: driftPct >= DRIFT_LATE ? 1 : 0,
    is_best_value: currentPrice >= BEST_VALUE_MIN && currentPrice <= BEST_VALUE_MAX ? 1 : 0,
    elite_trader_count: group.traders.length,
    avg_win_rate: avgWinRate,
    liquidity,
    market_url: getMarketUrl(market),
    close_date: getMarketCloseDate(market),
    hours_until_close: hoursUntilClose,
    coordination_flag: coordination ? 1 : 0,
    created_at: Math.floor(Date.now() / 1000),
    entry_window_close: null,
    status: 'ACTIVE',
    confidence,
    strength,
    token_id: tokenId,
    score,
    tokenId,
  };
}

function computeConfidence(traderCount, totalTracked, avgWinRate, divergenceScore) {
  const participation = totalTracked > 0 ? traderCount / totalTracked : 0;
  const raw =
    participation * 0.4 + avgWinRate * 0.4 + divergenceScore * 0.2;
  return Math.round(Math.min(100, Math.max(0, raw * 100)));
}

function computeStrength(confidence, traderCount) {
  if (confidence >= 75 || traderCount >= 5) return 'STRONG';
  if (confidence >= 50 || traderCount >= 3) return 'MODERATE';
  return 'WEAK';
}

function selectDailySignals(candidates, horizon) {
  const minRequired = horizon.minSignals ?? MIN_DAILY_SIGNALS;
  let minDiv = MIN_DIVERGENCE_START;
  let filtered = [];

  while (minDiv >= MIN_DIVERGENCE_FLOOR) {
    filtered = candidates.filter((c) => {
      const div = Math.abs(c.drift_pct ?? 0) / 100;
      return div >= minDiv;
    });
    if (filtered.length >= minRequired) break;
    minDiv -= 0.02;
  }

  if (filtered.length < minRequired) {
    filtered = candidates;
  }

  return filtered.slice(0, Math.min(horizon.maxPicks, filtered.length));
}

function mergeCandidates(...lists) {
  const map = new Map();
  for (const list of lists) {
    for (const c of list) {
      const key = `${c.market_id}:${c.recommended_side}`;
      const existing = map.get(key);
      if (!existing || c.score > existing.score) map.set(key, c);
    }
  }
  return [...map.values()];
}

async function applyFinalPriceCheck(picks) {
  const verified = [];
  for (const pick of picks) {
    try {
      const livePrice = await fetchTokenPrice(pick.tokenId);
      if (livePrice === null) continue;
      if (livePrice < MIN_PRICE || livePrice > MAX_PRICE) continue;

      const driftPct = calculateDriftPct(pick.entry_price, livePrice);
      if (driftPct > DRIFT_SKIP) continue;

      verified.push({
        ...pick,
        current_price: livePrice,
        drift_pct: driftPct,
        potential_return: calculatePotentialReturn(livePrice),
        is_late_entry: driftPct >= DRIFT_LATE ? 1 : 0,
        is_best_value: livePrice >= BEST_VALUE_MIN && livePrice <= BEST_VALUE_MAX ? 1 : 0,
      });
    } catch (err) {
      console.error(`Final price check failed for ${pick.market_id}:`, err.message);
    }
  }
  return verified;
}

function groupPositions(positions) {
  const map = new Map();
  for (const pos of positions) {
    const key = `${pos.conditionId}:${pos.side}`;
    if (!map.has(key)) {
      map.set(key, {
        conditionId: pos.conditionId,
        side: pos.side,
        marketTitle: pos.marketTitle,
        tokenId: pos.tokenId,
        traders: [],
      });
    }
    const group = map.get(key);
    group.traders.push({
      address: pos.address,
      size: pos.size,
      avgPrice: pos.avgPrice,
      entryTimestamp: pos.entryTimestamp,
      winRate: pos.winRate,
    });
    if (!group.tokenId && pos.tokenId) group.tokenId = pos.tokenId;
  }
  return [...map.values()];
}

async function getMarket(conditionId, cache) {
  if (cache.has(conditionId)) return cache.get(conditionId);
  let market = await fetchMarketByConditionId(conditionId);
  if (!market) {
    const markets = await fetchActiveMarkets(200);
    market = markets.find((m) => m.conditionId === conditionId || m.condition_id === conditionId);
  }
  cache.set(conditionId, market ?? null);
  return market ?? null;
}

function buildPortfolioTotals(positions) {
  const totals = new Map();
  for (const pos of positions) {
    totals.set(pos.address, (totals.get(pos.address) ?? 0) + pos.size);
  }
  return totals;
}

function filterByPortfolioSize(group, portfolioTotals) {
  const filtered = group.traders.filter((t) => {
    const total = portfolioTotals.get(t.address) || t.size;
    const pct = total > 0 ? t.size / total : 1;
    return pct <= MAX_PORTFOLIO_PCT;
  });
  return { ...group, traders: filtered };
}

function detectCoordinatedEntry(traders, minConsensus = 2) {
  const timestamps = traders
    .map((t) => t.entryTimestamp)
    .filter((ts) => ts && ts > 0)
    .sort((a, b) => a - b);

  if (timestamps.length < minConsensus) return false;

  const windowStart = timestamps[0];
  const windowEnd = windowStart + COORDINATION_WINDOW_MS;
  return timestamps.filter((ts) => ts <= windowEnd).length >= minConsensus;
}
