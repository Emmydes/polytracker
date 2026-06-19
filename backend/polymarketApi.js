import axios from 'axios';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), '../.env') });

const DATA_API = process.env.POLYMARKET_DATA_API || 'https://data-api.polymarket.com';
const GAMMA_API = process.env.POLYMARKET_GAMMA_API || 'https://gamma-api.polymarket.com';
const CLOB_API = process.env.POLYMARKET_CLOB_API || 'https://clob.polymarket.com';

const WALLET_DELAY_MS = 200;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

const dataClient = axios.create({ baseURL: DATA_API, timeout: 30000 });
const gammaClient = axios.create({ baseURL: GAMMA_API, timeout: 30000 });
const clobClient = axios.create({ baseURL: CLOB_API, timeout: 30000 });

let lastWalletRequestAt = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function throttleWalletRequest() {
  const now = Date.now();
  const elapsed = now - lastWalletRequestAt;
  if (elapsed < WALLET_DELAY_MS) {
    await sleep(WALLET_DELAY_MS - elapsed);
  }
  lastWalletRequestAt = Date.now();
}

async function withRetry(fn, label = 'request') {
  let lastError;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const status = err.response?.status;
      if (status === 404 || status === 400) throw err;
      if (attempt < MAX_RETRIES) {
        await sleep(RETRY_DELAY_MS * attempt);
      }
    }
  }
  throw new Error(`${label} failed after ${MAX_RETRIES} attempts: ${lastError.message}`);
}

export async function fetchLeaderboard(limit = 200) {
  const pageSize = 50;
  const all = [];
  let offset = 0;

  while (all.length < limit) {
    const batch = await withRetry(async () => {
      const { data } = await dataClient.get('/v1/leaderboard', {
        params: {
          category: 'OVERALL',
          timePeriod: 'MONTH',
          orderBy: 'PNL',
          limit: Math.min(pageSize, limit - all.length),
          offset,
        },
      });
      return Array.isArray(data) ? data : [];
    }, `leaderboard:${offset}`);

    if (batch.length === 0) break;
    all.push(...batch);
    offset += batch.length;
    if (batch.length < pageSize) break;
    await sleep(100);
  }

  return all.slice(0, limit);
}

export async function fetchPnl(address) {
  await throttleWalletRequest();

  try {
    return await withRetry(async () => {
      const { data } = await dataClient.get('/pnl', { params: { user: address } });
      return normalizePnl(data);
    }, `pnl:${address.slice(0, 8)}`);
  } catch (err) {
    if (err.response?.status !== 404) throw err;
  }

  return computePnlFromClosedPositions(address);
}

export async function fetchClosedPositions(address, limit = 200, offset = 0) {
  await throttleWalletRequest();
  return withRetry(async () => {
    const { data } = await dataClient.get('/closed-positions', {
      params: {
        user: address,
        limit: Math.min(limit, 50),
        offset,
        sortBy: 'TIMESTAMP',
        sortDirection: 'DESC',
      },
    });
    return Array.isArray(data) ? data : [];
  }, `closed:${address.slice(0, 8)}:${offset}`);
}

async function computePnlFromClosedPositions(address) {
  const positions = [];
  let offset = 0;
  const pageSize = 50;
  const maxPages = 12;

  for (let page = 0; page < maxPages; page++) {
    const batch = await fetchClosedPositions(address, pageSize, offset);
    if (!batch.length) break;
    positions.push(...batch);
    offset += batch.length;
    if (batch.length < pageSize) break;
    await sleep(100);
  }

  let totalProfit = 0;
  let wins = 0;
  let losses = 0;
  for (const pos of positions) {
    const pnl = Number(pos.realizedPnl ?? pos.realized_pnl ?? 0);
    totalProfit += pnl;
    if (isWinningClosedPosition(pos)) wins++;
    else if (isLosingClosedPosition(pos)) losses++;
  }

  const resolvedTrades = positions.length;
  const decisive = wins + losses;
  const winRate = decisive > 0 ? wins / decisive : (resolvedTrades > 0 ? wins / resolvedTrades : 0);

  return {
    totalProfit,
    winRate,
    totalTrades: resolvedTrades,
    resolvedTrades,
    closedPositions: positions,
    avgRoi: computeAvgRoi(positions),
  };
}

