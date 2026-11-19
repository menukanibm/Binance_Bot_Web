import React from 'react';
import {Activity, Cpu, Layers, TrendingUp, Wallet} from 'lucide-react';
import type {BotSettings, BotStatus} from '../types/trading';
import {getExchangeThemeMeta} from '../utils/exchangeTheme';

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
  const themeMeta = getExchangeThemeMeta(status.activeExchange);

  return (
    <section
      aria-label="Portfolio & Bot Metrics"
      className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5"
    >
      {/* 1. Wallet Balance */}
      <div className="cyber-stat-card rounded-xl p-3.5">
        <div className="flex items-center justify-between text-[11px] font-mono font-semibold text-[var(--ex-muted)]">
          <span>Wallet Balance</span>
          <Wallet className="h-3.5 w-3.5 text-[var(--ex-accent)]" aria-hidden="true" />
        </div>
        <div className="mt-1.5 text-lg sm:text-xl font-black font-mono tabular-nums text-[var(--ex-text)]">
          ${status.accountBalance.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}
        </div>
        <div className="mt-1 text-[10px] font-mono text-[var(--ex-muted)] tabular-nums truncate">
          {!hasLiveApiKey ? (
            <span className="text-amber-400">
              API Key Not Connected &middot; Use API &amp; Settings
            </span>
          ) : status.tradingMode === 'LIVE' ? (
            <span className="text-[var(--ex-accent)] font-semibold">
              {themeMeta.headerBadge} &middot; Live Sync
            </span>
          ) : (
            <>
              Free: ${status.freeUsdt.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})} &middot;{' '}
              <span className="text-[var(--ex-long)] font-semibold">PAPER</span>
            </>
          )}
        </div>
      </div>

      {/* 2. Net PnL & Win Rate */}
      <div className="cyber-stat-card rounded-xl p-3.5">
        <div className="flex items-center justify-between text-[11px] font-mono font-semibold text-[var(--ex-muted)]">
          <span>Net PnL &amp; Win Rate</span>
          <TrendingUp
            className="h-3.5 w-3.5"
            style={{color: netPnlPositive ? 'var(--ex-long)' : 'var(--ex-short)'}}
            aria-hidden="true"
          />
        </div>
        <div
          className="mt-1.5 text-lg sm:text-xl font-black font-mono tabular-nums"
          style={{color: netPnlPositive ? 'var(--ex-long)' : 'var(--ex-short)'}}
        >
          {netPnlPositive ? '+' : '-'}${Math.abs(status.netPnl).toFixed(2)}
        </div>
        <div className="mt-1 text-[10px] font-mono text-[var(--ex-muted)] tabular-nums">
          Win Rate:{' '}
          <span className="text-[var(--ex-text)] font-bold">{status.winRate.toFixed(1)}%</span>{' '}
          ({status.totalWins}W / {status.totalLosses}L)
        </div>
      </div>

      {/* 3. Active Positions */}
      <div className="cyber-stat-card rounded-xl p-3.5">
        <div className="flex items-center justify-between text-[11px] font-mono font-semibold text-[var(--ex-muted)]">
          <span>Active Positions</span>
          <Layers className="h-3.5 w-3.5 text-[var(--ex-accent)]" aria-hidden="true" />
        </div>
        <div className="mt-1.5 text-lg sm:text-xl font-black font-mono tabular-nums text-[var(--ex-text)]">
          {hasLiveApiKey ? openPositionsCount : 0} / {status.maxConcurrentTrades}
        </div>
        <div className="mt-1 text-[10px] font-mono text-[var(--ex-muted)] tabular-nums truncate">
          {hasLiveApiKey
            ? `Margin: $${status.totalActiveMarginUsdt.toFixed(0)} (${settings.marginMode})`
            : 'Bot-Only Sync Standby'}
        </div>
      </div>

      {/* 4. Risk & Leverage Config */}
      <div className="cyber-stat-card rounded-xl p-3.5">
        <div className="flex items-center justify-between text-[11px] font-mono font-semibold text-[var(--ex-muted)]">
          <span>Engine Config</span>
          <Cpu className="h-3.5 w-3.5 text-[var(--ex-accent)]" aria-hidden="true" />
        </div>
        <div className="mt-1.5 text-lg sm:text-xl font-black font-mono tabular-nums text-[var(--ex-text)]">
          {settings.leverage}x &middot; {settings.riskPercentage}% Risk
        </div>
        <div className="mt-1 text-[10px] font-mono text-[var(--ex-muted)] tabular-nums">
          SL: {settings.stopLossPercent.toFixed(2)}% &middot; Min 1:{settings.minRiskReward.toFixed(1)} R:R
        </div>
      </div>

      {/* 5. Execution Stream */}
      <div className="col-span-2 sm:col-span-1 cyber-stat-card rounded-xl p-3.5">
        <div className="flex items-center justify-between text-[11px] font-mono font-semibold text-[var(--ex-muted)]">
          <span>Execution Stream</span>
          <Activity className="h-3.5 w-3.5 text-[var(--ex-long)]" aria-hidden="true" />
        </div>
        <div className="mt-1.5 text-sm sm:text-base font-black font-mono truncate text-[var(--ex-accent)]">
          {themeMeta.headerBadge}
        </div>
        <div className="mt-1 text-[10px] font-mono text-[var(--ex-muted)] truncate">
          {status.monitoredPairsCount} Pairs Monitored &middot; MSNR Active
        </div>
      </div>
    </section>
  );
};
