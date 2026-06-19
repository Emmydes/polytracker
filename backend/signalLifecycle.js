import { fetchTokenPrice, fetchMarketByConditionId, calculateDriftPct, getTokenIdForSide } from './polymarketApi.js';
import {
  getActiveSwingSignals,
  getActiveDailySignals,
  updateSwingSignal,
  updateDailySignal,
} from './db.js';

const ENTRY_WINDOW_DRIFT_PCT = 5;

export function getWinningSide(market) {
  if (!market) return null;
  const closed = market.closed === true || market.resolved === true || market.umaResolutionStatus === 'resolved';
  if (!closed) return null;

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

  if (Array.isArray(prices) && Array.isArray(outcomes) && prices.length >= 2) {
    for (let i = 0; i < prices.length; i++) {
      if (Number(prices[i]) >= 0.99) {
        const label = (outcomes[i] ?? '').toString().toUpperCase();
        if (label.includes('YES') || label === '1' || i === 0) return 'YES';
        if (label.includes('NO') || label === '0' || i === 1) return 'NO';
      }
    }
    if (Number(prices[0]) > Number(prices[1])) return 'YES';
    if (Number(prices[1]) > Number(prices[0])) return 'NO';
  }

  const tokens = market.tokens ?? [];
  for (const t of tokens) {
    const price = Number(t.price ?? t.lastPrice ?? 0);
    const outcome = (t.outcome ?? t.name ?? '').toString().toUpperCase();
    if (price >= 0.99) {
      if (outcome.includes('YES')) return 'YES';
      if (outcome.includes('NO')) return 'NO';
    }
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

async function checkResolution(signal, updateFn) {
  let market;
  try {
    market = await fetchMarketByConditionId(signal.market_id);
  } catch {
    return false;
  }

  const winningSide = getWinningSide(market);
  if (!winningSide) return false;

  const won = signal.recommended_side === winningSide;
  const now = Math.floor(Date.now() / 1000);
  updateFn(signal.id, {
    status: won ? 'WON' : 'LOST',
    outcome: won ? 'WON' : 'LOST',
    resolved_at: now,
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
