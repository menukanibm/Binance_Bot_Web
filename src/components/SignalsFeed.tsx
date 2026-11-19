import React from 'react';
import {Radio, Trash2} from 'lucide-react';
import type {BotStatus, TradeSignal} from '../types/trading';
import {formatPrice, getPairMeta} from '../utils/tradingMath';

interface SignalsFeedProps {
  signals: TradeSignal[];
  status: BotStatus;
  onSelectSymbol: (sym: string) => void;
  onOpenCleanupSignals: () => void;
}

export const SignalsFeed: React.FC<SignalsFeedProps> = ({
  signals,
  status,
  onSelectSymbol,
  onOpenCleanupSignals,
}) => {
  return (
    <div className="cyber-card rounded-xl overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-[var(--ex-border)] bg-[var(--ex-surface-inset)] px-4 py-3">
        <div className="flex items-center gap-2">
          <Radio className="h-4 w-4 text-[var(--ex-long)]" aria-hidden="true" />
          <h3 className="text-xs font-black font-mono uppercase tracking-wider text-[var(--ex-text)]">
            Live Footprint + MSNR Signals ({signals.length})
          </h3>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono font-semibold text-[var(--ex-accent)]">
            {status.activeExchange} Stream
          </span>
          <button
            type="button"
            onClick={onOpenCleanupSignals}
            title="Clear unexecuted signals"
            className="rounded-md border border-[var(--ex-border)] bg-[var(--ex-surface)] p-1.5 text-[var(--ex-muted)] hover:text-amber-400 cursor-pointer"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="p-3 space-y-2.5 max-h-[340px] overflow-y-auto font-mono">
        {signals.length === 0 ? (
          <div className="py-8 text-center text-xs text-[var(--ex-muted)]">
            No approved MSNR + Footprint signals yet. Click Scan Now to evaluate pairs.
          </div>
        ) : (
          signals.map((sig) => {
            const meta = getPairMeta(sig.symbol);
            return (
              <div
                key={sig.id}
                onClick={() => onSelectSymbol(sig.symbol)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') onSelectSymbol(sig.symbol);
                }}
                className="ex-surface-inset rounded-xl p-3 hover:border-[var(--ex-accent)] transition cursor-pointer space-y-1.5"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-black text-white">{sig.symbol}</span>
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-black ${
                        sig.side === 'LONG'
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                          : 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                      }`}
                    >
                      {sig.side} &bull; {sig.engulfingTimeframe}
                    </span>
                    <span className="text-[10px] text-cyan-300">
                      1:{sig.riskRewardRatio.toFixed(1)} R:R
                    </span>
                  </div>
                  <span className="text-[10px] text-slate-400">
                    {new Date(sig.timestamp).toLocaleTimeString()}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-3 text-[11px] tabular-nums">
                  <span className="text-slate-300">
                    Entry: <strong className="text-white">${formatPrice(sig.entryPrice, meta.decimals)}</strong>
                  </span>
                  <span className="text-rose-400">
                    SL: ${formatPrice(sig.stopLoss, meta.decimals)} ({sig.slDistancePercent.toFixed(2)}%)
                  </span>
                  <span className="text-emerald-400">
                    TP: ${formatPrice(sig.takeProfit, meta.decimals)}
                  </span>
                </div>

                <p className="text-[11px] text-slate-400 leading-snug">{sig.reasoning}</p>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
