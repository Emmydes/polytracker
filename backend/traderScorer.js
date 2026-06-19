import {
  fetchLeaderboard,
  fetchPnl,
  fetchActivityLast30Days,
  extractWalletAddress,
  countTradingDaysLast30,
  hasRecentActivity,
  computeLast10ResolvedWinRate,
  fetchTopHolderWallets,
  computeAvgRoi,
} from './polymarketApi.js';
import { upsertEliteTrader, getCachedTrader, upsertWalletStats, getWalletStats } from './db.js';

export const QUALIFICATION = {
  minResolvedTrades: 50,
  minWinRate: 0.85,
  minTotalProfit: 500,
  minTradingDays30: 18,
  coolingOffWinRate: 0.6,
};

export const PRE_TRACK = {
  minResolvedTrades: 50,
  minWinRate: 0.85,
};

export function passesPreTrackFilter(winRate, resolvedTrades) {
  return resolvedTrades >= PRE_TRACK.minResolvedTrades && winRate >= PRE_TRACK.minWinRate;
}

export async function evaluateTrader(address, options = {}) {
  const { forceRefresh = false, leaderboardEntry = null } = options;
  const now = Math.floor(Date.now() / 1000);

  if (!forceRefresh) {
    const cached = getCachedTrader(address);
    if (cached) {
      const ws = getWalletStats(address);
      return formatTraderResult(cached, { fromCache: true, walletStatus: ws?.status ?? 'ACTIVE' });
    }
  }

  const [pnl, activity] = await Promise.all([
    fetchPnl(address),
    fetchActivityLast30Days(address),
  ]);

  if (leaderboardEntry?.pnl != null && Number(leaderboardEntry.pnl) > 0) {
    pnl.totalProfit = Math.max(pnl.totalProfit, Number(leaderboardEntry.pnl));
  }

  const closedPositions = pnl.closedPositions ?? [];
  const tradingDays30 = countTradingDaysLast30(activity);
  const last10WinRate = computeLast10ResolvedWinRate(activity, closedPositions);
  const isCoolingOff = last10WinRate !== null && last10WinRate < QUALIFICATION.coolingOffWinRate;
  const avgRoi = pnl.avgRoi ?? computeAvgRoi(closedPositions);

  const preTrackOk = passesPreTrackFilter(pnl.winRate, pnl.resolvedTrades);
  const existingStats = getWalletStats(address);
  let walletStatus = 'ACTIVE';

  if (!preTrackOk) {
    walletStatus = existingStats ? 'DEGRADED' : null;
  } else if (existingStats?.status === 'DEGRADED' && pnl.winRate >= PRE_TRACK.minWinRate) {
    walletStatus = 'ACTIVE';
  }

  if (walletStatus) {
    upsertWalletStats({
      wallet: address,
      win_rate: pnl.winRate,
      total_resolved: pnl.resolvedTrades,
      avg_roi: avgRoi,
      last_checked: now,
      status: walletStatus,
    });
  }

  const trader = {
    address,
    win_rate: pnl.winRate,
    total_profit: pnl.totalProfit,
    total_trades: pnl.totalTrades,
    resolved_trades: pnl.resolvedTrades,
    trading_days_30: tradingDays30,
    last_10_win_rate: last10WinRate ?? 0,
    is_cooling_off: isCoolingOff ? 1 : 0,
    last_fetched: now,
  };

  const qualified = preTrackOk && isQualified(trader, activity);
  return {
    ...trader,
    qualified,
    walletStatus,
    preTrackOk,
    reasons: getQualificationReasons(trader, activity, preTrackOk),
  };
}

function isQualified(trader, activity) {
  if (trader.resolved_trades < QUALIFICATION.minResolvedTrades) return false;
  if (trader.win_rate < QUALIFICATION.minWinRate) return false;
  if (trader.total_profit < QUALIFICATION.minTotalProfit) return false;
  if (trader.trading_days_30 < QUALIFICATION.minTradingDays30) return false;
  if (!hasRecentActivity(activity, 30)) return false;
  if (trader.is_cooling_off) return false;
  return true;
}