export function isWinningClosedPosition(pos) {
  const pnl = Number(pos.realizedPnl ?? pos.realized_pnl ?? 0);
  const price = Number(pos.curPrice ?? pos.cur_price ?? 0);
  return pnl > 0 || price >= 0.99;
}

export function isLosingClosedPosition(pos) {
  const pnl = Number(pos.realizedPnl ?? pos.realized_pnl ?? 0);
  const price = Number(pos.curPrice ?? pos.cur_price ?? 0);
  return price <= 0.01 && pnl <= 0;
}

export function computeAvgRoi(closedPositions = []) {
  let total = 0;
  let count = 0;
  for (const pos of closedPositions) {
    const cost = Number(pos.totalBought ?? pos.initialValue ?? pos.size ?? 0);
    const pnl = Number(pos.realizedPnl ?? pos.realized_pnl ?? 0);
    if (cost > 0) {
      total += pnl / cost;
      count++;
    }
  }
  return count > 0 ? total / count : 0;
}

function normalizePnl(data) {
  const raw = Array.isArray(data) ? data[0] : data;
  return {
    totalProfit: Number(raw?.totalProfit ?? raw?.total_profit ?? raw?.profit ?? 0),
    winRate: Number(raw?.winRate ?? raw?.win_rate ?? 0),
    totalTrades: Number(raw?.totalTrades ?? raw?.total_trades ?? 0),
    resolvedTrades: Number(raw?.resolvedTrades ?? raw?.resolved_trades ?? 0),
  };
}

export async function fetchActivity(address, limit = 500, offset = 0, options = {}) {
  await throttleWalletRequest();
  return withRetry(async () => {
    const params = {
      user: address,
      limit: Math.min(limit, 500),
      offset,
      sortBy: 'TIMESTAMP',
      sortDirection: 'DESC',
    };
    if (options.start != null) params.start = options.start;
    if (options.end != null) params.end = options.end;
    const { data } = await dataClient.get('/activity', { params });
    return Array.isArray(data) ? data : data?.data ?? [];
  }, `activity:${address.slice(0, 8)}:${offset}`);
}

export async function fetchActivityLast30Days(address) {
  const end = Math.floor(Date.now() / 1000);
  const start = end - 30 * 24 * 60 * 60;
  const all = [];
  const seenDays = new Set();

  for (let offset = 0; offset <= 2500; offset += 500) {
    let batch = [];
    try {
      batch = await fetchActivity(address, 500, offset, { start, end });
    } catch {
      break;
    }
    if (!batch.length) break;
    all.push(...batch);
    for (const item of batch) {
      const ts = getActivityTimestamp(item);
      if (ts) seenDays.add(new Date(ts).toISOString().slice(0, 10));
    }
    if (batch.length < 500) break;
    if (seenDays.size >= 18) break;
    await sleep(50);
  }

  return all;
}

export async function fetchPositions(address) {
  await throttleWalletRequest();
  return withRetry(async () => {
    const { data } = await dataClient.get('/positions', { params: { user: address } });
    return Array.isArray(data) ? data : data?.data ?? [];
  }, `positions:${address.slice(0, 8)}`);
}

export async function fetchActiveMarkets(limit = 100) {
  return withRetry(async () => {
    const { data } = await gammaClient.get('/markets', {
      params: { active: true, closed: false, limit, order: 'liquidityNum', ascending: false },
    });
    return Array.isArray(data) ? data : data?.data ?? [];
  }, 'markets');
}

export async function fetchMarketsByVolume(limit = 100) {
  return withRetry(async () => {
    const { data } = await gammaClient.get('/markets', {
      params: { active: true, closed: false, limit, order: 'volume24hr', ascending: false },
    });
    return Array.isArray(data) ? data : data?.data ?? [];
  }, 'markets-volume');
}

export function getHoursUntilClose(market) {
  const closeDate = getMarketCloseDate(market);
  if (!closeDate) return null;
  return (new Date(closeDate).getTime() - Date.now()) / (1000 * 60 * 60);
}

export async function fetchMarketsClosingWithin(maxHours = 24, minHours = 1, limit = 150) {
  const markets = await fetchMarketsByVolume(limit);
  return markets.filter((m) => {
    const hours = getHoursUntilClose(m);
    if (hours == null) return false;
    return hours >= minHours && hours <= maxHours;
  });
}

