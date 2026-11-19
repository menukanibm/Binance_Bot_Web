import React, {useState} from 'react';
import {History, Layers, Trash2, XCircle} from 'lucide-react';
import type {ExchangeType, Position, TradingMode} from '../types/trading';
import {calculateUnrealizedPnL, formatPrice, getPairMeta} from '../utils/tradingMath';

interface PositionsTableProps {
  openPositions: Position[];
  closedPositions: Position[];
  livePrices: Record<string, number>;
  onClosePosition: (positionId: string, exitPrice: number, realizedPnl: number) => void;
  onSelectSymbol: (sym: string) => void;
  onOpenCleanupHistory: () => void;
  tradingMode: TradingMode;
  activeExchange: ExchangeType;
  hasVerifiedApiKey?: boolean;
}

export const PositionsTable: React.FC<PositionsTableProps> = ({
  openPositions,
  closedPositions,
  livePrices,
  onClosePosition,
  onSelectSymbol,
  onOpenCleanupHistory,
  tradingMode,
  activeExchange,
  hasVerifiedApiKey = false,
}) => {
  const [view, setView] = useState<'OPEN' | 'CLOSED'>('OPEN');

  return (
    <div className="cyber-card rounded-xl overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--ex-border)] bg-[var(--ex-surface-inset)] px-4 py-3">
        <div className="flex flex-col">
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-[var(--ex-accent)]" aria-hidden="true" />
            <h3 className="text-xs font-black font-mono uppercase tracking-wider text-[var(--ex-text)]">
              Positions &amp; Execution ({tradingMode} &middot; {activeExchange})
            </h3>
          </div>
          <span className="mt-0.5 text-[10px] font-mono text-[var(--ex-muted)]">
            Bot-Only Isolation Active (MAKKA_BOT_* orders only &middot; manual exchange trades ignored)
          </span>
        </div>

        <div className="flex items-center gap-1.5 font-mono text-[11px]">
          <button
            type="button"
            onClick={() => setView('OPEN')}
            className={`rounded-md px-2.5 py-1 font-bold cursor-pointer whitespace-nowrap border transition ${
              view === 'OPEN'
                ? 'ex-tab-active font-black'
                : 'border-[var(--ex-border)] bg-[var(--ex-surface)] text-[var(--ex-muted)] hover:text-[var(--ex-text)]'
            }`}
          >
            Open ({hasVerifiedApiKey ? openPositions.length : 0}/3)
          </button>
          <button
            type="button"
            onClick={() => setView('CLOSED')}
            className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 font-bold cursor-pointer whitespace-nowrap border transition ${
              view === 'CLOSED'
                ? 'ex-tab-active font-black'
                : 'border-[var(--ex-border)] bg-[var(--ex-surface)] text-[var(--ex-muted)] hover:text-[var(--ex-text)]'
            }`}
          >
            <History className="h-3 w-3" aria-hidden="true" />
            <span>Closed ({closedPositions.length})</span>
          </button>
          <button
            type="button"
            onClick={onOpenCleanupHistory}
            title="Clear trade history"
            className="rounded-md border border-[var(--ex-border)] bg-[var(--ex-surface)] p-1.5 text-[var(--ex-muted)] hover:text-amber-400 cursor-pointer"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="p-3 overflow-x-auto">
        {view === 'OPEN' ? (
          !hasVerifiedApiKey ? (
            <div className="py-8 text-center text-xs font-mono text-[var(--ex-muted)]">
              Connect {activeExchange} Futures credentials via <strong className="text-[var(--ex-text)]">API &amp; Settings</strong> to enable bot execution and position tracking.
            </div>
          ) : openPositions.length === 0 ? (
            <div className="py-8 text-center text-xs font-mono text-[var(--ex-muted)]">
              No active bot-opened positions. Manual {activeExchange} trades are ignored automatically.
            </div>
          ) : (
            <table className="w-full min-w-[540px] text-left text-xs font-mono">
              <thead>
                <tr className="border-b border-slate-800 text-[10px] text-slate-400 uppercase">
                  <th className="py-2 pr-2">Pair</th>
                  <th className="py-2 px-2">Entry / Mark</th>
                  <th className="py-2 px-2">SL / TP</th>
                  <th className="py-2 px-2">Size</th>
                  <th className="py-2 px-2">Unrealized PnL</th>
                  <th className="py-2 pl-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {openPositions.map((pos) => {
                  const meta = getPairMeta(pos.symbol);
                  const mark = livePrices[pos.symbol] ?? pos.markPrice ?? pos.entryPrice;
                  const {pnlUsd, roePct} = calculateUnrealizedPnL(pos, mark);
                  return (
                    <tr key={pos.id} className="hover:bg-[#070b14]">
                      <td className="py-2.5 pr-2">
                        <button
                          type="button"
                          onClick={() => onSelectSymbol(pos.symbol)}
                          className="font-black text-white hover:text-cyan-300 cursor-pointer"
                        >
                          {pos.symbol}
                        </button>
                        <div className="mt-0.5 flex items-center gap-1.5 text-[10px]">
                          <span
                            className={`rounded px-1 font-bold ${
                              pos.side === 'LONG'
                                ? 'bg-emerald-500/20 text-emerald-300'
                                : 'bg-rose-500/20 text-rose-300'
                            }`}
                          >
                            {pos.side} {pos.leverage}x
                          </span>
                          {pos.clientOrderId && (
                            <span className="text-[9px] text-cyan-400/80 truncate max-w-[90px]">
                              {pos.clientOrderId}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-2.5 px-2 tabular-nums">
                        <div className="text-slate-200">${formatPrice(pos.entryPrice, meta.decimals)}</div>
                        <div className="text-[10px] text-cyan-300">${formatPrice(mark, meta.decimals)}</div>
                      </td>
                      <td className="py-2.5 px-2 tabular-nums text-[11px]">
                        <div className="text-rose-400">SL ${formatPrice(pos.stopLoss, meta.decimals)}</div>
                        <div className="text-emerald-400">TP ${formatPrice(pos.takeProfit, meta.decimals)}</div>
                      </td>
                      <td className="py-2.5 px-2 tabular-nums">
                        <div className="text-slate-200">${pos.sizeUsd.toLocaleString()}</div>
                        <div className="text-[10px] text-slate-500">Margin ${pos.marginUsd.toFixed(0)}</div>
                      </td>
                      <td className="py-2.5 px-2 tabular-nums font-bold">
                        <div className={pnlUsd >= 0 ? 'glow-emerald' : 'glow-rose'}>
                          {pnlUsd >= 0 ? '+' : '-'}${Math.abs(pnlUsd).toFixed(2)}
                        </div>
                        <div className="text-[10px] text-slate-400">
                          {roePct >= 0 ? '+' : ''}
                          {roePct.toFixed(2)}% ROE
                        </div>
                      </td>
                      <td className="py-2.5 pl-2 text-right">
                        <button
                          type="button"
                          onClick={() => onClosePosition(pos.id, mark, pnlUsd)}
                          className="inline-flex items-center gap-1 rounded-lg border border-rose-500/45 bg-rose-950/30 px-2.5 py-1 text-[11px] font-bold text-rose-300 hover:bg-rose-950/50 cursor-pointer"
                        >
                          <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>Close</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )
        ) : closedPositions.length === 0 ? (
          <div className="py-8 text-center text-xs font-mono text-slate-500">
            No closed trade history recorded in this session yet.
          </div>
        ) : (
          <table className="w-full min-w-[520px] text-left text-xs font-mono">
            <thead>
              <tr className="border-b border-slate-800 text-[10px] text-slate-400 uppercase">
                <th className="py-2 pr-2">Pair</th>
                <th className="py-2 px-2">Entry &rarr; Exit</th>
                <th className="py-2 px-2">Realized PnL</th>
                <th className="py-2 pl-2">Reason</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {closedPositions.map((pos) => {
                const meta = getPairMeta(pos.symbol);
                const pnl = pos.realizedPnl ?? 0;
                return (
                  <tr key={pos.id} className="hover:bg-[#070b14]">
                    <td className="py-2 pr-2">
                      <span className="font-bold text-white">{pos.symbol}</span>
                      <span
                        className={`ml-1.5 rounded px-1 text-[10px] font-bold ${
                          pos.side === 'LONG'
                            ? 'bg-emerald-500/20 text-emerald-300'
                            : 'bg-rose-500/20 text-rose-300'
                        }`}
                      >
                        {pos.side}
                      </span>
                    </td>
                    <td className="py-2 px-2 tabular-nums text-slate-300">
                      ${formatPrice(pos.entryPrice, meta.decimals)} &rarr; $
                      {formatPrice(pos.exitPrice ?? pos.markPrice, meta.decimals)}
                    </td>
                    <td className={`py-2 px-2 tabular-nums font-bold ${pnl >= 0 ? 'glow-emerald' : 'glow-rose'}`}>
                      {pnl >= 0 ? '+' : '-'}${Math.abs(pnl).toFixed(2)}
                    </td>
                    <td className="py-2 pl-2 text-[11px] text-slate-400 truncate max-w-[200px]">
                      {pos.closeReason || 'Closed'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};
