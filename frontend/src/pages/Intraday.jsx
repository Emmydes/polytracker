import { useCallback, useEffect, useState } from 'react';
import DailyHistory from '../components/DailyHistory.jsx';
import PicksDashboard from '../components/PicksDashboard.jsx';
import { formatLastUpdated } from '../utils/autoRefresh.js';
import { DAILY_CACHE_KEY, readPicksCache, writePicksCache } from '../utils/picksCache.js';
import { fixPickMarketUrl } from '../utils/signalFormat.js';

const API = '/api';

export default function Intraday({ signalsVersion = 0 }) {
  const cached = readPicksCache(DAILY_CACHE_KEY);
  const [picks, setPicks] = useState(() => (cached?.picks ?? []).map(fixPickMarketUrl));
  const [date, setDate] = useState(cached?.date ?? '');
  const [loading, setLoading] = useState(!cached?.picks?.length);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(cached?.lastUpdated ?? null);
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const res = await fetch(`${API}/signals/daily/history?days=7`);
      if (res.ok) setHistory(await res.json());
    } catch {
      /* optional */
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  const loadPicks = useCallback(async ({ silent = false } = {}) => {
    if (!silent && picks.length === 0) setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API}/picks/intraday`);
      if (!res.ok) throw new Error('Could not load signals');
      const data = await res.json();
      const nextPicks = (data.picks ?? []).map(fixPickMarketUrl);
      setPicks(nextPicks);
      setDate(data.date);
      setLastUpdated(data.lastUpdated);
      writePicksCache(DAILY_CACHE_KEY, data);
    } catch (err) {
      if (picks.length === 0) setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [picks.length]);

  useEffect(() => {
    loadPicks({ silent: picks.length > 0 });
    const historyTimer = window.setTimeout(loadHistory, 600);
    return () => window.clearTimeout(historyTimer);
  }, [loadPicks, loadHistory, picks.length]);

  useEffect(() => {
    if (signalsVersion > 0) {
      loadPicks({ silent: true });
      loadHistory();
    }
  }, [signalsVersion, loadPicks, loadHistory]);

  const updatedLabel =
    formatLastUpdated(lastUpdated?.curatedRefresh ?? lastUpdated?.intraday) ?? 'Auto-updates every 6 hours';

  return (
    <div>
      <PicksDashboard
        picks={picks}
        loading={loading && picks.length === 0}
        error={error}
        date={date}
        intraday
        historyDays={history}
        totalTrackedWallets={lastUpdated?.activeWalletCount ?? 0}
        statusLabel={updatedLabel}
      />
      <DailyHistory history={history} loading={historyLoading} />
    </div>
  );
}
