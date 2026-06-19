export function formatPriceDollar(price) {
  if (price == null) return '—';
  return `$${Number(price).toFixed(2)}`;
}

export function formatPctFromPrice(price) {
  if (price == null) return '—';
  return `${Math.round(Number(price) * 100)}%`;
}

export function formatWalletAddress(address) {
  if (!address) return '—';
  return `${address.slice(0, 4)}...${address.slice(-2)}`;
}

export function formatCountdown(ms) {
  if (ms <= 0) return '0m';
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function formatCountdownLong(ms) {
  if (ms <= 0) return '0m';
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function formatRelativeTime(unixSec) {
  if (!unixSec) return '—';
  const diff = Math.floor(Date.now() / 1000) - unixSec;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)} minutes ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} hours ago`;
  return `${Math.floor(diff / 86400)} days ago`;
}

export function formatDisplayDate(dateStr) {
  if (!dateStr) return '';
  return new Date(`${dateStr}T12:00:00`).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

export function formatShortDate(dateStr) {
  if (!dateStr) return '—';
  return new Date(`${dateStr}T12:00:00`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

export function getEntryWindowEndMs(pick, intraday) {
  if (pick.entry_window_close) return pick.entry_window_close * 1000;
  const created = (pick.created_at ?? Math.floor(Date.now() / 1000)) * 1000;
  const defaultHours = intraday ? 12 : 24;
  if (intraday && pick.hours_until_close != null) {
    const settleMs = Date.now() + pick.hours_until_close * 3600 * 1000;
    const defaultEnd = created + defaultHours * 3600 * 1000;
    return Math.min(settleMs, defaultEnd);
  }
  return created + defaultHours * 3600 * 1000;
}

export function getSmartMoneyPct(pick) {
  return Math.round((pick.entry_price ?? pick.current_price ?? 0) * 100);
}

export function getMarketPct(pick) {
  return Math.round((pick.current_price ?? 0) * 100);
}

export function getDivergencePct(pick) {
  return getSmartMoneyPct(pick) - getMarketPct(pick);
}

export function getEnterBeforePrice(pick) {
  const entry = pick.entry_price ?? pick.current_price ?? 0;
  return Math.min(entry * 1.05, 0.89);
}

export function getConfidenceBreakdown(pick, totalTrackedWallets) {
  const tracked = totalTrackedWallets || Math.max(pick.elite_trader_count ?? 1, 4);
  const participation = Math.min(100, ((pick.elite_trader_count ?? 0) / tracked) * 100);
  const avgWinRate = (pick.avg_win_rate ?? 0) * 100;
  const divergence = Math.min(100, (Math.abs(pick.drift_pct ?? 0) / 15) * 100);
  const overall = pick.confidence ?? Math.round(participation * 0.4 + avgWinRate * 0.4 + divergence * 0.2);

  return {
    participation: Math.round(participation),
    avgWinRate: Math.round(avgWinRate),
    divergence: Math.round(divergence),
    overall,
    tracked,
  };
}

export function strengthAccentColor(strength) {
  if (strength === 'STRONG') return 'bg-emerald-500';
  if (strength === 'MODERATE') return 'bg-amber-500';
  return 'bg-gray-500';
}

export function confidenceBadgeStyle(confidence) {
  const score = confidence ?? 0;
  if (score >= 75) return 'bg-emerald-500/15 text-emerald-400';
  if (score >= 50) return 'bg-amber-500/15 text-amber-400';
  return 'bg-gray-500/15 text-gray-400';
}

export function winRateColor(rate) {
  if (rate >= 90) return 'text-emerald-400';
  if (rate >= 85) return 'text-amber-400';
  return 'text-gray-400';
}
