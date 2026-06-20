import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { enrichPick, getCategoryLabel, pickMatchesFilter } from '../utils/categories.js';
import { formatDisplayDate } from '../utils/signalFormat.js';
import CategoryFilter from './CategoryFilter.jsx';
import SignalCard from './SignalCard.jsx';
import SkeletonCard from './SkeletonCard.jsx';

function RefreshIcon() {
  return (
    <svg className="w-5 h-5 mx-auto mb-2 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
      />
    </svg>
  );
}

function buildHistoryMap(historyDays) {
  const map = new Map();
  if (!historyDays?.length) return map;

  for (const day of historyDays) {
    for (const sig of day.signals ?? []) {
      const key = sig.market_id;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push({
        ...sig,
        date: day.date ?? sig.signal_date ?? sig.date,
      });
    }
  }

  for (const [, items] of map) {
    items.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
  }
  return map;
}

export default function PicksDashboard({
  picks,
  loading,
  error,
  date,
  intraday = false,
  historyDays = [],
  totalTrackedWallets = 0,
  statusLabel = 'Auto-updates every 6 hours',
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeFilter = searchParams.get('filter') || 'all';
  const [expandedId, setExpandedId] = useState(null);
  const [displayStatus, setDisplayStatus] = useState(statusLabel);

  const enrichedPicks = useMemo(() => picks.map(enrichPick), [picks]);
  const activeCount = enrichedPicks.filter((p) => p.status === 'ACTIVE').length;
  const historyMap = useMemo(() => buildHistoryMap(historyDays), [historyDays]);

  useEffect(() => {
    setDisplayStatus(statusLabel);
  }, [statusLabel]);

  const setFilter = useCallback(
    (filterId) => {
      setExpandedId(null);
      if (filterId === 'all') {
        setSearchParams({});
      } else {
        setSearchParams({ filter: filterId });
      }
    },
    [setSearchParams]
  );

  const filteredPicks = useMemo(
    () => enrichedPicks.filter((p) => pickMatchesFilter(p, activeFilter)),
    [enrichedPicks, activeFilter]
  );

  const displayDate = formatDisplayDate(date || new Date().toISOString().slice(0, 10));
  const pageTitle = intraday ? 'Daily picks' : 'Swing picks';

  const handleCosmeticRefresh = () => {
    setDisplayStatus('Updated signals');
    window.setTimeout(() => setDisplayStatus(statusLabel), 2500);
  };

  useEffect(() => {
    setExpandedId(null);
  }, [activeFilter]);

  return (
    <div>
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-display font-semibold text-gray-100 leading-tight">
            {pageTitle}
          </h1>
          <p className="text-xs text-gray-500 mt-1 truncate">
            {displayDate} · {activeCount} active
          </p>
          <p className="text-xs text-gray-400 mt-1">{displayStatus}</p>
        </div>
        <button
          type="button"
          onClick={handleCosmeticRefresh}
          className="shrink-0 px-3 py-2 bg-accent hover:bg-indigo-500 rounded-lg text-xs font-medium transition-colors touch-manipulation"
        >
          Refresh
        </button>
      </div>

      <div className="mb-4">
        <CategoryFilter activeFilter={activeFilter} onFilterChange={setFilter} />
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-300 text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <div className="grid gap-3 grid-cols-1">
          {[1, 2, 3].map((i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : enrichedPicks.length === 0 ? (
        <div className="text-center py-12 bg-card border border-border rounded-xl px-4">
          <RefreshIcon />
          <p className="text-gray-400 mb-1 text-sm">No active signals right now.</p>
          <p className="text-gray-500 text-xs">Signals refresh automatically every 6 hours.</p>
        </div>
      ) : filteredPicks.length === 0 ? (
        <div className="text-center py-12 bg-card border border-border rounded-xl px-4">
          <RefreshIcon />
          <p className="text-gray-400 text-sm">
            No {getCategoryLabel(activeFilter).toLowerCase()} signals — check back later
          </p>
        </div>
      ) : (
        <div key={activeFilter} className="grid gap-3 grid-cols-1 lg:grid-cols-2 picks-grid-enter">
          {filteredPicks.map((pick) => {
            const id = pick.id ?? `${pick.market_id}-${pick.recommended_side}`;
            const history = (historyMap.get(pick.market_id) ?? []).filter(
              (h) => h.id !== pick.id && h.date !== date
            );

            return (
              <div key={id} className={expandedId === id ? 'lg:col-span-2' : ''}>
                <SignalCard
                  pick={pick}
                  intraday={intraday}
                  expanded={expandedId === id}
                  onToggle={setExpandedId}
                  totalTrackedWallets={totalTrackedWallets}
                  marketHistory={history}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
