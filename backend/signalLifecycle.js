import { fetchTokenPrice, fetchMarketByConditionId, calculateDriftPct, getTokenIdForSide, getHoursUntilClose } from './polymarketApi.js';
import {
  getActiveSwingSignals,
  getActiveDailySignals,
  updateSwingSignal,
  updateDailySignal,
} from './db.js';

const ENTRY_WINDOW_DRIFT_PCT = 5;

export function isMarketClosed(market) {
  if (!market) return false;
  if (market.closed === true || market.resolved === true) return true;
  if (market.active === false) return true;
  if (market.umaResolutionStatus === 'resolved') return true;

  const end = market.endDate ?? market.end_date_iso ?? market.closedTime;
  if (end && new Date(end).getTime() < Date.now()) return true;

  const hours = getHoursUntilClose(market);
  if (hours != null && hours <= 0) return true;

  return false;
}

export function getWinningSide(market) {
  if (!market) return null;

  let prices = market.outcomePrices;
  if (typeof prices === 'string') {
    try {
      prices = JSON.parse(prices);
    } catch {
      prices = null;
    }
  }

  let outcomes = market.outcomes;
  if (typeof outcomes === 'string') {
    try {
      outcomes = JSON.parse(outcomes);
    } catch {
      outcomes = null;
    }
  }

  if (Array.isArray(prices) && prices.length >= 2) {
    const p0 = Number(prices[0]);
    const p1 = Number(prices[1]);

    if (p0 >= 0.95 && p1 <= 0.05) return 'YES';
    if (p1 >= 0.95 && p0 <= 0.05) return 'NO';

    if (isMarketClosed(market)) {
      if (p0 > p1) return 'YES';
      if (p1 > p0) return 'NO';
    }
  }

  const tokens = market.tokens ?? [];
  for (const t of tokens) {
    const price = Number(t.price ?? t.lastPrice ?? 0);
    const outcome = (t.outcome ?? t.name ?? '').toString().toUpperCase();
    if (price >= 0.95) {
      if (outcome.includes('YES')) return 'YES';
      if (outcome.includes('NO')) return 'NO';
    }
  }

  if (isMarketClosed(market) && market.winner) {
    const w = market.winner.toString().toUpperCase();
    if (w.includes('YES') || w === '1') return 'YES';
    if (w.includes('NO') || w === '0') return 'NO';
  }

  return null;
}

async function checkPriceExpiry(signal, updateFn) {
  let tokenId = signal.token_id;
  if (!tokenId) {
    try {
      const market = await fetchMarketByConditionId(signal.market_id);
      tokenId = getTokenIdForSide(market, signal.recommended_side);
    } catch {
      return false;
    }
  }
  if (!tokenId) return false;

  const livePrice = await fetchTokenPrice(tokenId);
  if (livePrice === null) return false;

  const entry = signal.entry_price ?? livePrice;
  const drift = Math.abs(calculateDriftPct(entry, livePrice));
  const now = Math.floor(Date.now() / 1000);

  if (drift > ENTRY_WINDOW_DRIFT_PCT) {
    updateFn(signal.id, {
      status: 'EXPIRED',
      entry_window_close: signal.entry_window_close ?? now,
      current_price: livePrice,
      drift_pct: calculateDriftPct(entry, livePrice),
    });
    return true;
  }

  if (signal.entry_window_close && now >= signal.entry_window_close) {
    updateFn(signal.id, { status: 'EXPIRED', current_price: livePrice });
    return true;
  }

  return false;
}

function dominantSide(prices) {
  if (!Array.isArray(prices) || prices.length < 2) return null;
  const p0 = Number(prices[0]);
  const p1 = Number(prices[1]);
  if (Math.abs(p0 - p1) < 0.15) return null;
  return p0 > p1 ? 'YES' : 'NO';
}

function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  return null;
}

function signalPastSettlement(signal) {
  return signal.hours_until_close != null && Number(signal.hours_until_close) <= 0;
}

async function checkResolution(signal, updateFn) {
  let market;
  try {
    market = await fetchMarketByConditionId(signal.market_id);
  } catch {
    return false;
  }

  const pastSettle = signalPastSettlement(signal);
  const closed = isMarketClosed(market) || pastSettle;
  if (!closed) return false;

  let winningSide = getWinningSide(market);

  if (!winningSide && pastSettle) {
    const prices = parseJsonArray(market?.outcomePrices);
    winningSide = dominantSide(prices);
  }

  const now = Math.floor(Date.now() / 1000);

  if (winningSide) {
    const won = signal.recommended_side === winningSide;
    updateFn(signal.id, {
      status: won ? 'WON' : 'LOST',
      outcome: won ? 'WON' : 'LOST',
      resolved_at: now,
      hours_until_close: 0,
    });
    return true;
  }

  updateFn(signal.id, {
    status: 'EXPIRED',
    outcome: 'EXPIRED',
    entry_window_close: signal.entry_window_close ?? now,
    resolved_at: now,
    hours_until_close: 0,
  });
  return true;
}

export async function processSwingSignalLifecycle() {
  const signals = getActiveSwingSignals();
  let expired = 0;
  let resolved = 0;

  for (const signal of signals) {
    try {
      if (await checkResolution(signal, updateSwingSignal)) {
        resolved++;
        continue;
      }
      if (await checkPriceExpiry(signal, updateSwingSignal)) {
        expired++;
      }
    } catch (err) {
      console.warn(`Swing lifecycle failed for ${signal.market_id}:`, err.message);
    }
  }

  if (expired || resolved) {
    console.log(`Swing lifecycle: ${expired} expired, ${resolved} resolved`);
  }
  return { expired, resolved };
}

export async function processDailySignalLifecycle() {
  const signals = getActiveDailySignals();
  let expired = 0;
  let resolved = 0;

  for (const signal of signals) {
    try {
      if (await checkResolution(signal, updateDailySignal)) {
        resolved++;
        continue;
      }
      if (await checkPriceExpiry(signal, updateDailySignal)) {
        expired++;
      }
    } catch (err) {
      console.warn(`Daily lifecycle failed for ${signal.market_id}:`, err.message);
    }
  }

  if (expired || resolved) {
    console.log(`Daily lifecycle: ${expired} expired, ${resolved} resolved`);
  }
  return { expired, resolved };
}

export async function runSignalLifecycle() {
  const swing = await processSwingSignalLifecycle();
  const daily = await processDailySignalLifecycle();
  return { swing, daily };
}