function getQualificationReasons(trader, activity, preTrackOk) {
  const reasons = [];
  if (!preTrackOk) {
    if (trader.resolved_trades < PRE_TRACK.minResolvedTrades) {
      reasons.push(`resolvedTrades ${trader.resolved_trades} < ${PRE_TRACK.minResolvedTrades}`);
    }
    if (trader.win_rate < PRE_TRACK.minWinRate) {
      reasons.push(`winRate ${(trader.win_rate * 100).toFixed(1)}% < 85%`);
    }
  }
  if (trader.resolved_trades < QUALIFICATION.minResolvedTrades) {
    reasons.push(`resolvedTrades ${trader.resolved_trades} < ${QUALIFICATION.minResolvedTrades}`);
  }
  if (trader.win_rate < QUALIFICATION.minWinRate) {
    reasons.push(`winRate ${(trader.win_rate * 100).toFixed(1)}% < 85%`);
  }
  if (trader.total_profit < QUALIFICATION.minTotalProfit) {
    reasons.push(`totalProfit $${trader.total_profit} < $500`);
  }
  if (trader.trading_days_30 < QUALIFICATION.minTradingDays30) {
    reasons.push(`tradingDays30 ${trader.trading_days_30} < 18`);
  }
  if (!hasRecentActivity(activity, 30)) {
    reasons.push('no activity in last 30 days');
  }
  if (trader.is_cooling_off) {
    reasons.push(`last 10 win rate ${(trader.last_10_win_rate * 100).toFixed(0)}% < 60% (cooling off)`);
  }
  return reasons;
}

function formatTraderResult(cached, meta = {}) {
  const preTrackOk = passesPreTrackFilter(cached.win_rate, cached.resolved_trades);
  return {
    address: cached.address,
    win_rate: cached.win_rate,
    total_profit: cached.total_profit,
    total_trades: cached.total_trades,
    resolved_trades: cached.resolved_trades,
    trading_days_30: cached.trading_days_30,
    last_10_win_rate: cached.last_10_win_rate,
    is_cooling_off: cached.is_cooling_off,
    last_fetched: cached.last_fetched,
    qualified:
      preTrackOk &&
      cached.is_cooling_off === 0 &&
      cached.resolved_trades >= QUALIFICATION.minResolvedTrades &&
      cached.win_rate >= QUALIFICATION.minWinRate &&
      cached.total_profit >= QUALIFICATION.minTotalProfit &&
      cached.trading_days_30 >= QUALIFICATION.minTradingDays30 &&
      (meta.walletStatus ?? 'ACTIVE') === 'ACTIVE',
    walletStatus: meta.walletStatus ?? 'ACTIVE',
    preTrackOk,
    fromCache: meta.fromCache ?? false,
    reasons: [],
  };
}

export async function runTraderDiscovery(options = {}) {
  const { limit = 200, forceRefresh = true, onProgress = null } = options;
  const leaderboard = await fetchLeaderboard(limit);

  const leaderboardMap = new Map();
  for (const entry of leaderboard) {
    const address = extractWalletAddress(entry);
    if (address) leaderboardMap.set(address.toLowerCase(), entry);
  }

  console.log('Fetching holder wallets from top liquid markets...');
  const holderWallets = await fetchTopHolderWallets(25, 15);
  console.log(`Found ${holderWallets.length} unique holder wallets to evaluate`);

  const addressesToEvaluate = [...new Set([...leaderboardMap.keys(), ...holderWallets])];

  let evaluated = 0;
  let qualified = 0;
  let degraded = 0;
  const results = [];

  for (const addressKey of addressesToEvaluate) {
    const entry = leaderboardMap.get(addressKey);
    const address = entry ? extractWalletAddress(entry) : addressKey;

    evaluated++;
    if (onProgress && (evaluated % 3 === 0 || evaluated === addressesToEvaluate.length)) {
      onProgress({ evaluated, total: addressesToEvaluate.length, qualified });
    }
    try {
      const result = await evaluateTrader(address, {
        forceRefresh,
        leaderboardEntry: entry ?? { pnl: 0 },
      });

      if (result.walletStatus === 'DEGRADED') degraded++;

      if (result.qualified && result.walletStatus === 'ACTIVE') {
        upsertEliteTrader({
          address: result.address,
          win_rate: result.win_rate,
          total_profit: result.total_profit,
          total_trades: result.total_trades,
          resolved_trades: result.resolved_trades,
          trading_days_30: result.trading_days_30,
          last_10_win_rate: result.last_10_win_rate,
          is_cooling_off: result.is_cooling_off,
          last_fetched: result.last_fetched,
        });
        qualified++;
      }
      results.push(result);
    } catch (err) {
      console.error(`Failed to evaluate ${address}:`, err.message);
    }
  }

  console.log(`Trader discovery: evaluated ${evaluated}, qualified ${qualified}, degraded ${degraded}`);
  return { evaluated, qualified, degraded, results };
}
