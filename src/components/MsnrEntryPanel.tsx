import React from 'react';
import {
  Activity,
  CheckCircle2,
  Crosshair,
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
  onExecuteSetup: (side: 'LONG' | 'SHORT') => void;
}

export const MsnrEntryPanel: React.FC<MsnrEntryPanelProps> = ({
  analysis,
  settings,
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
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-cyan-500/20 pb-2.5">
          <div className="flex items-center gap-2">
            <Crosshair className="h-4 w-4 text-cyan-300" aria-hidden="true" />
            <h2 className="text-xs sm:text-sm font-black font-mono uppercase tracking-wider glow-heading-cyan">
              MSNR Structure &amp; Institutional Confluence ({analysis.symbol})
            </h2>
          </div>
          <span className="neon-badge-cyan rounded-full px-2.5 py-0.5 text-[10px] font-mono font-black">
            {structureLabel}
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 font-mono text-xs">
          <div className="rounded-lg border border-cyan-500/25 bg-[#06090e]/90 p-2.5">
            <div className="text-[10px] text-slate-400 uppercase">4H / 1H Storyline</div>
            <div
              className={`mt-1 text-sm font-black ${
                analysis.storyline4h === 'BULLISH' ? 'glow-emerald' : 'glow-rose'
              }`}
            >
              {analysis.storyline4h}
            </div>
            <div className="mt-0.5 text-[10px] text-slate-400">
              Zone: {analysis.htfContext.swingRange4h.currentZone}
            </div>
          </div>

          <div className="rounded-lg border border-cyan-500/25 bg-[#06090e]/90 p-2.5">
            <div className="text-[10px] text-slate-400 uppercase">Footprint Flow</div>
            <div
              className={`mt-1 text-xs sm:text-sm font-black truncate ${
                analysis.footprintTrend === 'BEARISH_IMBALANCE' ? 'glow-rose' : 'glow-cyan'
              }`}
            >
              {trendLabel}
            </div>
            <div className="mt-0.5 text-[10px] text-slate-400 tabular-nums">
              POC: ${formatPrice(analysis.pocPrice ?? analysis.currentPrice, meta.decimals)}
            </div>
          </div>

          <div className="rounded-lg border border-cyan-500/25 bg-[#06090e]/90 p-2.5">
            <div className="text-[10px] text-slate-400 uppercase">Golden Pocket</div>
            <div className="mt-1 text-xs font-black text-amber-300 tabular-nums">
              ${formatPrice(analysis.goldenPocketZone?.fib650 ?? analysis.currentPrice, meta.decimals)}
              {' – '}$
              {formatPrice(analysis.goldenPocketZone?.fib618 ?? analysis.currentPrice, meta.decimals)}
            </div>
            <div className="mt-0.5 text-[10px] text-cyan-300">
              {analysis.goldenPocketZone?.inZone ? 'IN 0.618–0.650 ZONE' : '0.618–0.650 Reload'}
            </div>
          </div>

          <div className="rounded-lg border border-cyan-500/25 bg-[#06090e]/90 p-2.5">
            <div className="text-[10px] text-slate-400 uppercase">Win Probability</div>
            <div className="mt-1 text-sm font-black glow-emerald tabular-nums">
              {prob}% ({analysis.confluenceScore}/4)
            </div>
            <div className="mt-0.5 text-[10px] text-slate-400">
              FVG + MSNR Aligned
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-0.5">
          {analysis.activeConfirmations.map((conf) => (
            <span
              key={conf}
              className="inline-flex items-center gap-1 rounded-md border border-emerald-500/35 bg-emerald-950/30 px-2 py-1 text-[10px] font-mono font-bold text-emerald-300"
            >
              <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
              <span>{conf}</span>
            </span>
          ))}
        </div>
      </div>

      {/* Right Column: High-Probability Entry Zone & 1:2 R:R Setup */}
      <div className="cyber-card rounded-xl p-4 flex flex-col justify-between space-y-3 font-mono">
        <div className="flex items-center justify-between border-b border-cyan-500/20 pb-2.5">
          <div className="flex items-center gap-2">
            <Target className="h-4 w-4 text-emerald-400" aria-hidden="true" />
            <h3 className="text-xs sm:text-sm font-black uppercase glow-heading-cyan">
              High-Prob Entry Setup
            </h3>
          </div>
          <span
            className={`rounded px-2 py-0.5 text-[10px] font-black border ${
              isLong
                ? 'border-emerald-400/60 bg-emerald-500/20 glow-emerald'
                : 'border-rose-400/60 bg-rose-500/20 glow-rose'
            }`}
          >
            {analysis.bias} &bull; 1:{analysis.riskRewardRatio.toFixed(1)} R:R
          </span>
        </div>

        <div className="space-y-2 text-xs">
          <div className="flex items-center justify-between rounded-lg border border-cyan-500/25 bg-[#06090e]/90 px-3 py-2">
            <span className="text-slate-400">Entry Zone</span>
            <span className="font-black glow-cyan tabular-nums">
              ${formatPrice(analysis.entryZone.min, meta.decimals)} – $
              {formatPrice(analysis.entryZone.max, meta.decimals)}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg border border-rose-500/30 bg-rose-950/20 px-3 py-2">
              <div className="text-[10px] text-rose-300">
                Strict SL ({settings.stopLossPercent.toFixed(2)}%)
              </div>
              <div className="mt-0.5 font-black text-rose-300 tabular-nums">
                ${formatPrice(analysis.stopLoss, meta.decimals)}
              </div>
            </div>
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-950/20 px-3 py-2">
              <div className="text-[10px] text-emerald-300">1:2 R:R Target</div>
              <div className="mt-0.5 font-black glow-emerald tabular-nums">
                ${formatPrice(analysis.takeProfit, meta.decimals)}
              </div>
            </div>
          </div>
        </div>

        {settings.autoTrading ? (
          <div
            data-testid="autonomous-exec-banner"
            className="flex w-full min-h-[42px] items-center justify-center gap-2 rounded-xl border border-emerald-400/70 bg-emerald-950/40 px-3 py-2 text-xs font-black glow-intense-emerald shadow-[0_0_20px_rgba(16,185,129,0.3)]"
          >
            <Activity className="h-4 w-4 text-emerald-300 animate-pulse" aria-hidden="true" />
            <span>AUTONOMOUS AUTO-TRADE ACTIVE &bull; ZERO MANUAL CLICK</span>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => onExecuteSetup(analysis.bias)}
            className={`flex w-full min-h-[42px] items-center justify-center gap-2 rounded-xl border px-3 py-2 text-xs font-black transition cursor-pointer ${
              isLong
                ? 'border-emerald-400/65 bg-emerald-500/20 glow-emerald hover:bg-emerald-500/30 shadow-[0_0_18px_rgba(16,185,129,0.28)]'
                : 'border-rose-400/65 bg-rose-500/20 glow-rose hover:bg-rose-500/30 shadow-[0_0_18px_rgba(244,63,94,0.28)]'
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

        <div className="flex items-center justify-between text-[10px] text-slate-400">
          <span className="inline-flex items-center gap-1">
            <ShieldCheck className="h-3 w-3 text-cyan-400" aria-hidden="true" />
            <span>SL Guard: 0.25%–1.2%</span>
          </span>
          <span className="glow-status-cyan">
            {settings.autoTrading
              ? 'AUTO-EXEC ON CONFIRM'
              : analysis.approved
                ? 'SETUP READY'
                : 'WATCHING TAP'}
          </span>
        </div>
      </div>
    </section>
  );
};
