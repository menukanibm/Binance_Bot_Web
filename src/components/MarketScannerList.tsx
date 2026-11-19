import React, {useMemo, useState} from 'react';
import {
  ArrowUpRight,
  Crosshair,
  Layers,
  Radar,
  Search,
} from 'lucide-react';
import type {
  CcxtPairInfo,
  ExchangeConnectionTelemetry,
  ExchangeType,
} from '../types/trading';

interface MarketScannerListProps {
  pairs: CcxtPairInfo[];
  selectedSymbol: string;
  activeExchange: ExchangeType;
  telemetry: ExchangeConnectionTelemetry | null;
  onSelectSymbol: (sym: string) => void;
}

type StageFilter = 'ALL' | 'STAGE_2' | 'MSNR_TAP' | 'L3_CONFIRMED' | 'WAITING_L3';
type SortKey = 'VOLUME' | 'PROXIMITY' | 'CHANGE';

const PAGE_SIZE = 50;

export const MarketScannerList: React.FC<MarketScannerListProps> = ({
  pairs,
  selectedSymbol,
  activeExchange,
  telemetry,
  onSelectSymbol,
}) => {
  const [query, setQuery] = useState('');
  const [stageFilter, setStageFilter] = useState<StageFilter>('ALL');
  const [sortBy, setSortBy] = useState<SortKey>('VOLUME');
  const [visibleLimit, setVisibleLimit] = useState(PAGE_SIZE);

  const stage2Count = useMemo(
    () => pairs.filter((p) => p.scanStage === 'STAGE_2_LOCKON').length,
    [pairs],
  );
  const msnrTapCount = useMemo(
    () => pairs.filter((p) => (p.msnrProximityPct ?? 99) <= 0.45).length,
    [pairs],
  );
  const l3ConfirmedCount = useMemo(
    () =>
      pairs.filter(
        (p) =>
          p.l3State === 'BULLISH_L3_CONFIRMED' || p.l3State === 'BEARISH_L3_CONFIRMED',
      ).length,
    [pairs],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = pairs.filter((p) => {
      if (q && !p.symbol.toLowerCase().includes(q) && !p.baseAsset.toLowerCase().includes(q)) {
        return false;
      }
      if (stageFilter === 'STAGE_2') return p.scanStage === 'STAGE_2_LOCKON';
      if (stageFilter === 'MSNR_TAP') return (p.msnrProximityPct ?? 99) <= 0.45;
      if (stageFilter === 'L3_CONFIRMED') {
        return p.l3State === 'BULLISH_L3_CONFIRMED' || p.l3State === 'BEARISH_L3_CONFIRMED';
      }
      if (stageFilter === 'WAITING_L3') return p.gateStatus === 'WAITING_L3';
      return true;
    });

    return [...list].sort((a, b) => {
      if (sortBy === 'PROXIMITY') {
        return (a.msnrProximityPct ?? 99) - (b.msnrProximityPct ?? 99);
      }
      if (sortBy === 'CHANGE') {
        return Math.abs(b.priceChangePercent) - Math.abs(a.priceChangePercent);
      }
      // Keep Stage 2 lock-ons accessible when filtering Stage 2, otherwise sort by 24h volume
      return b.volume24h - a.volume24h;
    });
  }, [pairs, query, stageFilter, sortBy]);

  const visibleRows = filtered.slice(0, visibleLimit);

  return (
    <div
      data-testid="all-coin-market-scanner"
      className="cyber-card rounded-xl overflow-hidden font-mono"
    >
      {/* Top Pipeline Telemetry Banner */}
      <div className="border-b border-[var(--ex-border)] bg-[var(--ex-surface-inset)] px-4 py-3.5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Radar className="h-4 w-4 text-[var(--ex-accent)]" aria-hidden="true" />
              <h2 className="text-xs sm:text-sm font-black uppercase tracking-wider text-[var(--ex-text)]">
                All-Coin 2-Stage Perpetuals Scanner ({pairs.length} Active {activeExchange} Contracts)
              </h2>
            </div>
            <p className="mt-1 text-[11px] text-[var(--ex-muted)]">
              Stage 1 scans all {pairs.length} USDT-M contracts in real time &middot; Stage 2 binds L1/L2/Synthetic L3 streams on MSNR taps ({stage2Count} locked-on)
              {telemetry ? ` · Ping ${telemetry.latencyMs}ms` : ''}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-60 sm:w-64">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--ex-muted)]"
                aria-hidden="true"
              />
              <input
                type="search"
                aria-label="Filter perpetual contracts"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setVisibleLimit(PAGE_SIZE);
                }}
                placeholder={`Search ${pairs.length} pairs (BTC, SUI)...`}
                className="w-full rounded-lg border border-[var(--ex-border)] bg-[var(--ex-bg)] pl-8 pr-3 py-1.5 text-xs text-[var(--ex-text)] placeholder-[var(--ex-muted)] focus:border-[var(--ex-accent)] focus:outline-none"
              />
            </div>

            <select
              aria-label="Sort scanned contracts"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortKey)}
              className="rounded-lg border border-[var(--ex-border)] bg-[var(--ex-bg)] px-2.5 py-1.5 text-xs font-semibold text-[var(--ex-text)] focus:border-[var(--ex-accent)] focus:outline-none cursor-pointer"
            >
              <option value="VOLUME">Sort: 24h Volume</option>
              <option value="PROXIMITY">Sort: MSNR Proximity</option>
              <option value="CHANGE">Sort: 24h Volatility</option>
            </select>
          </div>
        </div>

        {/* Interactive Stage & Confluence Filter Controls */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            {(
              [
                {key: 'ALL', label: `All Coins (${pairs.length})`},
                {key: 'STAGE_2', label: `Stage 2 Lock-On (${stage2Count})`},
                {key: 'MSNR_TAP', label: `MSNR Zone Tap (${msnrTapCount})`},
                {key: 'L3_CONFIRMED', label: `L3 Confirmed (${l3ConfirmedCount})`},
                {key: 'WAITING_L3', label: 'Waiting L3'},
              ] as const
            ).map((btn) => {
              const active = stageFilter === btn.key;
              return (
                <button
                  key={btn.key}
                  type="button"
                  onClick={() => {
                    setStageFilter(btn.key);
                    setVisibleLimit(PAGE_SIZE);
                  }}
                  className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition cursor-pointer border whitespace-nowrap ${
                    active
                      ? 'ex-tab-active'
                      : 'border-[var(--ex-border)] bg-[var(--ex-surface)] text-[var(--ex-muted)] hover:text-[var(--ex-text)]'
                  }`}
                >
                  {btn.label}
                </button>
              );
            })}
          </div>

          <div className="text-[11px] text-[var(--ex-muted)] tabular-nums">
            Showing {visibleRows.length} of {filtered.length} matching pairs
          </div>
        </div>
      </div>

      {/* Scanner Grid Table */}
      <div className="p-3 overflow-x-auto">
        <table className="w-full min-w-[780px] text-left text-xs">
          <thead>
            <tr className="border-b border-[var(--ex-border)] text-[10px] text-[var(--ex-muted)] uppercase">
              <th className="py-2 pr-2">Contract</th>
              <th className="py-2 px-2">Last Price</th>
              <th className="py-2 px-2">24h Change</th>
              <th className="py-2 px-2">24h Volume</th>
              <th className="py-2 px-2">MSNR Zone &amp; Proximity</th>
              <th className="py-2 px-2">Pipeline Stage</th>
              <th className="py-2 px-2">Synthetic L3 / Gate</th>
              <th className="py-2 pl-2 text-right">Lock-On</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--ex-border)]/60">
            {visibleRows.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-8 text-center text-[var(--ex-muted)]">
                  No perpetual contracts match the current filter.
                </td>
              </tr>
            ) : (
              visibleRows.map((p) => {
                const pos = p.priceChangePercent >= 0;
                const isSelected = p.symbol === selectedSymbol;
                const isStage2 = p.scanStage === 'STAGE_2_LOCKON';
                const prox = p.msnrProximityPct ?? 1.2;
                const isNearZone = prox <= 0.45;

                return (
                  <tr
                    key={p.symbol}
                    className={
                      isSelected
                        ? 'bg-[rgba(var(--ex-accent-rgb),0.1)]'
                        : 'hover:bg-[var(--ex-surface-inset)]'
                    }
                  >
                    <td className="py-2.5 pr-2">
                      <div className="font-black text-[var(--ex-text)]">{p.symbol}</div>
                      <div className="text-[10px] text-[var(--ex-muted)]">{p.baseAsset}/USDT Perp</div>
                    </td>
                    <td className="py-2.5 px-2 tabular-nums text-[var(--ex-text)]">
                      ${p.lastPrice.toLocaleString('en-US', {maximumFractionDigits: p.pricePrecision})}
                    </td>
                    <td
                      className="py-2.5 px-2 tabular-nums font-bold"
                      style={{color: pos ? 'var(--ex-long)' : 'var(--ex-short)'}}
                    >
                      {pos ? '+' : ''}
                      {p.priceChangePercent.toFixed(2)}%
                    </td>
                    <td className="py-2.5 px-2 tabular-nums text-[var(--ex-muted)]">
                      ${p.volume24h >= 1_000_000_000
                        ? `${(p.volume24h / 1_000_000_000).toFixed(2)}B`
                        : `${(p.volume24h / 1_000_000).toFixed(1)}M`}
                    </td>
                    <td className="py-2.5 px-2">
                      <div className="flex items-center gap-1.5">
                        <span
                          className="font-bold tabular-nums"
                          style={{color: isNearZone ? 'var(--ex-accent)' : 'var(--ex-text)'}}
                        >
                          {prox.toFixed(2)}%
                        </span>
                        <span className="text-[10px] text-[var(--ex-muted)]">
                          &middot; {(p.msnrZoneLabel || 'HTF EQ').replace(/\b(4H|1H|15M|5M)\s*/gi, '') || 'HTF EQ'}
                        </span>
                      </div>
                    </td>
                    <td className="py-2.5 px-2">
                      {isStage2 ? (
                        <span className="inline-flex items-center gap-1 font-bold text-[var(--ex-accent)]">
                          <Crosshair className="h-3 w-3" aria-hidden="true" />
                          <span>Stage 2 Lock-On</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[var(--ex-muted)]">
                          <Layers className="h-3 w-3" aria-hidden="true" />
                          <span>Stage 1 Discovery</span>
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-2 text-[11px]">
                      {p.gateStatus === 'CONFIRMED' ? (
                        <span className="font-black text-[var(--ex-long)]">
                          MSNR + L3 CONFIRMED
                        </span>
                      ) : p.gateStatus === 'WAITING_L3' ? (
                        <span className="font-semibold text-amber-400">
                          Waiting for L3 Confirmation
                        </span>
                      ) : p.gateStatus === 'NO_VALID_MSNR' ? (
                        <span className="text-[var(--ex-muted)]">
                          No Valid MSNR Zone
                        </span>
                      ) : (
                        <span className="text-[var(--ex-muted)]">Watching</span>
                      )}
                    </td>
                    <td className="py-2.5 pl-2 text-right">
                      <button
                        type="button"
                        data-testid={`lock-on-${p.symbol}`}
                        onClick={() => onSelectSymbol(p.symbol)}
                        className="inline-flex items-center gap-1 rounded-lg border border-[rgba(var(--ex-accent-rgb),0.45)] bg-[rgba(var(--ex-accent-rgb),0.12)] px-2.5 py-1 text-[11px] font-bold text-[var(--ex-accent)] hover:bg-[rgba(var(--ex-accent-rgb),0.22)] cursor-pointer whitespace-nowrap"
                      >
                        <span>{isStage2 ? 'Open L3' : 'Lock-On'}</span>
                        <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>

        {visibleLimit < filtered.length && (
          <div className="mt-3 flex items-center justify-center border-t border-[var(--ex-border)] pt-3">
            <button
              type="button"
              onClick={() => setVisibleLimit((prev) => prev + PAGE_SIZE)}
              className="rounded-lg border border-[var(--ex-border)] bg-[var(--ex-surface-inset)] px-4 py-2 text-xs font-bold text-[var(--ex-accent)] hover:border-[var(--ex-accent)] cursor-pointer"
            >
              Load More Contracts ({filtered.length - visibleLimit} remaining)
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
