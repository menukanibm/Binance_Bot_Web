import React from 'react';
import {
  Activity,
  CheckCircle2,
  Crosshair,
  Lock,
  ShieldAlert,
  ShieldCheck,
  Target,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import type {BotSettings, FootprintSignalAnalysis} from '../types/trading';
import {formatPrice, getPairMeta} from '../utils/tradingMath';

interface MsnrEntryPanelProps {
  analysis: FootprintSignalAnalysis;
  settings: BotSettings;
  hasVerifiedApiKey: boolean;
  equity: number;
  onExecuteSetup: (side: 'LONG' | 'SHORT') => void;
}

export const MsnrEntryPanel: React.FC<MsnrEntryPanelProps> = ({
  analysis,
  settings,
  hasVerifiedApiKey,
  equity,
  onExecuteSetup,
}) => {
  const meta = getPairMeta(analysis.symbol);
  const isLong = analysis.bias === 'LONG';
  const prob = analysis.winProbabilityPct ?? 78;
  const structureLabel = (analysis.structureEvent || 'BULLISH_BOS').replace('_', ' ');
  const trendLabel = (analysis.footprintTrend || 'BULLISH_IMBALANCE').replace('_', ' ');

  return (
    <section
      aria-label="MSNR Smart Entry and Market Structure Matrix"
      className="grid grid-cols-1 gap-4 lg:grid-cols-3"
    >
      {/* Left 2 Columns: Market Structure, FVG, Golden Pocket & POC Confluence */}
      <div className="cyber-card rounded-xl p-4 lg:col-span-2 space-y-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--ex-border)] pb-2.5">
          <div className="flex items-center gap-2">
            <Crosshair className="h-4 w-4 text-[var(--ex-accent)]" aria-hidden="true" />
            <h2 className="text-xs sm:text-sm font-black font-mono uppercase tracking-wider text-[var(--ex-text)]">
              MSNR Structure &amp; Institutional Confluence ({analysis.symbol})
            </h2>
          </div>
          <span className="text-[11px] font-mono font-bold text-[var(--ex-accent)]">
            {structureLabel}
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 font-mono text-xs">
          <div className="ex-surface-inset rounded-lg p-2.5">
            <div className="text-[10px] text-[var(--ex-muted)] uppercase">4H / 1H Storyline</div>
            <div
              className="mt-1 text-sm font-black"
              style={{
                color: analysis.storyline4h === 'BULLISH' ? 'var(--ex-long)' : 'var(--ex-short)',
              }}
            >
              {analysis.storyline4h}
            </div>
            <div className="mt-0.5 text-[10px] text-[var(--ex-muted)]">
              Zone: {analysis.htfContext.swingRange4h.currentZone}
            </div>
          </div>

          <div className="ex-surface-inset rounded-lg p-2.5">
            <div className="text-[10px] text-[var(--ex-muted)] uppercase">Footprint Flow</div>
            <div
              className="mt-1 text-xs sm:text-sm font-black truncate"
              style={{
                color:
                  analysis.footprintTrend === 'BEARISH_IMBALANCE'
                    ? 'var(--ex-short)'
                    : 'var(--ex-accent)',
              }}
            >
              {trendLabel}
            </div>
            <div className="mt-0.5 text-[10px] text-[var(--ex-muted)] tabular-nums">
              POC: ${formatPrice(analysis.pocPrice ?? analysis.currentPrice, meta.decimals)}
            </div>
          </div>

          <div className="ex-surface-inset rounded-lg p-2.5">
            <div className="text-[10px] text-[var(--ex-muted)] uppercase">Golden Pocket</div>
            <div className="mt-1 text-xs font-black text-amber-400 tabular-nums">
              ${formatPrice(analysis.goldenPocketZone?.fib650 ?? analysis.currentPrice, meta.decimals)}
              {' – '}$
              {formatPrice(analysis.goldenPocketZone?.fib618 ?? analysis.currentPrice, meta.decimals)}
            </div>
            <div className="mt-0.5 text-[10px] text-[var(--ex-accent)]">
              {analysis.goldenPocketZone?.inZone ? 'IN 0.618–0.650 ZONE' : '0.618–0.650 Reload'}
            </div>
          </div>

          <div className="ex-surface-inset rounded-lg p-2.5">
            <div className="text-[10px] text-[var(--ex-muted)] uppercase">Win Probability</div>
            <div className="mt-1 text-sm font-black text-[var(--ex-long)] tabular-nums">
              {prob}% ({analysis.confluenceScore}/4)
            </div>
            <div className="mt-0.5 text-[10px] text-[var(--ex-muted)]">
              FVG + MSNR Aligned
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-0.5">
          {analysis.activeConfirmations.map((conf) => {
            const isPending = /awaiting|waiting|pending|blocked|spoof wall detected/i.test(conf);
            return (
              <span
                key={conf}
                className={
                  isPending
                    ? 'inline-flex items-center gap-1 rounded-md border border-amber-500/35 bg-amber-500/10 px-2 py-1 text-[10px] font-mono font-semibold text-amber-400'
                    : 'inline-flex items-center gap-1 rounded-md border border-[rgba(var(--ex-long-rgb),0.3)] bg-[rgba(var(--ex-long-rgb),0.08)] px-2 py-1 text-[10px] font-mono font-semibold text-[var(--ex-long)]'
                }
              >
                {isPending ? (
                  <ShieldAlert className="h-3 w-3" aria-hidden="true" />
                ) : (
                  <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                )}
                <span>{conf}</span>
              </span>
            );
          })}
        </div>
      </div>

      {/* Right Column: High-Probability Entry Zone & 1:2 R:R Setup */}
      <div className="cyber-card rounded-xl p-4 flex flex-col justify-between space-y-3 font-mono">
        <div className="flex items-center justify-between border-b border-[var(--ex-border)] pb-2.5">
          <div className="flex items-center gap-2">
            <Target className="h-4 w-4 text-[var(--ex-long)]" aria-hidden="true" />
            <h3 className="text-xs sm:text-sm font-black uppercase text-[var(--ex-text)]">
              High-Prob Entry Setup
            </h3>
          </div>
          <span
            className="text-[11px] font-black"
            style={{color: isLong ? 'var(--ex-long)' : 'var(--ex-short)'}}
          >
            {analysis.bias} &middot; 1:{analysis.riskRewardRatio.toFixed(1)} R:R
          </span>
        </div>

        <div className="space-y-2 text-xs">
          <div className="ex-surface-inset flex items-center justify-between rounded-lg px-3 py-2">
            <span className="text-[var(--ex-muted)]">Entry Zone</span>
            <span className="font-black text-[var(--ex-accent)] tabular-nums">
              ${formatPrice(analysis.entryZone.min, meta.decimals)} – $
              {formatPrice(analysis.entryZone.max, meta.decimals)}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg border border-[rgba(var(--ex-short-rgb),0.3)] bg-[rgba(var(--ex-short-rgb),0.08)] px-3 py-2">
              <div className="text-[10px] text-[var(--ex-short)]">
                Strict SL ({settings.stopLossPercent.toFixed(2)}%)
              </div>
              <div className="mt-0.5 font-black text-[var(--ex-short)] tabular-nums">
                ${formatPrice(analysis.stopLoss, meta.decimals)}
              </div>
            </div>
            <div className="rounded-lg border border-[rgba(var(--ex-long-rgb),0.3)] bg-[rgba(var(--ex-long-rgb),0.08)] px-3 py-2">
              <div className="text-[10px] text-[var(--ex-long)]">1:2 R:R Target</div>
              <div className="mt-0.5 font-black text-[var(--ex-long)] tabular-nums">
                ${formatPrice(analysis.takeProfit, meta.decimals)}
              </div>
            </div>
          </div>
        </div>

        {!hasVerifiedApiKey ? (
          <div
            data-testid="api-key-lock-banner"
            className="ex-surface-inset flex items-center justify-between gap-2 rounded-xl px-3.5 py-2.5 text-xs font-mono text-[var(--ex-muted)]"
          >
            <span className="inline-flex items-center gap-2 font-semibold text-amber-400">
              <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>Execution Locked</span>
            </span>
            <span className="text-[10px] text-right">
              Configure key in API &amp; Settings
            </span>
          </div>
        ) : equity <= 0 ? (
          <div
            data-testid="zero-balance-lock-banner"
            className="flex items-center justify-center gap-2 rounded-xl border border-[rgba(var(--ex-short-rgb),0.45)] bg-[rgba(var(--ex-short-rgb),0.1)] px-3 py-2.5 text-xs font-black text-[var(--ex-short)]"
          >
            <Lock className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>INSUFFICIENT WALLET ($0.00) &middot; EXECUTION BLOCKED</span>
          </div>
        ) : !analysis.approved ? (
          <div
            data-testid="l3-gate-hold-banner"
            className="ex-surface-inset flex items-center justify-between gap-2 rounded-xl border border-amber-500/35 px-3.5 py-2.5 text-xs font-mono text-amber-300"
          >
            <span className="inline-flex items-center gap-2 font-bold">
              <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>{analysis.confluenceGate?.rejectionLabel || 'Waiting for L3 Confirmation'}</span>
            </span>
            <span className="text-[10px] text-[var(--ex-muted)]">AND-Gate Hold</span>
          </div>
        ) : settings.autoTrading ? (
          <div
            data-testid="autonomous-exec-banner"
            className="flex w-full min-h-[42px] items-center justify-center gap-2 rounded-xl border border-[rgba(var(--ex-long-rgb),0.55)] bg-[rgba(var(--ex-long-rgb),0.12)] px-3 py-2 text-xs font-black text-[var(--ex-long)]"
          >
            <Activity className="h-4 w-4 animate-pulse" aria-hidden="true" />
            <span>AUTONOMOUS MSNR+L3 AUTO-TRADE ACTIVE</span>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => onExecuteSetup(analysis.bias)}
            className={`flex w-full min-h-[42px] items-center justify-center gap-2 rounded-xl border px-3 py-2 text-xs font-black transition cursor-pointer whitespace-nowrap ${
              isLong
                ? 'border-[rgba(var(--ex-long-rgb),0.6)] bg-[rgba(var(--ex-long-rgb),0.15)] text-[var(--ex-long)] hover:bg-[rgba(var(--ex-long-rgb),0.25)]'
                : 'border-[rgba(var(--ex-short-rgb),0.6)] bg-[rgba(var(--ex-short-rgb),0.15)] text-[var(--ex-short)] hover:bg-[rgba(var(--ex-short-rgb),0.25)]'
            }`}
          >
            {isLong ? (
              <TrendingUp className="h-4 w-4" aria-hidden="true" />
            ) : (
              <TrendingDown className="h-4 w-4" aria-hidden="true" />
            )}
            <span>EXECUTE 1:2 {analysis.bias} SETUP</span>
            <Activity className="h-3.5 w-3.5 opacity-80" aria-hidden="true" />
          </button>
        )}

        <div className="flex items-center justify-between text-[10px] text-[var(--ex-muted)]">
          <span className="inline-flex items-center gap-1">
            <ShieldCheck className="h-3 w-3 text-[var(--ex-accent)]" aria-hidden="true" />
            <span>SL Guard: 0.25%–1.2%</span>
          </span>
          <span className="font-semibold text-[var(--ex-accent)]">
            {!hasVerifiedApiKey
              ? 'LOCKED · NO API KEY'
              : !analysis.approved
                ? 'MSNR + L3 GATE HOLD'
                : settings.autoTrading
                  ? 'AUTO-EXEC ON CONFIRM'
                  : 'MSNR + L3 READY'}
          </span>
        </div>
      </div>
    </section>
  );
};
