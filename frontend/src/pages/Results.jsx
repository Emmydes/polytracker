import { useCallback, useEffect, useState } from 'react';

const API = '/api';

function formatPrice(value) {
  if (value == null || Number.isNaN(Number(value))) return '—';
  return `$${Number(value).toFixed(2)}`;
}

function formatProfitPct(value) {
  if (value == null || Number.isNaN(Number(value))) return '—';
  const n = Number(value);
  const sign = n >= 0 ? '+' : '';
  return `${sign}${Math.round(n)}%`;
}

function profitClass(value) {
  const n = Number(value);
  if (Number.isNaN(n) || n === 0) return 'text-gray-300';
  return n > 0 ? 'text-emerald-400' : 'text-red-400';
}

function resultLabel(outcome) {
  if (outcome === 'WON') return '✅ WON';
  if (outcome === 'LOST') return '❌ LOST';
  return outcome;
}

function resultBadgeClass(outcome) {
  if (outcome === 'WON') return 'bg-emerald-500/15 text-emerald-400';
  if (outcome === 'LOST') return 'bg-red-500/15 text-red-400';
  return 'bg-gray-500/15 text-gray-400';
}

export default function Results() {
  const [results, setResults] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API}/results?limit=100`);
      if (!res.ok) throw new Error('Failed to load results');
      const data = await res.json();
      setResults(data.results ?? []);
      setStats(data.stats ?? null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const winRatePct =
    stats?.winRate != null ? Math.round(stats.winRate * 100) : null;
  const avgProfit =
    stats?.avgProfitPercent != null
      ? Math.round(stats.avgProfitPercent)
      : null;

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-lg font-display font-semibold text-gray-100 mb-1">Results</h1>
        <p className="text-gray-400 text-xs">
          Settled trades from tracked wallets — no market resolution lookups
        </p>
      </div>

      {!loading && stats?.total > 0 ? (
        <div className="mb-6 grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-card border border-border rounded-[12px] px-4 py-3">
            <p className="text-xs text-gray-500 uppercase tracking-wide">Trades</p>
            <p className="text-lg font-display font-semibold text-gray-100">{stats.total}</p>
          </div>
          <div className="bg-card border border-border rounded-[12px] px-4 py-3">
            <p className="text-xs text-gray-500 uppercase tracking-wide">Win rate</p>
            <p className="text-lg font-display font-semibold text-emerald-400">
              {winRatePct != null ? `${winRatePct}%` : '—'}
            </p>
          </div>
          <div className="bg-card border border-border rounded-[12px] px-4 py-3">
            <p className="text-xs text-gray-500 uppercase tracking-wide">Avg profit</p>
            <p className={`text-lg font-display font-semibold ${profitClass(avgProfit)}`}>
              {avgProfit != null ? formatProfitPct(avgProfit) : '—'}
            </p>
          </div>
          <div className="bg-card border border-border rounded-[12px] px-4 py-3">
            <p className="text-xs text-gray-500 uppercase tracking-wide">Record</p>
            <p className="text-lg font-display font-semibold text-gray-100">
              {stats.wins}W · {stats.losses}L
            </p>
          </div>
        </div>
      ) : null}

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
      ) : results.length === 0 ? (
        <div className="text-center py-16 bg-card border border-border rounded-[12px]">
          <p className="text-gray-400">No settled trades yet.</p>
          <p className="text-gray-500 text-sm mt-2">
            Results populate when curated wallets are refreshed.
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
                  <th className="px-4 py-3 font-medium w-20 text-right">Entry</th>
                  <th className="px-4 py-3 font-medium w-20 text-right">Exit</th>
                  <th className="px-4 py-3 font-medium w-24 text-right">Profit</th>
                  <th className="px-4 py-3 font-medium w-28">Result</th>
                </tr>
              </thead>
              <tbody>
                {results.map((row) => (
                  <tr
                    key={row.id}
                    className="border-b border-border last:border-0 hover:bg-navy/40 transition-colors"
                  >
                    <td className="px-4 py-3 text-gray-100">
                      <span className="line-clamp-2">{row.market_title}</span>
                    </td>
                    <td className="px-4 py-3 font-display text-gray-300">{row.side}</td>
                    <td className="px-4 py-3 text-right font-display tabular-nums text-gray-300">
                      {formatPrice(row.entry_price)}
                    </td>
                    <td className="px-4 py-3 text-right font-display tabular-nums text-gray-300">
                      {formatPrice(row.exit_price)}
                    </td>
                    <td
                      className={`px-4 py-3 text-right font-display font-semibold tabular-nums ${profitClass(row.profit_percent)}`}
                    >
                      {formatProfitPct(row.profit_percent)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-display font-semibold whitespace-nowrap ${resultBadgeClass(row.outcome)}`}
                      >
                        {resultLabel(row.outcome)}
                      </span>
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
