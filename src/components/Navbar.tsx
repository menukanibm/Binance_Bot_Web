import React from 'react';
import {
  KeyRound,
  LogOut,
  Power,
  RefreshCw,
  Settings,
  Sparkles,
  Trash2,
} from 'lucide-react';
import type {BotSettings, BotStatus, ExchangeType, TradingMode} from '../types/trading';
import {getExchangeThemeMeta} from '../utils/exchangeTheme';
import {ExchangeBrandLogo} from './ExchangeLogos';
import {PWAInstallButton} from './PWAInstallButton';

interface NavbarProps {
  status: BotStatus;
  settings: BotSettings;
  activeExchange: ExchangeType;
  hasVerifiedApiKey: boolean;
  countdown: number;
  isScanning: boolean;
  isToggling: boolean;
  currentUser: string;
  onToggleBot: () => void;
  onTriggerScan: () => void;
  onOpenSettings: () => void;
  onOpenDiagnostic: () => void;
  onOpenCleanup: () => void;
  onTimeframeChange: (tf: 'AUTO' | '5m' | '15m' | '1h') => void;
  onTradingModeChange: (mode: TradingMode) => void;
  onLogout: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  status,
  settings,
  activeExchange,
  hasVerifiedApiKey,
  countdown,
  isScanning,
  isToggling,
  currentUser,
  onToggleBot,
  onTriggerScan,
  onOpenSettings,
  onOpenDiagnostic,
  onOpenCleanup,
  onTimeframeChange,
  onTradingModeChange,
  onLogout,
}) => {
  const isPaper = (status.tradingMode || settings.tradingMode) === 'PAPER';
  const isAutoOn = hasVerifiedApiKey && Boolean(settings.autoTrading);
  const themeMeta = getExchangeThemeMeta(activeExchange);

  return (
    <header className="ex-header sticky top-0 z-30 backdrop-blur-md safe-area-top">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-2.5 px-3 py-2.5 sm:px-5">
        {/* Brand + Dynamic Official Exchange Logo & Venue Badge + Mobile Quick Actions */}
        <div className="flex w-full sm:w-auto items-center justify-between gap-2 min-w-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div
              data-testid="navbar-exchange-logo"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border"
              style={{
                borderColor: `rgba(var(--ex-accent-rgb), 0.45)`,
                backgroundColor: `rgba(var(--ex-accent-rgb), 0.12)`,
              }}
            >
              <ExchangeBrandLogo exchange={activeExchange} className="h-5 w-5" />
            </div>

            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm sm:text-base font-black tracking-tight text-[var(--ex-text)]">
                  Makka Footprint Bot
                </span>
                <span
                  data-testid="navbar-venue-badge"
                  className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-mono font-extrabold tracking-wide whitespace-nowrap shrink-0 border"
                  style={{
                    color: themeMeta.primaryAccent,
                    backgroundColor: `rgba(var(--ex-accent-rgb), 0.12)`,
                    borderColor: `rgba(var(--ex-accent-rgb), 0.4)`,
                  }}
                >
                  <ExchangeBrandLogo exchange={activeExchange} className="h-3 w-3" />
                  <span>{themeMeta.headerBadge}</span>
                </span>
              </div>
              <div className="flex items-center gap-1.5 text-[10px] font-mono text-[var(--ex-muted)]">
                <span className="truncate font-semibold text-[var(--ex-long)]">{currentUser}</span>
                <span aria-hidden="true">&middot;</span>
                <span className="truncate text-[var(--ex-accent)] font-semibold">
                  {status.coinglassConnected ? 'MSNR LIVE' : 'Standby'}
                </span>
              </div>
            </div>
          </div>

          <div className="flex sm:hidden items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={onOpenSettings}
              aria-label="API & Settings"
              className="inline-flex items-center gap-1 rounded-lg border border-[var(--ex-border)] bg-[var(--ex-surface)] px-2 py-1.5 text-[10px] font-mono font-bold text-[var(--ex-accent)] cursor-pointer whitespace-nowrap"
            >
              <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
              <span>API</span>
            </button>
            <button
              type="button"
              onClick={onLogout}
              aria-label="Sign Out mobile"
              className="inline-flex items-center justify-center rounded-lg border border-rose-500/35 bg-rose-950/25 p-1.5 text-[var(--ex-short)] cursor-pointer"
            >
              <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* Center/Right Controls */}
        <div className="flex w-full sm:w-auto flex-wrap items-center justify-between sm:justify-end gap-1.5 sm:gap-2">
          {/* PAPER ($10K) vs LIVE Switch */}
          <div
            role="group"
            aria-label="Trading Mode"
            className="flex items-center rounded-lg border border-[var(--ex-border)] bg-[var(--ex-surface)] p-0.5 text-[10px] sm:text-xs font-mono"
          >
            <button
              type="button"
              onClick={() => onTradingModeChange('PAPER')}
              className={`rounded-md px-2 py-1 font-bold transition cursor-pointer whitespace-nowrap ${
                isPaper
                  ? 'bg-[rgba(var(--ex-long-rgb),0.18)] border border-[rgba(var(--ex-long-rgb),0.5)] text-[var(--ex-long)]'
                  : 'text-[var(--ex-muted)] hover:text-[var(--ex-text)] border border-transparent'
              }`}
            >
              PAPER ($10K)
            </button>
            <button
              type="button"
              onClick={() => onTradingModeChange('LIVE')}
              className={`rounded-md px-2 py-1 font-bold transition cursor-pointer whitespace-nowrap ${
                !isPaper
                  ? 'bg-[rgba(var(--ex-short-rgb),0.18)] border border-[rgba(var(--ex-short-rgb),0.5)] text-[var(--ex-short)]'
                  : 'text-[var(--ex-muted)] hover:text-[var(--ex-short)] border border-transparent'
              }`}
            >
              LIVE
            </button>
          </div>

          {/* AUTO-TRADE ON/OFF Toggle (Strictly disabled when API key missing — API & Settings is sole vault entry) */}
          <button
            type="button"
            onClick={onToggleBot}
            disabled={isToggling || !hasVerifiedApiKey}
            title={
              hasVerifiedApiKey
                ? 'Toggle Autonomous Auto-Trade'
                : `Auto-Trade locked until ${themeMeta.venueName} API key is saved in API & Settings`
            }
            className={`flex items-center gap-1.5 rounded-lg px-2.5 sm:px-3 py-1.5 text-[11px] font-mono font-extrabold tracking-wide whitespace-nowrap shrink-0 transition ${
              !hasVerifiedApiKey
                ? 'border border-[var(--ex-border)] bg-[var(--ex-surface)] text-[var(--ex-muted)] cursor-not-allowed opacity-75'
                : isToggling
                  ? 'auto-trade-spinning cursor-wait'
                  : isAutoOn
                    ? 'auto-trade-on cursor-pointer'
                    : 'auto-trade-off cursor-pointer'
            }`}
          >
            <Power
              className={`h-3.5 w-3.5 ${isToggling ? 'auto-trade-spin-icon' : ''}`}
              aria-hidden="true"
            />
            <span>
              {!hasVerifiedApiKey
                ? 'AUTO-TRADE LOCKED'
                : isToggling
                  ? 'SYNCING...'
                  : isAutoOn
                    ? 'AUTO-TRADE ON'
                    : 'AUTO-TRADE OFF'}
            </span>
          </button>

          {/* Timeframe Mode Selector */}
          <select
            aria-label="Timeframe Mode"
            value={settings.timeframeMode}
            onChange={(e) =>
              onTimeframeChange(e.target.value as 'AUTO' | '5m' | '15m' | '1h')
            }
            className="hidden md:block rounded-lg border border-[var(--ex-border)] bg-[var(--ex-surface)] px-2 py-1.5 text-xs font-mono font-bold text-[var(--ex-text)] ex-focus-ring cursor-pointer"
          >
            <option value="AUTO">TF: AUTO</option>
            <option value="5m">TF: 5m</option>
            <option value="15m">TF: 15m</option>
            <option value="1h">TF: 1h</option>
          </select>

          {/* Scan Now + Countdown */}
          <button
            type="button"
            onClick={onTriggerScan}
            disabled={isScanning}
            className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-mono font-bold cursor-pointer whitespace-nowrap transition"
            style={{
              borderColor: 'rgba(var(--ex-accent-rgb), 0.45)',
              backgroundColor: 'rgba(var(--ex-accent-rgb), 0.12)',
              color: 'var(--ex-accent)',
            }}
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${isScanning ? 'animate-spin' : ''}`}
              aria-hidden="true"
            />
            <span className="hidden sm:inline">{isScanning ? 'Scanning...' : 'Scan Now'}</span>
            <span className="tabular-nums text-[var(--ex-text)]">{countdown}s</span>
          </button>

          {/* Diagnostic */}
          <button
            type="button"
            onClick={onOpenDiagnostic}
            title="System Diagnostic"
            className="hidden sm:inline-flex items-center gap-1 rounded-lg border border-[var(--ex-border)] bg-[var(--ex-surface)] px-2.5 py-1.5 text-[11px] font-mono font-bold text-[var(--ex-muted)] hover:border-[var(--ex-accent)] hover:text-[var(--ex-text)] cursor-pointer whitespace-nowrap transition"
          >
            <Sparkles className="h-3.5 w-3.5 text-[var(--ex-accent)]" aria-hidden="true" />
            <span className="hidden xl:inline">Diagnostic</span>
          </button>

          {/* Cleanup */}
          <button
            type="button"
            onClick={onOpenCleanup}
            title="Clear Signals / History"
            className="hidden sm:inline-flex items-center justify-center rounded-lg border border-[var(--ex-border)] bg-[var(--ex-surface)] p-1.5 text-[var(--ex-muted)] hover:border-amber-400/60 hover:text-amber-400 cursor-pointer transition"
            aria-label="Open Cleanup Modal"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
          </button>

          {/* SINGLE UNIFIED API & SETTINGS ENTRY POINT */}
          <button
            type="button"
            onClick={onOpenSettings}
            data-testid="navbar-api-settings-btn"
            title="API Vault & Risk Configuration"
            className="hidden sm:inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-mono font-extrabold cursor-pointer whitespace-nowrap transition ex-tab-active"
          >
            <Settings className="h-3.5 w-3.5" aria-hidden="true" />
            <span>API &amp; Settings</span>
          </button>

          <PWAInstallButton compact />

          {/* Sign Out (Desktop) */}
          <button
            type="button"
            onClick={onLogout}
            aria-label="Sign Out"
            className="hidden sm:inline-flex items-center gap-1 rounded-lg border border-[rgba(var(--ex-short-rgb),0.4)] bg-[rgba(var(--ex-short-rgb),0.1)] px-2.5 py-1.5 text-[11px] font-mono font-bold text-[var(--ex-short)] hover:bg-[rgba(var(--ex-short-rgb),0.2)] cursor-pointer whitespace-nowrap transition"
          >
            <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="hidden xl:inline">Sign Out</span>
          </button>
        </div>
      </div>
    </header>
  );
};
