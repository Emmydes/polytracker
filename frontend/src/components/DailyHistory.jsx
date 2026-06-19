import { useState } from 'react';

function winRateColor(rate) {
  if (rate >= 0.6) return 'text-emerald-400';
  if (rate >= 0.4) return 'text-amber-400';
  return 'text-red-400';
}

export default function DailyHistory({ history, loading }) {
  const [open, setOpen] = useState(false);

  if (loading || !history?.length) return null;

  const pastDays = history.filter((d) => d.date !== new Date().toISOString().slice(0, 10));
  if (pastDays.length === 0) return null;

  return (
    <section className="mt-10 border-t border-border pt-8">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 text-sm font-display font-semibold text-gray-300 hover:text-white transition-colors mb-4"
      >
        <span>{open ? '▼' : '▶'}</span>
        Past 3 days
      </button>

      {open ? (
        <div className="space-y-6">
          {pastDays.map((day) => (
            <div key={day.date}>
              <div className="flex items-center gap-3 mb-3">
                <h3 className="font-display font-semibold text-gray-200">{day.date}</h3>
                <span className={`text-sm font-display font-semibold ${winRateColor(day.win_rate)}`}>
                  {(day.win_rate * 100).toFixed(0)}% win rate
                </span>
                <span className="text-xs text-gray-500">
                  {day.won}W · {day.lost}L · {day.pending} pending
                </span>
              </div>
              <div className="border border-border rounded-xl overflow-hidden">
                {day.signals.map((signal, idx) => (
                  <div
                    key={signal.id ?? `${signal.market_id}-${idx}`}
                    className={`flex flex-col sm:flex-row sm:items-center gap-2 px-4 py-3 text-sm ${
                      idx % 2 === 0 ? 'bg-card' : 'bg-navy/50'
                    }`}
                  >
                    <span className="flex-1 text-gray-300 truncate">{signal.market_title}</span>
                    <span className="font-display text-gray-400">{signal.recommended_side}</span>
                    <span className="font-display">{Math.round((signal.current_price ?? 0) * 100)}¢</span>
                    <span
                      className={`px-2 py-0.5 rounded-full text-xs ${
                        signal.status === 'WON'
                          ? 'bg-emerald-500/10 text-emerald-400'
                          : signal.status === 'LOST'
                            ? 'bg-red-500/10 text-red-400'
                            : 'bg-gray-500/10 text-gray-400'
                      }`}
                    >
                      {signal.status ?? 'ACTIVE'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
