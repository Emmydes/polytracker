import { useCallback, useEffect, useMemo, useState } from 'react';
import { enrichPick } from '../utils/categories.js';
import { formatProfitPct, profitPctColor } from '../utils/signalFormat.js';

const API = '/api';

function resultBadgeClass(status) {
  if (status === 'WON') return 'bg-emerald-500/15 text-emerald-400';
  if (status === 'LOST') return 'bg-red-500/15 text-red-400';
  return 'bg-gray-500/15 text-gray-400';
}

export default function Results() {
  const [signals, setSignals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('all');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API}/signals/resolved?horizon=${filter}&limit=50&decided=true`);
      if (!res.ok) throw new Error('Failed to load results');
      const data = await res.json();
      setSignals(data.signals ?? []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    load();
  }, [load]);

  const rows = useMemo(
    () =>
      signals
        .filter((s) => s.status === 'WON' || s.status === 'LOST')
        .map((signal) => {
          const pick = enrichPick(signal);
          return { signal, pick };
        }),
    [signals]
  );

  const won = rows.filter((r) => r.signal.status === 'WON').length;
  const lost = rows.filter((r) => r.signal.status === 'LOST').length;
  const winRate = won + lost > 0 ? Math.round((won / (won + lost)) * 100) : null;

  const filters = [
    { id: 'all', label: 'All' },
    { id: 'intraday', label: 'Daily' },
    { id: 'swing', label: 'Swing' },
  ];

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl sm:text-2xl font-display font-semibold text-gray-100 mb-1">Results</h1>
        <p className="text-gray-400 text-sm">Settled signal trades — win/loss and profit %</p>
      </div>

      {!loading && rows.length > 0 ? (
        <p className="text-sm text-gray-500 mb-4 font-display">
          {won} won · {lost} lost
          {winRate != null ? ` · ${winRate}% win rate` : ''}
        </p>
      ) : null}

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

      {error && (
        <div className="mb-6 p-4 bg-red-500/10 border border-red-500/30 rounded-lg text-red-300 text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <div className="bg-card border border-border rounded-[12px] overflow-hidden animate-pulse">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-14 border-b border-border last:border-0 bg-navy/30" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="text-center py-16 bg-card border border-border rounded-[12px]">
          <p className="text-gray-400">No settled trades yet.</p>
          <p className="text-gray-500 text-sm mt-2">
            When markets resolve, WON/LOST results appear here.
          </p>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-[12px] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="px-4 py-3 font-medium">Market</th>
                  <th className="px-4 py-3 font-medium w-16">Side</th>
                  <th className="px-4 py-3 font-medium w-20">Result</th>
                  <th className="px-4 py-3 font-medium w-24 text-right">Profit</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ signal, pick }) => (
                  <tr
                    key={`${signal.horizon}-${signal.id}`}
                    className="border-b border-border last:border-0 hover:bg-navy/40 transition-colors"
                  >
                    <td className="px-4 py-3 text-gray-100">
                      <span className="line-clamp-2">{pick.market_title}</span>
                      <span className="text-xs text-gray-500 capitalize">{signal.horizon}</span>
                    </td>
                    <td className="px-4 py-3 font-display text-gray-300">{pick.recommended_side}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-display font-semibold ${resultBadgeClass(signal.status)}`}
                      >
                        {signal.status}
                      </span>
                    </td>
                    <td
                      className={`px-4 py-3 text-right font-display font-semibold tabular-nums ${profitPctColor(signal)}`}
                    >
                      {formatProfitPct(signal)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
