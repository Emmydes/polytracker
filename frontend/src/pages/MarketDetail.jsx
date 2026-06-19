import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import SkeletonCard from '../components/SkeletonCard.jsx';

const API = '/api';

function shortenAddress(address) {
  if (!address) return '—';
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export default function MarketDetail() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const res = await fetch(`${API}/market/${id}`);
        if (!res.ok) throw new Error('Failed to load market');
        setData(await res.json());
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    if (id) load();
  }, [id]);

  if (loading) {
    return (
      <div className="space-y-4">
        <SkeletonCard />
        <SkeletonCard />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-lg text-red-300">
        {error}
      </div>
    );
  }

  const title = data?.market?.question ?? data?.market?.title ?? data?.positions?.[0]?.market_title ?? 'Market';
  const grouped = groupBySide(data?.positions ?? []);

  return (
    <div>
      <Link to="/" className="text-sm text-gray-400 hover:text-accent mb-4 inline-block">
        ← Back to signals
      </Link>
      <h1 className="text-2xl sm:text-3xl font-display font-bold mb-2">{title}</h1>
      <p className="text-gray-400 text-sm mb-8">
        {data?.eliteCount ?? 0} active tracked wallets in this market
      </p>

      {Object.keys(grouped).length === 0 ? (
        <div className="text-center py-12 bg-card border border-border rounded-xl text-gray-400">
          No tracked wallet positions cached for this market.
        </div>
      ) : (
        Object.entries(grouped).map(([side, positions]) => (
          <section key={side} className="mb-8">
            <h2
              className={`text-lg font-display font-semibold mb-4 ${
                side === 'YES' ? 'text-emerald-400' : 'text-red-400'
              }`}
            >
              {side} — {positions.length} wallet{positions.length !== 1 ? 's' : ''}
            </h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {positions.map((pos) => (
                <div
                  key={`${pos.address}-${pos.side}`}
                  className="bg-card border border-border rounded-lg p-4"
                >
                  <p className="font-mono text-sm mb-2">{shortenAddress(pos.address)}</p>
                  <div className="flex flex-wrap gap-2 text-xs text-gray-400">
                    <span className="font-display">Size: ${Number(pos.size).toFixed(0)}</span>
                    <span className="font-display">Win rate: {((pos.win_rate ?? 0) * 100).toFixed(1)}%</span>
                    {pos.avg_price ? (
                      <span className="font-display">Entry: {Math.round(pos.avg_price * 100)}¢</span>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}

function groupBySide(positions) {
  return positions.reduce((acc, pos) => {
    const side = pos.side ?? 'YES';
    if (!acc[side]) acc[side] = [];
    acc[side].push(pos);
    return acc;
  }, {});
}
