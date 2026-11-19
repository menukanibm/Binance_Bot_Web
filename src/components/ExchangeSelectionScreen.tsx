import React, {useEffect, useState} from 'react';
import {Activity, ArrowRight, CheckCircle2, Loader2, LogOut, ShieldCheck} from 'lucide-react';
import type {ExchangeType} from '../types/trading';

interface ExchangeSelectionScreenProps {
  username: string;
  initialConnectingExchange?: ExchangeType | null;
  activeSymbol?: string;
  onExchangeConnected: (exchange: ExchangeType) => void;
  onLogout: () => void;
}

const BinanceLogoSvg: React.FC = () => (
  <svg
    viewBox="0 0 64 64"
    className="h-9 w-9 drop-shadow-[0_0_12px_rgba(240,185,11,0.75)]"
    aria-hidden="true"
  >
    <g fill="#F0B90B">
      {/* Top Chevron */}
      <polygon points="32,7 49,24 43.5,29.5 32,18 20.5,29.5 15,24" />
      {/* Bottom Chevron */}
      <polygon points="32,57 49,40 43.5,34.5 32,46 20.5,34.5 15,40" />
      {/* Center Diamond */}
      <polygon points="32,25.5 38.5,32 32,38.5 25.5,32" />
      {/* Left Diamond */}
      <polygon points="12,26.5 17.5,32 12,37.5 6.5,32" />
      {/* Right Diamond */}
      <polygon points="52,26.5 57.5,32 52,37.5 46.5,32" />
    </g>
  </svg>
);

const MexcLogoSvg: React.FC = () => (
  <svg
    viewBox="0 0 64 64"
    className="h-9 w-9 drop-shadow-[0_0_12px_rgba(0,184,255,0.75)]"
    aria-hidden="true"
  >
    <defs>
      <linearGradient id="mexcRibbonA" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#00E5FF" />
        <stop offset="100%" stopColor="#0075FF" />
      </linearGradient>
      <linearGradient id="mexcRibbonB" x1="0%" y1="100%" x2="100%" y2="0%">
        <stop offset="0%" stopColor="#0095FF" />
        <stop offset="100%" stopColor="#38BDF8" />
      </linearGradient>
    </defs>
    {/* Left & Center Ascending Peak Ribbon */}
    <path
      d="M7 44 L21 18 C23.2 14 28.8 14 31 18 L39 33 L31.5 44 L25 31.5 L16.5 46 C14.5 49.2 9.5 48.2 7 44 Z"
      fill="url(#mexcRibbonA)"
    />
    {/* Right Peak Ribbon */}
    <path
      d="M32 34 L39 20 C41.2 15.8 46.8 15.8 49 20 L57 38 C58.6 41.8 55.6 46 51.4 46 L42.5 46 L36.5 35 Z"
      fill="url(#mexcRibbonB)"
    />
  </svg>
);

