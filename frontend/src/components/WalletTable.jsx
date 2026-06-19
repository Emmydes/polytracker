import { useState } from 'react';
import { formatPriceDollar, formatWalletAddress, winRateColor } from '../utils/signalFormat.js';

function WalletRow({ wallet }) {
  const [copied, setCopied] = useState(false);
  const winPct = Math.round((wallet.win_rate ?? 0) * 100);

  const handleCopy = (e) => {
    e.stopPropagation();
    navigator.clipboard.writeText(wallet.address).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <tr className="border-t border-border text-sm">
      <td className="py-2 pr-2">
        <button
          type="button"
          onClick={handleCopy}
          className="font-mono text-accent hover:text-indigo-300 relative"
        >
          {formatWalletAddress(wallet.address)}
          {copied ? (
            <span className="absolute left-0 -top-6 text-xs text-emerald-400 whitespace-nowrap bg-card px-2 py-0.5 rounded border border-border">
              Copied!
            </span>
          ) : null}
        </button>
      </td>
      <td className={`py-2 pr-2 font-display ${winRateColor(winPct)}`}>{winPct}%</td>
      <td className="py-2 pr-2 font-display text-gray-300">{formatPriceDollar(wallet.avg_price)}</td>
      <td className="py-2 pr-2 font-display text-gray-300">{Math.round(wallet.size ?? 0).toLocaleString()}</td>
      <td className="py-2 font-display text-gray-400">{wallet.side}</td>
    </tr>
  );
}

export default function WalletTable({ wallets, loading }) {
  if (loading) {
    return <p className="text-sm text-gray-500 animate-pulse">Loading wallets…</p>;
  }

  if (!wallets?.length) {
    return <p className="text-sm text-gray-500">No wallet entries cached for this side.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left">
        <thead>
          <tr className="text-xs text-gray-500">
            <th className="pb-2 font-normal">Wallet</th>
            <th className="pb-2 font-normal">Win rate</th>
            <th className="pb-2 font-normal">Entered at</th>
            <th className="pb-2 font-normal">Shares</th>
            <th className="pb-2 font-normal">Side</th>
          </tr>
        </thead>
        <tbody>
          {wallets.map((w) => (
            <WalletRow key={w.address} wallet={w} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
