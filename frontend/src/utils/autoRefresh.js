export const AUTO_REFRESH_MS = 6 * 60 * 60 * 1000;
export const STATUS_POLL_MS = 60 * 1000;

export function formatLastUpdated(ts) {
  if (!ts) return null;
  return new Date(Number(ts) * 1000).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function getServerRefreshToken(data) {
  return [
    data?.curatedRefresh,
    data?.picks,
    data?.intraday,
    data?.manualRefresh,
    data?.picksCount,
    data?.intradayCount,
  ].join(':');
}
