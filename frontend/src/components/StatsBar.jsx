export default function StatsBar({ stats, loading }) {
  if (loading) {
    return (
      <div className="flex flex-wrap items-center gap-6 py-4 mb-6 border-b border-border animate-pulse">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-8 w-24 bg-navy rounded" />
        ))}
      </div>
    );
  }

  if (!stats) return null;

  const winPct = stats.win_rate != null ? (stats.win_rate * 100).toFixed(0) : '—';
  const roiPct = stats.avg_roi != null ? (stats.avg_roi * 100).toFixed(1) : '—';

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 py-4 mb-6 border-b border-border text-sm">
      <div>
        <span className="text-gray-500 mr-2">Win rate</span>
        <span className="font-display text-lg font-semibold text-emerald-400">{winPct}%</span>
      </div>
      <div className="hidden sm:block w-px h-6 bg-border" />
      <div>
        <span className="text-gray-500 mr-2">Avg ROI</span>
        <span className="font-display text-lg font-semibold">{roiPct}%</span>
      </div>
    </div>
  );
}
