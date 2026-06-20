import { useCallback, useEffect, useState } from 'react';
import PicksDashboard from '../components/PicksDashboard.jsx';
import StatsBar from '../components/StatsBar.jsx';
import { formatLastUpdated } from '../utils/autoRefresh.js';
import { SWING_CACHE_KEY, readPicksCache, writePicksCache } from '../utils/picksCache.js';
import { fixPickMarketUrl } from '../utils/signalFormat.js';

const API = '/api';

export default function Home({ signalsVersion = 0 }) {
  const cached = readPicksCache(SWING_CACHE_KEY);
  const [picks, setPicks] = useState(() => (cached?.picks ?? []).map(fixPickMarketUrl));
  const [date, setDate] = useState(cached?.date ?? '');
  const [loading, setLoading] = useState(!cached?.picks?.length);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(cached?.lastUpdated ?? null);
  const [stats, setStats] = useState(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [historyDays, setHistoryDays] = useState([]);

  const loadStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      const res = await fetch(`${API}/signals/stats`);
      if (res.ok) setStats(await res.json());
    } catch {
      /* optional */
    } finally {
      setStatsLoading(false);
    }
  }, []);

  const loadPicks = useCallback(async ({ silent = false } = {}) => {
    if (!silent && picks.length === 0) setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API}/picks`);
      if (!res.ok) throw new Error('Could not load signals');
      const data = await res.json();
      const nextPicks = (data.picks ?? []).map(fixPickMarketUrl);
      setPicks(nextPicks);
      setDate(data.date);
      setLastUpdated(data.lastUpdated);
      writePicksCache(SWING_CACHE_KEY, data);
    } catch (err) {
      if (picks.length === 0) setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [picks.length]);

  useEffect(() => {
    loadPicks({ silent: picks.length > 0 });
    const statsTimer = window.setTimeout(loadStats, 400);
    return () => window.clearTimeout(statsTimer);
  }, [loadPicks, loadStats, picks.length]);

  useEffect(() => {
    if (signalsVersion > 0) {
      loadPicks({ silent: true });
      loadStats();
    }
  }, [signalsVersion, loadPicks, loadStats]);

  const updatedLabel =
    formatLastUpdated(lastUpdated?.curatedRefresh ?? lastUpdated?.picks) ?? 'Auto-updates every 6 hours';

  return (
    <div>
      {stats || statsLoading ? <StatsBar stats={stats} loading={statsLoading} /> : null}
      <PicksDashboard
        picks={picks}
        loading={loading && picks.length === 0}
        error={error}
        date={date}
        intraday={false}
        historyDays={historyDays}
        totalTrackedWallets={lastUpdated?.activeWalletCount ?? 0}
        statusLabel={updatedLabel}
      />
    </div>
  );
}
