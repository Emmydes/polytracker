import { useEffect, useState } from 'react';
import { getCategoryLabel } from '../utils/categories.js';
import {
  confidenceBadgeStyle,
  formatCountdownLong,
  formatPriceDollar,
  formatRelativeTime,
  formatShortDate,
  fixPickMarketUrl,
  getConfidenceBreakdown,
  getDivergencePct,
  getEnterBeforePrice,
  getEntryWindowEndMs,
  getMarketPct,
  getSmartMoneyPct,
  isPickEntryClosed,
  strengthAccentColor,
} from '../utils/signalFormat.js';
import ConfidenceBreakdown from './ConfidenceBreakdown.jsx';
import WalletTable from './WalletTable.jsx';

function SignalHistory({ items }) {
  if (!items?.length) return null;

  return (
    <div>
      <h4 className="text-sm text-gray-400 mb-2">Previous signals on this market</h4>
      <ul className="space-y-1.5 text-sm">
        {items.map((item, idx) => (
          <li key={`${item.date}-${item.id ?? idx}`} className="text-gray-300 font-display">
            {formatShortDate(item.date)} · {item.recommended_side} ·{' '}
            <span
              className={
                item.status === 'WON' || item.outcome === 'WON'
                  ? 'text-emerald-400'
                  : item.status === 'LOST' || item.outcome === 'LOST'
                    ? 'text-red-400'
                    : 'text-gray-500'
              }
            >
              {item.status ?? item.outcome ?? 'ACTIVE'}
            </span>
            {item.confidence != null ? ` · confidence ${item.confidence}` : ''}
          </li>
        ))}
      </ul>
    </div>
  );
}

