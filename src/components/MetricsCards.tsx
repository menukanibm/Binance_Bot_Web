import React from 'react';
import {Activity, Cpu, Layers, TrendingUp, Wallet} from 'lucide-react';
import type {BotSettings, BotStatus} from '../types/trading';

interface MetricsCardsProps {
  status: BotStatus;
  settings: BotSettings;
  openPositionsCount: number;
  hasLiveApiKey?: boolean;
}

export const MetricsCards: React.FC<MetricsCardsProps> = ({
  status,
  settings,
  openPositionsCount,
  hasLiveApiKey = false,
}) => {
  const netPnlPositive = status.netPnl >= 0;

  return (
    <section
      aria-label="Portfolio & Bot Metrics"
      className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5"
    >
      {/* 1. Wallet Balance */}
      <div className="cyber-stat-card rounded-xl p-3.5">
        <div className="flex items-center justify-between text-[10px] font-mono font-bold uppercase tracking-wider glow-label-cyan">
          <span>Wallet Balance</span>
          <Wallet className="h-3.5 w-3.5 text-cyan-300 drop-shadow-[0_0_6px_rgba(0,240,255,0.8)]" aria-hidden="true" />
        </div>
        <div className="mt-1.5 text-lg sm:text-xl font-black font-mono tabular-nums glow-intense-cyan">
          ${status.accountBalance.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}
        </div>
        <div className="mt-0.5 text-[10px] font-mono text-slate-300 tabular-nums truncate">
          {status.tradingMode === 'LIVE' ? (
            <span className={hasLiveApiKey ? 'text-cyan-300' : 'text-amber-300'}>
              {hasLiveApiKey
                ? `${status.activeExchange} API • Live Sync`
                : `LIVE • Add ${status.activeExchange} API Key`}
            </span>
          ) : (
            <>
              Free: ${status.freeUsdt.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})} &bull;{' '}
              <span className="text-emerald-300">PAPER</span>
            </>
          )}
        </div>
      </div>

      {/* 2. Net PnL & Win Rate */}
      <div className="cyber-stat-card rounded-xl p-3.5">
        <div className="flex items-center justify-between text-[10px] font-mono font-bold uppercase tracking-wider glow-label-cyan">
          <span>Net PnL &amp; Win Rate</span>
          <TrendingUp
            className={`h-3.5 w-3.5 ${
              netPnlPositive
                ? 'text-emerald-300 drop-shadow-[0_0_6px_rgba(16,185,129,0.8)]'
                : 'text-rose-400 drop-shadow-[0_0_6px_rgba(244,63,94,0.8)]'
            }`}
            aria-hidden="true"
          />
        </div>
        <div
          className={`mt-1.5 text-lg sm:text-xl font-black font-mono tabular-nums ${
            netPnlPositive ? 'glow-intense-emerald' : 'glow-rose'
          }`}
        >
          {netPnlPositive ? '+' : '-'}${Math.abs(status.netPnl).toFixed(2)}
        </div>
        <div className="mt-0.5 text-[10px] font-mono text-slate-300 tabular-nums">
          Win Rate: <span className="glow-cyan font-bold">{status.winRate.toFixed(1)}%</span> ({status.totalWins}W / {status.totalLosses}L)
        </div>
      </div>

      {/* 3. Active Positions */}
      <div className="cyber-stat-card rounded-xl p-3.5">
        <div className="flex items-center justify-between text-[10px] font-mono font-bold uppercase tracking-wider glow-label-cyan">
          <span>Active Positions</span>
          <Layers className="h-3.5 w-3.5 text-cyan-300 drop-shadow-[0_0_6px_rgba(0,240,255,0.8)]" aria-hidden="true" />
        </div>
        <div className="mt-1.5 text-lg sm:text-xl font-black font-mono tabular-nums glow-intense-cyan">
          {hasLiveApiKey ? openPositionsCount : 0} / {status.maxConcurrentTrades}
        </div>
        <div className="mt-0.5 text-[10px] font-mono text-slate-300 tabular-nums truncate">
          {hasLiveApiKey
            ? `Margin: $${status.totalActiveMarginUsdt.toFixed(0)} (${settings.marginMode})`
            : 'API Key Required • Bot-Only Sync'}
        </div>
      </div>

      {/* 4. Risk & Leverage Config */}
      <div className="cyber-stat-card rounded-xl p-3.5">
        <div className="flex items-center justify-between text-[10px] font-mono font-bold uppercase tracking-wider glow-label-cyan">
          <span>Engine Config</span>
          <Cpu className="h-3.5 w-3.5 text-cyan-300 drop-shadow-[0_0_6px_rgba(0,240,255,0.8)]" aria-hidden="true" />
        </div>
        <div className="mt-1.5 text-lg sm:text-xl font-black font-mono tabular-nums glow-intense-cyan">
          {settings.leverage}x &bull; {settings.riskPercentage}% Risk
        </div>
        <div className="mt-0.5 text-[10px] font-mono text-slate-300 tabular-nums">
          SL: {settings.stopLossPercent.toFixed(2)}% &bull; Min 1:{settings.minRiskReward.toFixed(1)} R:R
        </div>
      </div>

      {/* 5. Execution Stream */}
      <div className="col-span-2 sm:col-span-1 cyber-stat-card rounded-xl p-3.5">
        <div className="flex items-center justify-between text-[10px] font-mono font-bold uppercase tracking-wider glow-label-cyan">
          <span>Execution Stream</span>
          <Activity className="h-3.5 w-3.5 text-emerald-300 drop-shadow-[0_0_6px_rgba(16,185,129,0.8)]" aria-hidden="true" />
        </div>
        <div className="mt-1.5 text-sm sm:text-base font-black font-mono truncate glow-intense-emerald">
          {status.activeExchange} WS LIVE
        </div>
        <div className="mt-0.5 text-[10px] font-mono text-slate-300 truncate">
          {status.monitoredPairsCount} Pairs Monitored &bull; MSNR Active
        </div>
      </div>
    </section>
  );
};
