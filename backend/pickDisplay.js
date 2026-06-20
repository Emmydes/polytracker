/** Whether a pick's underlying market is still open (not settled). */
export function isPickMarketStillOpen(pick) {
  if (!pick) return false;
  if (pick.status === 'WON' || pick.status === 'LOST') return false;
  if (pick.outcome === 'WON' || pick.outcome === 'LOST') return false;

  if (pick.close_date) {
    const end = new Date(pick.close_date).getTime();
    if (Number.isFinite(end) && end > Date.now()) return true;
    if (Number.isFinite(end) && end <= Date.now()) return false;
  }

  if (pick.hours_until_close != null) {
    return Number(pick.hours_until_close) > 0;
  }

  return pick.status === 'ACTIVE' || pick.status === 'EXPIRED';
}

export function fixPickMarketUrl(pick) {
  if (!pick) return pick;
  const url = pick.market_url ?? '';
  if (url && !url.includes('/market/0x')) return pick;

  const title = pick.market_title?.trim();
  return {
    ...pick,
    market_url: title
      ? `https://polymarket.com/search?q=${encodeURIComponent(title)}`
      : 'https://polymarket.com',
  };
}

export function normalizeSwingPickForDisplay(pick) {
  if (!pick) return pick;
  let next = fixPickMarketUrl(pick);
  if (next.status === 'EXPIRED' && isPickMarketStillOpen(next)) {
    next = {
      ...next,
      status: 'ACTIVE',
      entry_window_close: null,
      outcome: null,
    };
  }
  return next;
}

export function normalizeDailyPickForDisplay(pick) {
  if (!pick) return pick;
  return fixPickMarketUrl(pick);
}
