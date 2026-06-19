function ProgressRow({ label, value, detail }) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-sm">
        <span className="text-gray-400">{label}</span>
        <span className="font-display text-gray-200">
          {value}% <span className="text-gray-500 text-xs font-sans">{detail}</span>
        </span>
      </div>
      <div className="h-1.5 bg-navy rounded-full overflow-hidden">
        <div
          className="h-full bg-accent rounded-full transition-all duration-300"
          style={{ width: `${Math.min(100, value)}%` }}
        />
      </div>
    </div>
  );
}

export default function ConfidenceBreakdown({ breakdown }) {
  if (!breakdown) return null;

  return (
    <div className="space-y-3">
      <h4 className="text-sm text-gray-400">Confidence score breakdown</h4>
      <ProgressRow
        label="Participation rate"
        value={breakdown.participation}
        detail={`(${breakdown.trackedWallets} tracked wallets)`}
      />
      <ProgressRow
        label="Avg wallet win rate"
        value={breakdown.avgWinRate}
        detail="(weighted average)"
      />
      <ProgressRow
        label="Price divergence"
        value={breakdown.divergence}
        detail={`(${breakdown.divergenceRaw}% from market)`}
      />
      <div className="border-t border-border pt-3 flex justify-between items-center">
        <span className="text-sm text-gray-400">Overall confidence</span>
        <span className="font-display text-lg font-semibold text-gray-100">
          {breakdown.overall} / 100
        </span>
      </div>
    </div>
  );
}
