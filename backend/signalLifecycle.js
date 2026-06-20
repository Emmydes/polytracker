import {
  fetchTokenPrice,
  fetchMarketByConditionId,
  calculateDriftPct,
  getTokenIdForSide,
  getHoursUntilClose,
  parseMarketOutcomes,
  didSignalWin,
  getWinningOutcomeIndex,
} from './polymarketApi.js';
import {
  getActiveSwingSignals,
  getActiveDailySignals,
  updateSwingSignal,
  updateDailySignal,
  getDb,
} from './db.js';

const ENTRY_WINDOW_DRIFT_PCT = 5;

export function isMarketClosed(market) {
  if (!market) return false;
  if (market.closed === true || market.resolved === true) return true;
  if (market.umaResolutionStatus === 'resolved') return true;
  if (market.tokens?.some((t) => t.winner === true)) return true;

  const end = market.endDate ?? market.end_date_iso ?? market.closedTime;
  if (end && new Date(end).getTime() < Date.now()) {
    const { prices } = parseMarketOutcomes(market);
    if (prices.length >= 2) {
      const p0 = Number(prices[0]);
      const p1 = Number(prices[1]);
      if ((p0 >= 0.9 && p1 <= 0.1) || (p1 >= 0.9 && p0 <= 0.1)) return true;
    }
  }

  const hours = getHoursUntilClose(market);
  if (hours != null && hours <= 0) return true;

  return false;
}

export function getWinningSide(market) {
  const idx = getWinningOutcomeIndex(market);
  if (idx === 0) return 'YES';
  if (idx === 1) return 'NO';
  return null;
}

function repairInconsistentStatuses() {
  const now = Math.floor(Date.now() / 1000);
  const db = getDb();
  db.prepare(`
    UPDATE daily_picks SET status = outcome, resolved_at = COALESCE(resolved_at, ?)
    WHERE status = 'EXPIRED' AND outcome IN ('WON', 'LOST')
  `).run(now);
  db.prepare(`
    UPDATE intraday_picks SET status = outcome, resolved_at = COALESCE(resolved_at, ?)
    WHERE status = 'EXPIRED' AND outcome IN ('WON', 'LOST')
  `).run(now);
}

function hasDecisiveOutcome(market) {
  return getWinningOutcomeIndex(market) != null;
}

function resolveTokenId(signal, market) {
  if (signal.token_id) return signal.token_id;
  if (!market) return null;
  return getTokenIdForSide(market, signal.recommended_side);
}

