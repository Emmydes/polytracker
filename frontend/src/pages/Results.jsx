import { useCallback, useEffect, useState } from 'react';
import ResultCard from '../components/ResultCard.jsx';
import SkeletonCard from '../components/SkeletonCard.jsx';
import StatsBar from '../components/StatsBar.jsx';

const API = '/api';

export default function Results() {
  const [signals, setSignals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('all');
  const [stats, setStats] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [resolvedRes, statsRes] = await Promise.all([
        fetch(`${API}/signals/resolved?horizon=${filter}&limit=50`),
        fetch(`${API}/signals/stats`),
      ]);
      if (!resolvedRes.ok) throw new Error('Failed to load results');
      const data = await resolvedRes.json();
      setSignals(data.signals ?? []);
      if (statsRes.ok) setStats(await statsRes.json());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    load();
  }, [load]);

  const filters = [
    { id: 'all', label: 'All' },
    { id: 'intraday', label: 'Daily' },
    { id: 'swing', label: 'Swing' },
  ];

  const won = signals.filter((s) => s.status === 'WON').length;
  const lost = signals.filter((s) => s.status === 'LOST').length;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl sm:text-2xl font-display font-semibold text-gray-100 mb-1">Results</h1>
        <p className="text-gray-400 text-sm">Settled signals — won, lost, and expired trades</p>
      </div>

      <StatsBar stats={stats} loading={loading && !stats} />

      <div className="flex gap-2 mb-6 overflow-x-auto pb-1">
        {filters.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            onClick={() => setFilter(id)}
            className={`shrink-0 px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
              filter === id
                ? 'bg-accent text-white'
                : 'border border-border text-gray-400 hover:text-gray-200'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {!loading && signals.length > 0 ? (
        <p className="text-sm text-gray-500 mb-4 font-display">
          {won} won · {lost} lost · {signals.length} total
        </p>
      ) : null}

      {error && (
        <div className="mb-6 p-4 bg-red-500/10 border border-red-500/30 rounded-lg text-red-300 text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <div className="grid gap-4 md:grid-cols-2">
          {[1, 2, 3].map((i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : signals.length === 0 ? (
        <div className="text-center py-16 bg-card border border-border rounded-[12px]">
          <p className="text-gray-400">No settled signals yet.</p>
          <p className="text-gray-500 text-sm mt-2">
            When markets resolve, results appear here automatically.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {signals.map((signal) => (
            <ResultCard key={`${signal.horizon}-${signal.id}`} signal={signal} />
          ))}
        </div>
      )}
    </div>
  );
}
