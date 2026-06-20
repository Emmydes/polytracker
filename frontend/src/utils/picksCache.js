const SWING_CACHE_KEY = 'polytracker_swing_picks_v1';
const DAILY_CACHE_KEY = 'polytracker_daily_picks_v1';

export function readPicksCache(key) {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data?.picks) return null;
    return data;
  } catch {
    return null;
  }
}

export function writePicksCache(key, data) {
  try {
    sessionStorage.setItem(
      key,
      JSON.stringify({
        picks: data.picks ?? [],
        date: data.date ?? '',
        lastUpdated: data.lastUpdated ?? null,
        savedAt: Date.now(),
      })
    );
  } catch {
    /* storage full or private mode */
  }
}

export { SWING_CACHE_KEY, DAILY_CACHE_KEY };