export async function fetchMarketHolders(conditionId, limit = 20) {
  return withRetry(async () => {
    const { data } = await dataClient.get('/holders', {
      params: { market: conditionId, limit },
    });
    return Array.isArray(data) ? data : [];
  }, `holders:${conditionId.slice(0, 10)}`);
}

export async function fetchTopHolderWallets(marketCount = 25, holdersPerMarket = 15) {
  const markets = await fetchActiveMarkets(marketCount);
  const wallets = new Set();

  for (const market of markets) {
    const conditionId = market.conditionId ?? market.condition_id;
    if (!conditionId) continue;
    try {
      const tokenGroups = await fetchMarketHolders(conditionId, holdersPerMarket);
      for (const group of tokenGroups) {
        for (const holder of group.holders ?? []) {
          const addr = holder.proxyWallet ?? holder.address;
          if (addr) wallets.add(addr.toLowerCase());
        }
      }
      await sleep(100);
    } catch (err) {
      console.warn(`Holders fetch failed for ${conditionId.slice(0, 12)}:`, err.message);
    }
  }

  return [...wallets];
}

export async function fetchMarketByConditionId(conditionId) {
  return withRetry(async () => {
    const { data } = await gammaClient.get('/markets', {
      params: { condition_ids: conditionId },
    });
    const markets = Array.isArray(data) ? data : data?.data ?? [];
    return markets[0] ?? null;
  }, `market:${conditionId}`);
}

export async function fetchTokenPrice(tokenId) {
  return withRetry(async () => {
    const { data } = await clobClient.get('/price', {
      params: { token_id: tokenId, side: 'buy' },
    });
    const price = Number(data?.price ?? data);
    return Number.isFinite(price) ? price : null;
  }, `price:${tokenId?.slice?.(0, 8) ?? tokenId}`);
}

export async function fetchPriceHistory(tokenId, timestamp) {
  return withRetry(async () => {
    const ts = Math.floor(Number(timestamp) / 1000);
    const startTs = ts - 3600;
    const endTs = ts + 3600;
    const { data } = await clobClient.get('/prices-history', {
      params: {
        market: tokenId,
        startTs,
        endTs,
        fidelity: 1,
      },
    });
    const history = data?.history ?? data?.prices ?? (Array.isArray(data) ? data : []);
    if (!history.length) return null;

    let closest = history[0];
    let closestDiff = Math.abs(getHistoryTimestamp(closest) - ts);
    for (const point of history) {
      const diff = Math.abs(getHistoryTimestamp(point) - ts);
      if (diff < closestDiff) {
        closest = point;
        closestDiff = diff;
      }
    }
    const price = Number(closest?.p ?? closest?.price ?? closest?.close);
    return Number.isFinite(price) ? price : null;
  }, `price-history:${tokenId?.slice?.(0, 8)}`);
}

function getHistoryTimestamp(point) {
  return Number(point?.t ?? point?.timestamp ?? point?.time ?? 0);
}

export function extractWalletAddress(entry) {
  return (
    entry?.proxyWallet ??
    entry?.address ??
    entry?.user ??
    entry?.wallet ??
    entry?.trader ??
    null
  );
}

export function getActivityTimestamp(item) {
  const ts = item?.timestamp ?? item?.createdAt ?? item?.created_at ?? item?.time;
  if (!ts) return null;
  if (typeof ts === 'number') return ts > 1e12 ? ts : ts * 1000;
  return new Date(ts).getTime();
}

export function countTradingDaysLast30(activity) {
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const days = new Set();
  for (const item of activity) {
    const ts = getActivityTimestamp(item);
    if (!ts || ts < cutoff) continue;
    const day = new Date(ts).toISOString().slice(0, 10);
    days.add(day);
  }
  return days.size;
}

export function hasRecentActivity(activity, days = 30) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return activity.some((item) => {
    const ts = getActivityTimestamp(item);
    return ts && ts >= cutoff;
  });
}

