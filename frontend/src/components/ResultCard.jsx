import { enrichPick } from '../utils/categories.js';
import { formatPriceDollar, formatShortDate, strengthAccentColor } from '../utils/signalFormat.js';

function statusStyle(status) {
  if (status === 'WON') return 'bg-emerald-500/10 text-emerald-400';
  if (status === 'LOST') return 'bg-red-500/10 text-red-400';
  return 'bg-gray-500/10 text-gray-400';
}

export default function ResultCard({ signal }) {
  const pick = enrichPick(signal);
  const status = signal.status ?? signal.outcome ?? 'EXPIRED';

  return (
    <article className="relative bg-card border border-border rounded-[12px] p-4 overflow-hidden">
      <div className={`absolute left-0 top-0 bottom-0 w-1 ${strengthAccentColor(pick.strength)}`} />
      <div className="pl-3">
        <div className="flex items-start justify-between gap-2 mb-2">
          <span className="text-xs text-gray-500 uppercase tracking-wide">{signal.horizon ?? 'signal'}</span>
          <span className={`px-2.5 py-0.5 rounded-full text-xs font-display font-semibold ${statusStyle(status)}`}>
            {status}
          </span>
        </div>
        <h3 className="text-sm font-medium text-gray-100 mb-2 line-clamp-2">{pick.market_title}</h3>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-400">
          <span className="font-display text-gray-200">
            {pick.recommended_side} @ {formatPriceDollar(pick.entry_price)}
          </span>
          {pick.confidence != null ? (
            <span className="font-display">Confidence {pick.confidence}</span>
          ) : null}
          <span>{formatShortDate(signal.signal_date ?? signal.date)}</span>
        </div>
        {signal.resolved_at ? (
          <p className="text-xs text-gray-500 mt-2">
            Settled {new Date(signal.resolved_at * 1000).toLocaleString()}
          </p>
        ) : null}
      </div>
    </article>
  );
}
