import { useCallback, useEffect, useState } from 'react';
import DailyHistory from '../components/DailyHistory.jsx';
import PicksDashboard from '../components/PicksDashboard.jsx';

const API = '/api';

function formatTimestamp(ts) {
  if (!ts) return 'Never';
  return new Date(Number(ts) * 1000).toLocaleString();
}

export default function Intraday({ onRefresh, refreshing, refreshPhase, signalsVersion = 0 }) {
  const [picks, setPicks] = useState([]);
  const [date, setDate] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(true);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const res = await fetch(`${API}/signals/daily/history?days=14`);
      if (res.ok) setHistory(await res.json());
    } catch {
      /* optional */
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  const loadPicks = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      const res = await fetch(`${API}/picks/intraday`, { signal: controller.signal });
      clearTimeout(timeout);
      if (!res.ok) throw new Error('Failed to load daily signals');
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
    loadHistory();
  }, [loadPicks, loadHistory]);

  useEffect(() => {
    if (signalsVersion > 0) {
      loadPicks();
      loadHistory();
    }
  }, [signalsVersion, loadPicks, loadHistory]);

  const handleRefresh = async () => {
    if (onRefresh) await onRefresh();
    await Promise.all([loadPicks(), loadHistory()]);
  };

  return (
    <div>
      <PicksDashboard
        picks={picks}
        loading={loading}
        error={error}
        date={date}
        onRefresh={handleRefresh}
        refreshing={refreshing}
        refreshPhase={refreshPhase}
        intraday
        historyDays={history}
        totalTrackedWallets={lastUpdated?.activeWalletCount ?? 0}
        activeWalletCount={lastUpdated?.activeWalletCount ?? 0}
        headerExtra={
          lastUpdated?.intraday ? (
            <p className="text-gray-500 text-xs">Last updated: {formatTimestamp(lastUpdated.intraday)}</p>
          ) : null
        }
      />
      <DailyHistory history={history} loading={historyLoading} />
    </div>
  );
}