async function refreshSignalHours(signal, updateFn) {
  try {
    const market = await fetchMarketByConditionId(signal.market_id);
    const hours = getHoursUntilClose(market);
    if (
      hours != null &&
      signal.hours_until_close != null &&
      hours !== signal.hours_until_close
    ) {
      updateFn(signal.id, { hours_until_close: hours });
      signal.hours_until_close = hours;
    }
    return market;
  } catch {
    return null;
  }
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

async function checkResolution(signal, updateFn, marketPrefetched = null) {
  let market = marketPrefetched;
  if (!market) {
    try {
      market = await fetchMarketByConditionId(signal.market_id);
    } catch {
      return false;
    }
  }

  if (!isMarketClosed(market)) return false;

  const decisive = hasDecisiveOutcome(market);
  if (!decisive) return false;

  const now = Math.floor(Date.now() / 1000);
  const tokenId = resolveTokenId(signal, market);
  const won = didSignalWin(market, signal.recommended_side, tokenId);
  const resolvedFields = { resolved_at: now };
  if (signal.hours_until_close != null) resolvedFields.hours_until_close = 0;

  if (won === true) {
    updateFn(signal.id, {
      status: 'WON',
      outcome: 'WON',
      ...resolvedFields,
    });
    return true;
  }

  if (won === false) {
    updateFn(signal.id, {
      status: 'LOST',
      outcome: 'LOST',
      ...resolvedFields,
    });
    return true;
  }

  return false;
}

async function revertPrematureResolutions(updateFn, table) {
  const rows = getDb()
    .prepare(`SELECT * FROM ${table} WHERE status IN ('WON', 'LOST')`)
    .all();

  let reverted = 0;
  for (const signal of rows) {
    try {
      const market = await fetchMarketByConditionId(signal.market_id);
      if (!isMarketClosed(market)) {
        updateFn(signal.id, {
          status: 'ACTIVE',
          outcome: null,
          resolved_at: null,
        });
        reverted++;
      }
    } catch {
      /* keep resolved if market fetch fails */
    }
  }
  if (reverted > 0) {
    console.log(`Reverted ${reverted} premature ${table} outcomes (market not settled)`);
  }
  return reverted;
}

async function processSignals(signals, updateFn, label, options = {}) {
  const { skipPriceExpiry = false } = options;
  let expired = 0;
  let resolved = 0;

  for (const signal of signals) {
    try {
      const market = await refreshSignalHours(signal, updateFn);

      if (await checkResolution(signal, updateFn, market)) {
        resolved++;
        continue;
      }

      if (!skipPriceExpiry && signal.status !== 'EXPIRED' && (await checkPriceExpiry(signal, updateFn))) {
        expired++;
      }
    } catch (err) {
      console.warn(`${label} lifecycle failed for ${signal.market_id}:`, err.message);
    }
  }

  if (expired || resolved) {
    console.log(`${label} lifecycle: ${expired} expired, ${resolved} resolved`);
  }
  return { expired, resolved };
}

export async function processSwingSignalLifecycle() {
  return processSignals(getActiveSwingSignals(), updateSwingSignal, 'Swing', { skipPriceExpiry: true });
}

export async function processDailySignalLifecycle() {
  return processSignals(getActiveDailySignals(), updateDailySignal, 'Daily');
}

async function repairSettledOutcomes(updateFn, table) {
  const rows = getDb()
    .prepare(`SELECT * FROM ${table} WHERE status IN ('WON', 'LOST', 'ACTIVE', 'EXPIRED')`)
    .all();

  let fixed = 0;
  for (const signal of rows) {
    if (signal.outcome === 'WON' || signal.outcome === 'LOST') continue;
    if (signal.status !== 'WON' && signal.status !== 'LOST') continue;

    try {
      const market = await fetchMarketByConditionId(signal.market_id);
      if (!market) continue;
      if (!isMarketClosed(market)) {
        updateFn(signal.id, { status: 'ACTIVE', outcome: null, resolved_at: null });
        fixed++;
        continue;
      }
      const reopened = { ...signal, status: 'ACTIVE', outcome: null };
      if (await checkResolution(reopened, updateFn, market)) fixed++;
    } catch {
      /* skip */
    }
  }
  if (fixed > 0) console.log(`Repaired ${fixed} settled outcomes in ${table}`);
  return fixed;
}

async function settlePendingSignals(updateFn, table, label, options = {}) {
  const rows = getDb()
    .prepare(`
      SELECT * FROM ${table}
      WHERE COALESCE(outcome, '') NOT IN ('WON', 'LOST')
        AND status IN ('ACTIVE', 'EXPIRED')
      ORDER BY created_at DESC
    `)
    .all();

  let resolved = 0;
  for (const signal of rows) {
    try {
      const market = await fetchMarketByConditionId(signal.market_id);
      if (!market) continue;
      if (await checkResolution(signal, updateFn, market)) resolved++;
    } catch (err) {
      console.warn(`${label} settle failed for ${signal.market_id}:`, err.message);
    }
  }
  if (resolved > 0) console.log(`${label}: settled ${resolved} pending signals`);
  return resolved;
}

export async function runSignalLifecycle() {
  repairInconsistentStatuses();
  await repairSettledOutcomes(updateSwingSignal, 'daily_picks');
  await repairSettledOutcomes(updateDailySignal, 'intraday_picks');
  await revertPrematureResolutions(updateSwingSignal, 'daily_picks');
  await revertPrematureResolutions(updateDailySignal, 'intraday_picks');
  await settlePendingSignals(updateSwingSignal, 'daily_picks', 'Swing');
  await settlePendingSignals(updateDailySignal, 'intraday_picks', 'Daily');
  const swing = await processSwingSignalLifecycle();
  const daily = await processDailySignalLifecycle();
  return { swing, daily };
}