export const ExchangeSelectionScreen: React.FC<ExchangeSelectionScreenProps> = ({
  username,
  initialConnectingExchange,
  activeSymbol = 'BTCUSDT',
  onExchangeConnected,
  onLogout,
}) => {
  const [connecting, setConnecting] = useState<ExchangeType | null>(
    initialConnectingExchange || null,
  );
  const [stepIndex, setStepIndex] = useState<number>(0);

  useEffect(() => {
    if (!connecting) {
      setStepIndex(0);
      return;
    }

    // Warm backend WS + historical ingestion in parallel during institutional boot sequence
    void fetch('/api/market/subscribe', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        symbol: activeSymbol,
        interval: '15m',
        exchange: connecting,
      }),
    }).catch(() => null);

    const t1 = window.setTimeout(() => setStepIndex(1), 620);
    const t2 = window.setTimeout(() => setStepIndex(2), 1250);
    const done = window.setTimeout(() => {
      onExchangeConnected(connecting);
    }, 1850);

    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.clearTimeout(done);
    };
  }, [connecting, activeSymbol, onExchangeConnected]);

  const handleSelect = (exchange: ExchangeType) => {
    if (connecting) return;
    setStepIndex(0);
    setConnecting(exchange);
  };

  const exchangeDisplayName = connecting === 'MEXC' ? 'MEXC' : 'Binance';
  const loadingSteps = [
    `Connecting to ${exchangeDisplayName} WebSocket Stream...`,
    'Fetching Historical Candlesticks & Order-Flow Data...',
    'Initializing Makka Footprint Engine...',
  ];

  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center bg-[#06090f] px-4 py-8">
      <div className="relative w-full max-w-3xl rounded-2xl border border-cyan-500/35 bg-[#0a101d] p-6 sm:p-8 shadow-[0_0_45px_rgba(0,240,255,0.14)] space-y-6 overflow-hidden">
        {/* Institutional Terminal Loading Overlay (1.85s smooth stream boot) */}
        {connecting && (
          <div
            data-testid="exchange-loading-overlay"
            role="status"
            aria-live="polite"
            className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-[#06090f]/95 backdrop-blur-md p-6 text-center"
          >
            <div className="relative flex h-20 w-20 items-center justify-center">
              <div
                className={`absolute inset-0 rounded-full border-2 border-dashed ${
                  connecting === 'BINANCE'
                    ? 'border-[#F0B90B]/70 exchange-ring-clockwise'
                    : 'border-[#00B8FF]/70 exchange-ring-counter'
                }`}
              />
              <div
                className={`flex h-14 w-14 items-center justify-center rounded-2xl border ${
                  connecting === 'BINANCE'
                    ? 'border-[#F0B90B]/70 bg-[#F0B90B]/15 shadow-[0_0_24px_rgba(240,185,11,0.45)]'
                    : 'border-[#00B8FF]/70 bg-[#00B8FF]/15 shadow-[0_0_24px_rgba(0,184,255,0.45)]'
                }`}
              >
                {connecting === 'BINANCE' ? <BinanceLogoSvg /> : <MexcLogoSvg />}
              </div>
            </div>

            <h2
              className={`mt-5 text-lg sm:text-xl font-black font-mono ${
                connecting === 'BINANCE' ? 'glow-amber' : 'glow-cyan'
              }`}
            >
              {loadingSteps[stepIndex]}
            </h2>

            <div className="mt-4 w-full max-w-md space-y-2 text-left font-mono text-xs">
              {loadingSteps.map((label, idx) => {
                const completed = idx < stepIndex;
                const current = idx === stepIndex;
                return (
                  <div
                    key={label}
                    className={`flex items-center gap-2.5 rounded-lg border px-3 py-2 transition-all ${
                      completed
                        ? 'border-emerald-500/40 bg-emerald-950/30 text-emerald-300'
                        : current
                          ? 'border-cyan-400/60 bg-cyan-950/35 text-cyan-200'
                          : 'border-slate-800/80 bg-[#070b14] text-slate-500'
                    }`}
                  >
                    {completed ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" aria-hidden="true" />
                    ) : current ? (
                      <Loader2 className="h-3.5 w-3.5 text-cyan-300 animate-spin shrink-0" aria-hidden="true" />
                    ) : (
                      <span className="h-2 w-2 rounded-full bg-slate-700 mx-0.5 shrink-0" />
                    )}
                    <span>{label}</span>
                  </div>
                );
              })}
            </div>

            <div className="mt-5 h-1.5 w-full max-w-md overflow-hidden rounded-full bg-slate-800">
              <div
                className={`h-full transition-all duration-500 ${
                  connecting === 'BINANCE'
                    ? 'bg-gradient-to-r from-amber-500 to-yellow-300'
                    : 'bg-gradient-to-r from-cyan-500 to-sky-300'
                }`}
                style={{width: `${((stepIndex + 1) / loadingSteps.length) * 100}%`}}
              />
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-4">
          <div>
            <div className="inline-flex items-center gap-2 rounded bg-cyan-500/15 border border-cyan-400/40 px-2.5 py-0.5 text-[10px] font-mono font-bold text-cyan-300 uppercase">
              <Activity className="h-3 w-3" aria-hidden="true" />
              <span>Exchange WebSocket Gatekeeper</span>
            </div>
            <h1 className="mt-2 text-xl sm:text-2xl font-black glow-cyan">
              Select Execution &amp; Data Feed
            </h1>
            <p className="mt-1 text-xs font-mono text-slate-400">
              Authenticated Operator: <span className="text-emerald-300 font-bold">{username}</span> &bull; Bind WebSocket Order-Flow Stream
            </p>
          </div>
          <button
            type="button"
            onClick={onLogout}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-[#06090f] px-3 py-2 text-xs font-mono font-bold text-slate-300 hover:border-rose-500/50 hover:text-rose-300 cursor-pointer whitespace-nowrap"
          >
            <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Sign Out</span>
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* BINANCE USD-M FUTURES CARD */}
          <button
            type="button"
            onClick={() => handleSelect('BINANCE')}
            disabled={Boolean(connecting)}
            className={`group relative overflow-hidden rounded-2xl border p-5 text-left transition-all cursor-pointer ${
              connecting === 'BINANCE'
                ? 'border-[#F0B90B] bg-amber-950/25 shadow-[0_0_30px_rgba(240,185,11,0.3)]'
                : 'border-amber-500/35 bg-[#070b14] hover:border-[#F0B90B]/85 hover:bg-amber-950/15'
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="relative flex h-14 w-14 items-center justify-center">
                <div className="absolute inset-0 rounded-full border-2 border-dashed border-[#F0B90B]/55 exchange-ring-clockwise" />
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#F0B90B]/12 border border-[#F0B90B]/50">
                  <BinanceLogoSvg />
                </div>
              </div>
              <span className="rounded-full bg-amber-500/15 border border-amber-400/40 px-2.5 py-0.5 text-[10px] font-mono font-bold text-amber-300">
                USD-M FUTURES
              </span>
            </div>

            <h2 className="mt-4 text-lg font-black text-white glow-amber">
              Binance Perpetuals
            </h2>
            <p className="mt-1 text-xs text-slate-400 leading-relaxed">
              Primary institutional footprint feed, taker buy/sell delta stream, and Isolated USD-M perpetual execution.
            </p>

            <div className="mt-4 flex items-center justify-between border-t border-slate-800/80 pt-3 text-xs font-mono">
              <span className="flex items-center gap-1.5 text-emerald-400">
                <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                <span>fapi.binance.com READY</span>
              </span>
              <span className="inline-flex items-center gap-1 font-bold text-[#F0B90B]">
                <span>{connecting === 'BINANCE' ? 'CONNECTING...' : 'CONNECT'}</span>
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </span>
            </div>
          </button>

          {/* MEXC FUTURES CARD */}
          <button
            type="button"
            onClick={() => handleSelect('MEXC')}
            disabled={Boolean(connecting)}
            className={`group relative overflow-hidden rounded-2xl border p-5 text-left transition-all cursor-pointer ${
              connecting === 'MEXC'
                ? 'border-[#00B8FF] bg-cyan-950/30 shadow-[0_0_30px_rgba(0,184,255,0.3)]'
                : 'border-cyan-500/35 bg-[#070b14] hover:border-[#00B8FF]/85 hover:bg-cyan-950/15'
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="relative flex h-14 w-14 items-center justify-center">
                <div className="absolute inset-0 rounded-full border-2 border-dashed border-[#00B8FF]/55 exchange-ring-counter" />
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#00B8FF]/12 border border-[#00B8FF]/50">
                  <MexcLogoSvg />
                </div>
              </div>
              <span className="rounded-full bg-cyan-500/15 border border-cyan-400/40 px-2.5 py-0.5 text-[10px] font-mono font-bold text-cyan-300">
                CONTRACT WS
              </span>
            </div>

            <h2 className="mt-4 text-lg font-black text-white glow-cyan">
              MEXC Futures Engine
            </h2>
            <p className="mt-1 text-xs text-slate-400 leading-relaxed">
              Zero-fee maker depth liquidity routing, contract kline telemetry, and real-time order-flow execution.
            </p>

            <div className="mt-4 flex items-center justify-between border-t border-slate-800/80 pt-3 text-xs font-mono">
              <span className="flex items-center gap-1.5 text-emerald-400">
                <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                <span>contract.mexc.com READY</span>
              </span>
              <span className="inline-flex items-center gap-1 font-bold text-[#00B8FF]">
                <span>{connecting === 'MEXC' ? 'CONNECTING...' : 'CONNECT'}</span>
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </span>
            </div>
          </button>
        </div>

        <div className="flex items-center justify-center gap-2 text-[11px] font-mono text-slate-400">
          <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
          <span>Single-device lock &amp; real-time institutional order-flow synchronization active</span>
        </div>
      </div>
    </main>
  );
};