export function computeLast10ResolvedWinRate(activity, closedPositions = []) {
  const fromClosed = [...closedPositions]
    .sort((a, b) => Number(b.timestamp ?? 0) - Number(a.timestamp ?? 0))
    .slice(0, 10);

  if (fromClosed.length >= 5) {
    let wins = 0;
    for (const pos of fromClosed) {
      if (isWinningClosedPosition(pos)) wins++;
    }
    return wins / fromClosed.length;
  }

  const resolved = activity
    .filter((item) => {
      const type = (item?.type ?? item?.action ?? '').toLowerCase();
      const status = (item?.status ?? '').toLowerCase();
      return (
        type.includes('redeem') ||
        type.includes('resolve') ||
        status === 'resolved' ||
        item?.resolved === true ||
        item?.isResolved === true
      );
    })
    .sort((a, b) => (getActivityTimestamp(b) ?? 0) - (getActivityTimestamp(a) ?? 0))
    .slice(0, 10);

  if (resolved.length === 0) {
    const trades = activity
      .filter((item) => {
        const type = (item?.type ?? item?.action ?? '').toLowerCase();
        return type.includes('trade') || type.includes('buy') || type.includes('sell');
      })
      .sort((a, b) => (getActivityTimestamp(b) ?? 0) - (getActivityTimestamp(a) ?? 0))
      .slice(0, 10);

    if (trades.length < 5) return null;

    let wins = 0;
    for (const trade of trades) {
      const pnl = Number(trade?.pnl ?? trade?.profit ?? trade?.realizedPnl ?? 0);
      if (pnl > 0) wins++;
    }
    return wins / trades.length;
  }

  let wins = 0;
  for (const item of resolved) {
    const pnl = Number(item?.pnl ?? item?.profit ?? item?.realizedPnl ?? 0);
    const outcome = (item?.outcome ?? item?.result ?? '').toLowerCase();
    if (pnl > 0 || outcome === 'win' || outcome === 'won') wins++;
  }
  return wins / resolved.length;
}

export function normalizePosition(pos) {
  let side = 'YES';
  if (pos.outcomeIndex === 1) {
    side = 'NO';
  } else if (pos.outcomeIndex === 0) {
    side = 'YES';
  } else {
    const sideRaw = (pos?.outcome ?? pos?.side ?? pos?.position ?? '').toString().trim();
    const upper = sideRaw.toUpperCase();
    if (upper.includes('NO') || upper === '0' || upper === 'FALSE') side = 'NO';
    else if (upper.includes('YES') || upper === '1' || upper === 'TRUE') side = 'YES';
    else if (sideRaw) side = sideRaw;
  }

  const curPrice = Number(pos?.curPrice ?? pos?.cur_price ?? 0);
  const currentValue = Number(pos?.currentValue ?? pos?.current_value ?? 0);

  return {
    conditionId: pos?.conditionId ?? pos?.condition_id ?? pos?.market ?? pos?.asset ?? '',
    marketTitle: pos?.title ?? pos?.marketTitle ?? pos?.question ?? pos?.name ?? 'Unknown Market',
    side,
    size: Number(pos?.size ?? pos?.amount ?? pos?.value ?? pos?.currentValue ?? 0),
    avgPrice: Number(pos?.avgPrice ?? pos?.avg_price ?? pos?.price ?? pos?.curPrice ?? 0),
    entryTimestamp: getActivityTimestamp(pos) ?? Number(pos?.timestamp ?? 0),
    tokenId: pos?.asset ?? pos?.tokenId ?? pos?.token_id ?? pos?.clobTokenId ?? null,
    curPrice,
    currentValue,
    isActive: curPrice > 0.01 || currentValue > 1,
  };
}

export function isActivePosition(pos) {
  const normalized = pos.conditionId ? pos : normalizePosition(pos);
  return normalized.isActive !== false && normalized.size > 0;
}

export function getMarketLiquidity(market) {
  return Number(market?.liquidityNum ?? market?.liquidity ?? market?.liquidityClob ?? 0);
}

export function getMarketCloseDate(market) {
  return market?.endDate ?? market?.end_date_iso ?? market?.closedTime ?? market?.endDateIso ?? null;
}

export function getMarketUrl(market) {
  if (market?.slug) return `https://polymarket.com/event/${market.slug}`;
  if (market?.events?.[0]?.slug) return `https://polymarket.com/event/${market.events[0].slug}`;
  if (market?.conditionId) return `https://polymarket.com/market/${market.conditionId}`;
  return 'https://polymarket.com';
}

