import { useCallback, useEffect, useState } from 'react';
import DailyHistory from '../components/DailyHistory.jsx';
import PicksDashboard from '../components/PicksDashboard.jsx';
import { formatLastUpdated } from '../utils/autoRefresh.js';

const API = '/api';

export default function Intraday({ signalsVersion = 0 }) {
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
      const res = await fetch(`${API}/signals/daily/history?days=7`);
      if (res.ok) setHistory(await res.json());
    } catch {
      /* optional */
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  const loadPicks = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API}/picks/intraday`);
      if (!res.ok) throw new Error('Could not load signals');
      const data = await res.json();
      setPicks(data.picks ?? []);
      setDate(data.date);
      setLastUpdated(data.lastUpdated);
    } catch (err) {
      setError(err.message);
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
        loading={loading}
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
