import React from 'react';
import {ShieldAlert} from 'lucide-react';
import type {IneligibleSignal} from '../types/trading';

interface IneligibleSignalsListProps {
  ineligibleSignals: IneligibleSignal[];
  onSelectSymbol: (sym: string) => void;
}

export const IneligibleSignalsList: React.FC<IneligibleSignalsListProps> = ({
  ineligibleSignals,
  onSelectSymbol,
}) => {
  return (
    <div className="rounded-xl border border-amber-500/35 bg-[#0a101d] overflow-hidden shadow-lg">
      <div className="flex items-center justify-between border-b border-slate-800 bg-[#070b14] px-4 py-3">
        <div className="flex items-center gap-2">
          <ShieldAlert className="h-4 w-4 text-amber-400" aria-hidden="true" />
          <h3 className="text-xs font-black font-mono uppercase tracking-wider glow-amber">
            Filtered / Ineligible Signals ({ineligibleSignals.length})
          </h3>
        </div>
        <span className="text-[11px] font-mono text-slate-400">
          Blocked by Pure MSNR Rules 1–6
        </span>
      </div>

      <div className="p-4 space-y-2.5 font-mono text-xs">
        {ineligibleSignals.length === 0 ? (
          <div className="py-8 text-center text-slate-500">
            No filtered setups recorded yet.
          </div>
        ) : (
          ineligibleSignals.map((item) => (
            <div
              key={item.id}
              onClick={() => onSelectSymbol(item.symbol)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') onSelectSymbol(item.symbol);
              }}
              className="rounded-xl border border-slate-800 bg-[#070b14] p-3 hover:border-amber-500/40 cursor-pointer space-y-1"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="font-black text-white">{item.symbol}</span>
                  <span className="rounded bg-amber-500/15 border border-amber-400/40 px-1.5 py-0.5 text-[10px] font-bold text-amber-300">
                    {item.failedRule}
                  </span>
                </div>
                <span className="text-[10px] text-slate-400">
                  Est R:R 1:{item.riskRewardRatio.toFixed(2)} &bull; {new Date(item.timestamp).toLocaleTimeString()}
                </span>
              </div>
              <p className="text-[11px] text-slate-300">{item.reason}</p>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