export function getTokenIdForSide(market, side) {
  const tokens = market?.clobTokenIds ?? market?.tokens ?? [];
  if (typeof tokens === 'string') {
    try {
      const parsed = JSON.parse(tokens);
      if (Array.isArray(parsed)) {
        return side === 'YES' ? parsed[0] : parsed[1];
      }
    } catch {
      /* ignore */
    }
  }
  if (Array.isArray(tokens) && tokens.length >= 2) {
    if (typeof tokens[0] === 'object') {
      const yes = tokens.find((t) => (t.outcome ?? t.name ?? '').toLowerCase().includes('yes'));
      const no = tokens.find((t) => (t.outcome ?? t.name ?? '').toLowerCase().includes('no'));
      return side === 'YES' ? (yes?.token_id ?? yes?.tokenId) : (no?.token_id ?? no?.tokenId);
    }
    return side === 'YES' ? tokens[0] : tokens[1];
  }
  return market?.clobTokenIds?.[side === 'YES' ? 0 : 1] ?? null;
}

export function parseMarketOutcomes(market) {
  let outcomes = market?.outcomes;
  if (typeof outcomes === 'string') {
    try {
      outcomes = JSON.parse(outcomes);
    } catch {
      outcomes = [];
    }
  }
  let prices = market?.outcomePrices;
  if (typeof prices === 'string') {
    try {
      prices = JSON.parse(prices);
    } catch {
      prices = [];
    }
  }
  let tokenIds = market?.clobTokenIds;
  if (typeof tokenIds === 'string') {
    try {
      tokenIds = JSON.parse(tokenIds);
    } catch {
      tokenIds = [];
    }
  }
  return {
    outcomes: Array.isArray(outcomes) ? outcomes : [],
    prices: Array.isArray(prices) ? prices.map(Number) : [],
    tokenIds: Array.isArray(tokenIds) ? tokenIds : [],
  };
}

/** Which outcome index (0 or 1) won, for binary / team-name markets. */
export function getWinningOutcomeIndex(market) {
  const { prices } = parseMarketOutcomes(market);
  if (prices.length < 2) return null;

  const p0 = Number(prices[0]);
  const p1 = Number(prices[1]);

  if (p0 >= 0.9 && p1 <= 0.1) return 0;
  if (p1 >= 0.9 && p0 <= 0.1) return 1;

  if (market && (market.closed === true || market.resolved === true || market.umaResolutionStatus === 'resolved')) {
    if (p0 > p1 + 0.1) return 0;
    if (p1 > p0 + 0.1) return 1;
  }

  const hours = getHoursUntilClose(market);
  if (hours != null && hours <= 0) {
    if (p0 > p1 + 0.05) return 0;
    if (p1 > p0 + 0.05) return 1;
  }

  return null;
}

/** Map signal side / token to outcome index 0 or 1. */
export function getSignalOutcomeIndex(market, recommendedSide, tokenId) {
  const { outcomes, tokenIds } = parseMarketOutcomes(market);

  if (tokenId && tokenIds.length) {
    const idx = tokenIds.findIndex((t) => String(t) === String(tokenId));
    if (idx >= 0) return idx;
  }

  const side = (recommendedSide ?? '').toString().trim();
  const upper = side.toUpperCase();
  if (upper === 'YES' || upper === '1' || upper === 'TRUE') return 0;
  if (upper === 'NO' || upper === '0' || upper === 'FALSE') return 1;

  const lower = side.toLowerCase();
  for (let i = 0; i < outcomes.length; i++) {
    const label = outcomes[i]?.toString().trim().toLowerCase() ?? '';
    if (!label) continue;
    if (label === lower || label.includes(lower) || lower.includes(label)) return i;
  }

  return null;
}

export function didSignalWin(market, recommendedSide, tokenId) {
  const winIdx = getWinningOutcomeIndex(market);
  if (winIdx == null) return null;

  const signalIdx = getSignalOutcomeIndex(market, recommendedSide, tokenId);
  if (signalIdx == null) return null;

  return signalIdx === winIdx;
}

export function calculatePotentialReturn(price) {
  if (!price || price <= 0) return 0;
  return ((1 - price) / price) * 100;
}

export function calculateDriftPct(entryPrice, currentPrice) {
  if (!entryPrice || entryPrice <= 0) return 0;
  return ((currentPrice - entryPrice) / entryPrice) * 100;
}

export { sleep, DATA_API, GAMMA_API, CLOB_API };
