import React, {useState} from 'react';
import {ArrowUpRight, Search} from 'lucide-react';
import type {CcxtPairInfo} from '../types/trading';

interface MarketScannerListProps {
  pairs: CcxtPairInfo[];
  selectedSymbol: string;
  onSelectSymbol: (sym: string) => void;
}

export const MarketScannerList: React.FC<MarketScannerListProps> = ({
  pairs,
  selectedSymbol,
  onSelectSymbol,
}) => {
  const [query, setQuery] = useState('');

  const filtered = pairs.filter((p) =>
    p.symbol.toLowerCase().includes(query.trim().toLowerCase()),
  );

  return (
    <div className="rounded-xl border border-cyan-500/30 bg-[#0a101d] overflow-hidden shadow-lg">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 bg-[#070b14] px-4 py-3">
        <div>
          <h3 className="text-xs font-black font-mono uppercase tracking-wider glow-heading-cyan">
            Crypto Perpetuals Market Scanner ({filtered.length})
          </h3>
          <p className="text-[10px] font-mono text-slate-400">
            Click any USDT pair to load MSNR levels, footprint delta, and order book into the Sniper Terminal
          </p>
        </div>

        <div className="relative w-full sm:w-56">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter pair (e.g. BTC)..."
            className="w-full rounded-lg border border-slate-700 bg-[#06090f] pl-8 pr-3 py-1.5 text-xs font-mono text-white placeholder-slate-500 focus:border-cyan-400 focus:outline-none"
          />
        </div>
      </div>

      <div className="p-3 overflow-x-auto">
        <table className="w-full min-w-[540px] text-left text-xs font-mono">
          <thead>
            <tr className="border-b border-slate-800 text-[10px] text-slate-400 uppercase">
              <th className="py-2 pr-2">Pair</th>
              <th className="py-2 px-2">Last Price</th>
              <th className="py-2 px-2">24h Change</th>
              <th className="py-2 px-2">24h Volume</th>
              <th className="py-2 pl-2 text-right">Terminal</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/70">
            {filtered.map((p) => {
              const pos = p.priceChangePercent >= 0;
              const isSelected = p.symbol === selectedSymbol;
              return (
                <tr
                  key={p.symbol}
                  className={isSelected ? 'bg-cyan-500/10' : 'hover:bg-[#070b14]'}
                >
                  <td className="py-2.5 pr-2 font-black text-white">{p.symbol}</td>
                  <td className="py-2.5 px-2 tabular-nums text-slate-200">
                    ${p.lastPrice.toLocaleString('en-US', {maximumFractionDigits: p.pricePrecision})}
                  </td>
                  <td className={`py-2.5 px-2 tabular-nums font-bold ${pos ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {pos ? '+' : ''}
                    {p.priceChangePercent.toFixed(2)}%
                  </td>
                  <td className="py-2.5 px-2 tabular-nums text-slate-400">
                    ${(p.volume24h / 1_000_000).toFixed(1)}M
                  </td>
                  <td className="py-2.5 pl-2 text-right">
                    <button
                      type="button"
                      onClick={() => onSelectSymbol(p.symbol)}
                      className="inline-flex items-center gap-1 rounded-lg border border-cyan-500/40 bg-cyan-500/15 px-2.5 py-1 text-[11px] font-bold text-cyan-200 hover:bg-cyan-500/25 cursor-pointer"
                    >
                      <span>Open</span>
                      <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
