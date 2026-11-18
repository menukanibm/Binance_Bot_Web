import React from 'react';
import {
  Activity,
  ArrowLeftRight,
  LogOut,
  Power,
  RefreshCw,
  Settings,
  Sparkles,
  Trash2,
} from 'lucide-react';
import type {BotSettings, BotStatus, ExchangeType, TradingMode} from '../types/trading';
import {PWAInstallButton} from './PWAInstallButton';

interface NavbarProps {
  status: BotStatus;
  settings: BotSettings;
  activeExchange: ExchangeType;
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
  onExchangeChange: (ex: ExchangeType) => void;
  onLogout: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  status,
  settings,
  activeExchange,
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
  onExchangeChange,
  onLogout,
}) => {
  const isPaper = (status.tradingMode || settings.tradingMode) === 'PAPER';
  const isAutoOn = Boolean(settings.autoTrading);

  return (
    <header className="sticky top-0 z-30 border-b border-cyan-500/35 bg-[#06090e]/95 backdrop-blur-md safe-area-top shadow-[0_4px_28px_rgba(0,240,255,0.14)]">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-2 px-3 py-2 sm:px-5">
        {/* Brand & Operator Status + Mobile Quick Actions */}
        <div className="flex w-full sm:w-auto items-center justify-between gap-2 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <div className="flex h-8 w-8 sm:h-9 sm:w-9 shrink-0 items-center justify-center rounded-xl border border-cyan-400/55 bg-cyan-500/15 shadow-[0_0_16px_rgba(0,240,255,0.28)]">
              <Activity className="h-4 w-4 text-cyan-300" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm sm:text-base font-black tracking-wide glow-cyan">
                  Makka Footprint Bot
                </span>
                <span
                  className={`hidden sm:inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-mono font-black border ${
                    activeExchange === 'BINANCE'
                      ? 'border-amber-400/50 bg-amber-500/15 text-amber-300'
                      : 'border-cyan-400/50 bg-cyan-500/15 glow-cyan'
                  }`}
                >
                  {activeExchange} WS
                </span>
              </div>
              <div className="flex items-center gap-1.5 text-[10px] font-mono text-slate-400">
                <span className="truncate glow-status-emerald">{currentUser}</span>
                <span>&bull;</span>
                <span className="truncate glow-status-cyan">
                  {status.coinglassConnected ? 'MSNR LIVE' : 'Standby'}
                </span>
              </div>
            </div>
          </div>

          <div className="flex sm:hidden items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={onOpenSettings}
              aria-label="Settings"
              className="inline-flex items-center justify-center rounded-lg border border-slate-700 bg-[#0d131a] p-1.5 text-cyan-300 cursor-pointer"
            >
              <Settings className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={onLogout}
              aria-label="Sign Out mobile"
              className="inline-flex items-center justify-center rounded-lg border border-rose-500/35 bg-rose-950/25 p-1.5 text-rose-300 cursor-pointer"
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
            className="flex items-center rounded-lg border border-slate-700/80 bg-[#0d131a] p-0.5 text-[10px] sm:text-xs font-mono"
          >
            <button
              type="button"
              onClick={() => onTradingModeChange('PAPER')}
              className={`rounded-md px-2 py-1 font-bold transition cursor-pointer ${
                isPaper
                  ? 'bg-emerald-500/25 border border-emerald-400/60 glow-status-emerald'
                  : 'text-slate-400 hover:text-slate-200 border border-transparent'
              }`}
            >
              PAPER ($10K)
            </button>
            <button
              type="button"
              onClick={() => onTradingModeChange('LIVE')}
              className={`rounded-md px-2 py-1 font-bold transition cursor-pointer ${
                !isPaper
                  ? 'bg-rose-500/25 border border-rose-400/60 glow-rose'
                  : 'text-slate-400 hover:text-rose-300 border border-transparent'
              }`}
            >
              LIVE
            </button>
          </div>

          {/* 2s Spinning AUTO-TRADE ON/OFF Toggle */}
          <button
            type="button"
            onClick={onToggleBot}
            disabled={isToggling}
            className={`flex items-center gap-1.5 rounded-lg px-2.5 sm:px-3 py-1.5 text-[11px] font-mono font-black tracking-wider text-white cursor-pointer ${
              isToggling
                ? 'auto-trade-spinning'
                : isAutoOn
                  ? 'auto-trade-on'
                  : 'auto-trade-off text-rose-200'
            }`}
          >
            <Power
              className={`h-3.5 w-3.5 ${isToggling ? 'auto-trade-spin-icon' : ''}`}
              aria-hidden="true"
            />
            <span>
              {isToggling
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
            className="hidden md:block rounded-lg border border-cyan-500/35 bg-[#0d131a] px-2 py-1.5 text-xs font-mono font-bold text-cyan-200 focus:border-cyan-400 focus:outline-none cursor-pointer"
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
            className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-500/45 bg-cyan-500/15 px-2.5 py-1.5 text-[11px] font-mono font-bold glow-cyan hover:bg-cyan-500/25 cursor-pointer"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${isScanning ? 'animate-spin' : ''}`}
              aria-hidden="true"
            />
            <span className="hidden sm:inline">{isScanning ? 'Scanning...' : 'Scan Now'}</span>
            <span className="tabular-nums text-cyan-200">{countdown}s</span>
          </button>

          {/* Switch Exchange */}
          <button
            type="button"
            onClick={() =>
              onExchangeChange(activeExchange === 'BINANCE' ? 'MEXC' : 'BINANCE')
            }
            title="Switch Binance / MEXC Exchange Feed"
            className="hidden lg:inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-[#0d131a] px-2.5 py-1.5 text-[11px] font-mono font-bold text-slate-300 hover:border-cyan-400/50 hover:text-cyan-200 cursor-pointer"
          >
            <ArrowLeftRight className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{activeExchange === 'BINANCE' ? 'Switch MEXC' : 'Switch Binance'}</span>
          </button>

          {/* Diagnostic */}
          <button
            type="button"
            onClick={onOpenDiagnostic}
            title="System Diagnostic"
            className="hidden sm:inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-[#0d131a] px-2.5 py-1.5 text-[11px] font-mono font-bold text-slate-300 hover:border-cyan-400/50 hover:text-cyan-200 cursor-pointer"
          >
            <Sparkles className="h-3.5 w-3.5 text-cyan-400" aria-hidden="true" />
            <span className="hidden xl:inline">Diagnostic</span>
          </button>

          {/* Cleanup */}
          <button
            type="button"
            onClick={onOpenCleanup}
            title="Clear Signals / History"
            className="hidden sm:inline-flex items-center justify-center rounded-lg border border-slate-700 bg-[#0d131a] p-1.5 text-slate-300 hover:border-amber-400/50 hover:text-amber-300 cursor-pointer"
            aria-label="Open Cleanup Modal"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
          </button>

          {/* Settings (Desktop) */}
          <button
            type="button"
            onClick={onOpenSettings}
            title="API Vault & Risk Settings"
            className="hidden sm:inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-[#0d131a] px-2.5 py-1.5 text-[11px] font-mono font-bold text-slate-200 hover:border-cyan-400/60 hover:text-cyan-200 cursor-pointer"
          >
            <Settings className="h-3.5 w-3.5 text-cyan-300" aria-hidden="true" />
            <span className="hidden md:inline">Settings</span>
          </button>

          <PWAInstallButton compact />

          {/* Sign Out (Desktop) */}
          <button
            type="button"
            onClick={onLogout}
            aria-label="Sign Out"
            className="hidden sm:inline-flex items-center gap-1 rounded-lg border border-rose-500/35 bg-rose-950/25 px-2.5 py-1.5 text-[11px] font-mono font-bold text-rose-300 hover:bg-rose-950/45 cursor-pointer"
          >
            <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="hidden xl:inline">Sign Out</span>
          </button>
        </div>
      </div>
    </header>
  );
};
