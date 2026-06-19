import { useCallback, useEffect, useState } from 'react';
import PicksDashboard from '../components/PicksDashboard.jsx';
import StatsBar from '../components/StatsBar.jsx';

const API = '/api';

function formatTimestamp(ts) {
  if (!ts) return 'Never';
  return new Date(Number(ts) * 1000).toLocaleString();
}

async function loadSwingHistory() {
  const dates = [];
  for (let i = 1; i <= 14; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    dates.push(d.toISOString().slice(0, 10));
  }

  const results = await Promise.all(
    dates.map(async (day) => {
      try {
        const res = await fetch(`${API}/picks?date=${day}&all=true`);
        if (!res.ok) return { date: day, signals: [] };
        const data = await res.json();
        return { date: day, signals: data.picks ?? [] };
      } catch {
        return { date: day, signals: [] };
      }
    })
  );

  return results.filter((d) => d.signals.length > 0);
}

export default function Home({ onRefresh, refreshing, refreshPhase, signalsVersion = 0 }) {
  const [picks, setPicks] = useState([]);
  const [date, setDate] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [stats, setStats] = useState(null);
  const [statsLoading, setStatsLoading] = useState(true);
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

  const loadHistory = useCallback(async () => {
    try {
      setHistoryDays(await loadSwingHistory());
    } catch {
      /* optional */
    }
  }, []);

  const loadPicks = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      const res = await fetch(`${API}/picks`, { signal: controller.signal });
      clearTimeout(timeout);
      if (!res.ok) throw new Error('Failed to load picks');
      const data = await res.json();
      setPicks(data.picks ?? []);
      setDate(data.date);
      setLastUpdated(data.lastUpdated);
    } catch (err) {
      setError(err.name === 'AbortError' ? 'Request timed out — is the backend running?' : err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPicks();
    loadStats();
    loadHistory();
  }, [loadPicks, loadStats, loadHistory]);

  useEffect(() => {
    if (signalsVersion > 0) {
      loadPicks();
      loadStats();
    }
  }, [signalsVersion, loadPicks, loadStats]);

  const handleRefresh = async () => {
    if (onRefresh) await onRefresh();
    await Promise.all([loadPicks(), loadStats(), loadHistory()]);
  };

  return (
    <div>
      <StatsBar stats={stats} loading={statsLoading} />
      <PicksDashboard
        picks={picks}
        loading={loading}
        error={error}
        date={date}
        onRefresh={handleRefresh}
        refreshing={refreshing}
        refreshPhase={refreshPhase}
        intraday={false}
        historyDays={historyDays}
        totalTrackedWallets={lastUpdated?.activeWalletCount ?? 0}
        activeWalletCount={lastUpdated?.activeWalletCount ?? 0}
        headerExtra={
          lastUpdated?.picks ? (
            <p className="text-gray-500 text-xs">Last updated: {formatTimestamp(lastUpdated.picks)}</p>
          ) : null
        }
      />
    </div>
  );
}