function useEntryRemaining(pick, intraday, expired) {
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    if (expired) return undefined;
    const tick = () => setRemaining(Math.max(0, getEntryWindowEndMs(pick, intraday) - Date.now()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [pick, intraday, expired]);

  return remaining;
}

function EntryTimer({ pick, intraday, expired, compact = false }) {
  const remaining = useEntryRemaining(pick, intraday, expired);

  if (expired) {
    return <span className="text-gray-500 text-sm">Market settled</span>;
  }

  const urgent = remaining < 3600 * 1000;
  const text = formatCountdownLong(remaining);

  if (compact) {
    return (
      <span className={`font-display ${urgent ? 'text-red-400' : 'text-gray-200'}`}>in {text}</span>
    );
  }

  return (
    <span className={`text-sm ${urgent ? 'text-red-400' : 'text-gray-400'}`}>
      ⏱ Closes {intraday ? 'in ' : ''}{text}{intraday ? '' : ' until settlement'}
    </span>
  );
}

export default function SignalCard({
  pick,
  intraday = false,
  expanded,
  onToggle,
  totalTrackedWallets,
  marketHistory,
}) {
  const [wallets, setWallets] = useState([]);
  const [walletsLoading, setWalletsLoading] = useState(false);

  const pickView = fixPickMarketUrl(pick);
  const entryClosed = isPickEntryClosed(pickView, intraday);
  const marketPct = getMarketPct(pickView);
  const smartPct = getSmartMoneyPct(pickView);
  const divergence = getDivergencePct(pickView);
  const enterBefore = getEnterBeforePrice(pickView);
  const breakdown = getConfidenceBreakdown(pickView, totalTrackedWallets);
  const categoryLabel = pickView.market_category ? getCategoryLabel(pickView.market_category) : 'General';
  const cardId = pickView.id ?? `${pickView.market_id}-${pickView.recommended_side}`;

  useEffect(() => {
    if (!expanded) return undefined;

    let cancelled = false;
    setWalletsLoading(true);

    fetch(`/api/market/${pickView.market_id}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data?.positions) return;
        setWallets(
          data.positions
            .filter((p) => p.side === pickView.recommended_side)
            .map((p) => ({
              address: p.address,
              win_rate: p.win_rate,
              avg_price: p.avg_price,
              size: p.size,
              side: p.side,
            }))
        );
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setWalletsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [expanded, pickView.market_id, pickView.recommended_side]);

  return (
    <article
      role="button"
      tabIndex={0}
      onClick={() => onToggle(cardId)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onToggle(cardId);
        }
      }}
      className={`relative bg-card border border-border rounded-[12px] overflow-hidden cursor-pointer transition-colors duration-200 hover:border-gray-600 ${
        entryClosed ? 'opacity-80' : ''
      }`}
    >
      <div className={`absolute left-0 top-0 bottom-0 w-1 ${strengthAccentColor(pickView.strength)}`} />

      <div className="pl-4 pr-4 pt-4 pb-3">
        <div className="flex items-start justify-between gap-2 mb-2">
          <span className="px-2 py-0.5 rounded-full text-xs border border-border text-gray-400">
            {categoryLabel}
          </span>
          <span
            className={`shrink-0 px-2.5 py-0.5 rounded-full text-xs font-display font-semibold ${confidenceBadgeStyle(pickView.confidence)}`}
          >
            {pickView.confidence ?? '—'}
          </span>
        </div>

        <h3 className="text-sm font-medium text-gray-100 line-clamp-2 mb-2">{pickView.market_title}</h3>

        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm mb-2">
          <span className="font-display font-semibold text-gray-200">
            {pickView.recommended_side} · {marketPct}%
          </span>
          <span className="text-gray-600">→</span>
          <span className="font-display text-gray-400">Smart money: {smartPct}%</span>
          <span
            className={`font-display text-xs ${divergence >= 0 ? 'text-emerald-400' : 'text-amber-400'}`}
          >
            Divergence: {divergence >= 0 ? '+' : ''}{divergence}%
          </span>
        </div>

        <div className="mb-3">
          <EntryTimer pick={pickView} intraday={intraday} expired={entryClosed} />
        </div>

        <div className="flex flex-wrap gap-2 text-xs">
          <span className="px-2 py-0.5 rounded-full bg-navy text-gray-400">
            {pickView.strength ?? 'MODERATE'} signal
          </span>
          <span className="px-2 py-0.5 rounded-full bg-navy text-gray-400 font-display">
            {pickView.elite_trader_count ?? 0} wallets
          </span>
          <span className="px-2 py-0.5 rounded-full bg-navy text-gray-400 font-display">
            Enter before {formatPriceDollar(enterBefore)}
          </span>
        </div>
      </div>

      <div
        className={`overflow-hidden transition-[max-height] duration-300 ease-in-out border-t border-border ${
          expanded ? 'max-h-[1200px]' : 'max-h-0'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="pl-4 pr-4 py-4 space-y-6 bg-navy/30">
          <section>
            <h4 className="text-sm text-gray-400 mb-3">Market snapshot</h4>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-gray-500">Market price now</dt>
                <dd className="font-display text-gray-200 text-right">
                  {formatPriceDollar(pickView.current_price)} {pickView.recommended_side}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-gray-500">Smart money target</dt>
                <dd className="font-display text-gray-200 text-right">
                  {formatPriceDollar(pickView.entry_price)} {pickView.recommended_side}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-gray-500">Divergence</dt>
                <dd className="font-display text-emerald-400 text-right">
                  {divergence >= 0 ? '+' : ''}{divergence}%
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-gray-500">Signal strength</dt>
                <dd className="font-display text-gray-200 text-right">{pickView.strength ?? 'MODERATE'}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-gray-500">Signal created</dt>
                <dd className="text-gray-300 text-right">{formatRelativeTime(pickView.created_at)}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-gray-500">Entry window closes</dt>
                <dd className="text-right">
                  {entryClosed ? (
                    <span className="text-gray-500">Closed</span>
                  ) : (
                    <EntryTimer pick={pickView} intraday={intraday} expired={false} compact />
                  )}
                </dd>
              </div>
            </dl>
          </section>

          <section>
            <h4 className="text-sm text-gray-400 mb-3">Wallets that entered</h4>
            <WalletTable wallets={wallets} loading={walletsLoading} />
          </section>

          <section>
            <ConfidenceBreakdown
              breakdown={{
                participation: breakdown.participation,
                avgWinRate: breakdown.avgWinRate,
                divergence: breakdown.divergence,
                divergenceRaw: Math.abs(Math.round(pickView.drift_pct ?? divergence)),
                overall: breakdown.overall,
                trackedWallets: `${pickView.elite_trader_count ?? 0} of ${breakdown.tracked}`,
              }}
            />
          </section>

          <SignalHistory items={marketHistory} />

          {pickView.market_url ? (
            <a
              href={pickView.market_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block text-sm text-accent hover:text-indigo-300"
              onClick={(e) => e.stopPropagation()}
            >
              View on Polymarket →
            </a>
          ) : null}
        </div>
      </div>
    </article>
  );
}
