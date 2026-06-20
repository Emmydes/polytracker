import { fetchPositions, fetchClosedPositions, normalizePosition } from './polymarketApi.js';
import { upsertResult } from './db.js';

function parseResolvedAt(pos) {
  const ts = Number(pos.timestamp ?? pos.endDate ?? pos.end_date ?? 0);
  if (ts > 1e12) return Math.floor(ts / 1000);
  if (ts > 1e9) return Math.floor(ts);
  if (typeof pos.endDate === 'string') {
    const parsed = Date.parse(pos.endDate);
    if (!Number.isNaN(parsed)) return Math.floor(parsed / 1000);
  }
  return Math.floor(Date.now() / 1000);
}

function getPositionPnl(pos) {
  return Number(pos.realizedPnl ?? pos.realized_pnl ?? pos.cashPnl ?? pos.cash_pnl ?? 0);
}

function getSharesSold(pos) {
  const totalBought = Number(pos.totalBought ?? pos.total_bought ?? 0);
  const size = Number(pos.size ?? 0);
  if (totalBought <= 0) return 0;
  const sold = totalBought - size;
  return sold > 0.001 ? sold : totalBought;
}

export function deriveResultFromPosition(pos, wallet) {
  const totalBought = Number(pos.totalBought ?? pos.total_bought ?? 0);
  if (totalBought <= 0) return null;

  const pnl = getPositionPnl(pos);
  const curPrice = Number(pos.curPrice ?? pos.cur_price ?? 0);
  const sharesSold = getSharesSold(pos);
  const entryPrice = Number(pos.avgPrice ?? pos.avg_price ?? 0);
  if (entryPrice <= 0) return null;

  const settled =
    sharesSold > 0 &&
    (pnl !== 0 || curPrice <= 0.01 || curPrice >= 0.99 || pos.redeemable === true);
  if (!settled) return null;

  let outcome;
  if (sharesSold > 0 && pnl > 0) {
    outcome = 'WON';
  } else if (pnl < 0 || curPrice <= 0.01) {
    outcome = 'LOST';
  } else if (curPrice >= 0.99) {
    outcome = 'WON';
  } else {
    return null;
  }

  const exitPrice = outcome === 'WON' ? 1.0 : 0.0;
  const profitPercent = ((exitPrice - entryPrice) / entryPrice) * 100;
  const normalized = normalizePosition(pos);

  return {
    asset: pos.asset ?? pos.tokenId ?? pos.token_id ?? `${normalized.conditionId}:${normalized.side}`,
    market_title: normalized.marketTitle,
    side: normalized.side,
    entry_price: entryPrice,
    exit_price: exitPrice,
    profit_percent: profitPercent,
    outcome,
    resolved_at: parseResolvedAt(pos),
    wallet: wallet.toLowerCase(),
  };
}

async function fetchAllClosedPositions(address, maxPages = 8) {
  const positions = [];
  let offset = 0;
  const pageSize = 50;

  for (let page = 0; page < maxPages; page++) {
    const batch = await fetchClosedPositions(address, pageSize, offset);
    if (!batch.length) break;
    positions.push(...batch);
    offset += batch.length;
    if (batch.length < pageSize) break;
  }

  return positions;
}

export async function syncWalletResults(wallet) {
  const address = wallet.toLowerCase();
  const seen = new Set();
  let upserted = 0;

  const closed = await fetchAllClosedPositions(address);
  for (const pos of closed) {
    const result = deriveResultFromPosition(pos, address);
    if (!result || seen.has(result.asset)) continue;
    seen.add(result.asset);
    upsertResult(result);
    upserted++;
  }

  const open = await fetchPositions(address);
  for (const pos of open) {
    const result = deriveResultFromPosition(pos, address);
    if (!result || seen.has(result.asset)) continue;
    seen.add(result.asset);
    upsertResult(result);
    upserted++;
  }

  return upserted;
}

export async function syncResultsForWallets(wallets, concurrency = 4) {
  let total = 0;
  for (let i = 0; i < wallets.length; i += concurrency) {
    const chunk = wallets.slice(i, i + concurrency);
    const counts = await Promise.all(
      chunk.map(async (wallet) => {
        try {
          return await syncWalletResults(wallet);
        } catch (err) {
          console.error(`Results sync failed for ${wallet.slice(0, 10)}:`, err.message);
          return 0;
        }
      })
    );
    total += counts.reduce((sum, n) => sum + n, 0);
  }
  return total;
}
