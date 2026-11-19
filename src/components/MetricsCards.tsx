import React from 'react';
import {Activity, Cpu, Layers, RefreshCw, TrendingUp, Wallet} from 'lucide-react';
import type {BotSettings, BotStatus, ExchangeWalletBalance} from '../types/trading';
import {getExchangeThemeMeta} from '../utils/exchangeTheme';

interface MetricsCardsProps {
  status: BotStatus;
  settings: BotSettings;
  openPositionsCount: number;
  hasLiveApiKey?: boolean;
  liveWallet?: ExchangeWalletBalance | null;
  isSyncingWallet?: boolean;
  onRefreshWallet?: () => void;
}

export const MetricsCards: React.FC<MetricsCardsProps> = ({
  status,
  settings,
  openPositionsCount,
  hasLiveApiKey = false,
  liveWallet = null,
  isSyncingWallet = false,
  onRefreshWallet,
}) => {
  const netPnlPositive = status.netPnl >= 0;
  const themeMeta = getExchangeThemeMeta(status.activeExchange);

  const isWalletLive = hasLiveApiKey && Boolean(liveWallet?.connected && liveWallet?.ok);
  const displayBalance = isWalletLive ? liveWallet!.totalWalletBalance : 0;
  const displayFree = isWalletLive ? liveWallet!.availableBalance : 0;

  return (
    <section
      aria-label="Portfolio & Bot Metrics"
      className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5"
    >
      {/* 1. Real Live Wallet Balance */}
      <div
        data-testid="wallet-balance-card"
        className="cyber-stat-card rounded-xl p-3.5"
      >
        <div className="flex items-center justify-between text-[11px] font-mono font-semibold text-[var(--ex-muted)]">
          <span>Wallet Balance</span>
          <div className="flex items-center gap-1.5">
            {hasLiveApiKey && onRefreshWallet && (
              <button
                type="button"
                onClick={onRefreshWallet}
                disabled={isSyncingWallet}
                title="Sync live USDT wallet balance from exchange"
                aria-label="Refresh live wallet balance"
                className="text-[var(--ex-muted)] hover:text-[var(--ex-accent)] transition cursor-pointer disabled:opacity-50"
              >
                <RefreshCw
                  className={`h-3 w-3 ${isSyncingWallet ? 'animate-spin' : ''}`}
                  aria-hidden="true"
                />
              </button>
            )}
            <Wallet className="h-3.5 w-3.5 text-[var(--ex-accent)]" aria-hidden="true" />
          </div>
        </div>
        <div
          data-testid="wallet-balance-amount"
          className="mt-1.5 text-lg sm:text-xl font-black font-mono tabular-nums text-[var(--ex-text)]"
        >
          ${displayBalance.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}
        </div>
        <div
          data-testid="wallet-connection-status"
          className="mt-1 text-[10px] font-mono text-[var(--ex-muted)] tabular-nums truncate"
        >
          {!hasLiveApiKey ? (
            <span className="text-amber-400">API Key Not Connected</span>
          ) : isSyncingWallet ? (
            <span className="text-[var(--ex-accent)]">Syncing live USDT wallet...</span>
          ) : isWalletLive ? (
            <span className="text-[#10B981] font-semibold">
              LIVE &bull; Connected &middot; Free ${displayFree.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}
            </span>
          ) : (
            <span
              className="text-amber-400"
              title={liveWallet?.error || 'Exchange API authentication failed'}
            >
              {liveWallet?.error
                ? `Auth Sync Issue · ${liveWallet.error.slice(0, 32)}`
                : 'API Key Stored · Syncing Balance'}
            </span>
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
          {status.monitoredPairsCount} Pairs &middot; Institutional MSNR + L3
        </div>
      </div>
    </section>
  );
};
