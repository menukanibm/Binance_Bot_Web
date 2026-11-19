import React, {useMemo, useState} from 'react';
import {ShieldAlert} from 'lucide-react';
import type {IneligibleSignal} from '../types/trading';

interface IneligibleSignalsListProps {
  ineligibleSignals: IneligibleSignal[];
  onSelectSymbol: (sym: string) => void;
}

type GateFilter = 'ALL' | 'WAITING_L3' | 'NO_MSNR';

export const IneligibleSignalsList: React.FC<IneligibleSignalsListProps> = ({
  ineligibleSignals,
  onSelectSymbol,
}) => {
  const [filter, setFilter] = useState<GateFilter>('ALL');

  const waitingL3Count = useMemo(
    () =>
      ineligibleSignals.filter((s) =>
        s.failedRule.toLowerCase().includes('l3'),
      ).length,
    [ineligibleSignals],
  );
  const noMsnrCount = useMemo(
    () =>
      ineligibleSignals.filter((s) =>
        s.failedRule.toLowerCase().includes('msnr'),
      ).length,
    [ineligibleSignals],
  );

  const visible = useMemo(() => {
    if (filter === 'WAITING_L3') {
      return ineligibleSignals.filter((s) => s.failedRule.toLowerCase().includes('l3'));
    }
    if (filter === 'NO_MSNR') {
      return ineligibleSignals.filter((s) => s.failedRule.toLowerCase().includes('msnr'));
    }
    return ineligibleSignals;
  }, [ineligibleSignals, filter]);

  return (
    <div
      data-testid="filtered-signals-panel"
      className="cyber-card rounded-xl overflow-hidden font-mono"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--ex-border)] bg-[var(--ex-surface-inset)] px-4 py-3">
        <div>
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-amber-400" aria-hidden="true" />
            <h2 className="text-xs sm:text-sm font-black uppercase tracking-wider text-[var(--ex-text)]">
              Filtered / Gatekeeper Blocked Setups ({ineligibleSignals.length})
            </h2>
          </div>
          <p className="mt-0.5 text-[11px] text-[var(--ex-muted)]">
            Strict MSNR + Synthetic L3 AND-Gate — zero premature or unconfirmed signals emitted
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {(
            [
              {key: 'ALL', label: `All (${ineligibleSignals.length})`},
              {key: 'WAITING_L3', label: `Waiting for L3 (${waitingL3Count})`},
              {key: 'NO_MSNR', label: `No Valid MSNR (${noMsnrCount})`},
            ] as const
          ).map((btn) => (
            <button
              key={btn.key}
              type="button"
              onClick={() => setFilter(btn.key)}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition cursor-pointer whitespace-nowrap ${
                filter === btn.key
                  ? 'ex-tab-active'
                  : 'border-[var(--ex-border)] bg-[var(--ex-surface)] text-[var(--ex-muted)] hover:text-[var(--ex-text)]'
              }`}
            >
              {btn.label}
            </button>
          ))}
        </div>
      </div>

      <div className="p-4 space-y-2.5 text-xs">
        {visible.length === 0 ? (
          <div className="py-8 text-center text-[var(--ex-muted)]">
            No filtered setups match this gatekeeper category.
          </div>
        ) : (
          visible.map((item) => {
            const isWaitingL3 = item.failedRule.toLowerCase().includes('l3');
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectSymbol(item.symbol)}
                className="w-full text-left rounded-xl border border-[var(--ex-border)] bg-[var(--ex-surface-inset)] p-3 hover:border-[var(--ex-accent)] transition cursor-pointer space-y-1.5"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-black text-[var(--ex-text)]">{item.symbol}</span>
                    <span
                      className="text-[11px] font-bold"
                      style={{
                        color: item.side === 'LONG' ? 'var(--ex-long)' : 'var(--ex-short)',
                      }}
                    >
                      {item.side}
                    </span>
                    <span className="text-[var(--ex-muted)]">&middot;</span>
                    <span
                      className="text-[11px] font-bold"
                      style={{color: isWaitingL3 ? '#F59E0B' : '#94A3B8'}}
                    >
                      {item.failedRule}
                    </span>
                  </div>
                  <span className="text-[10px] text-[var(--ex-muted)] tabular-nums">
                    Est R:R 1:{item.riskRewardRatio.toFixed(2)} &middot; SL {item.slDistancePercent.toFixed(2)}% &middot; {new Date(item.timestamp).toLocaleTimeString()}
                  </span>
                </div>
                <p className="text-[11px] text-[var(--ex-muted)] leading-relaxed">{item.reason}</p>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
};
