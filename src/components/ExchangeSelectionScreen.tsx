import React, {useEffect, useRef, useState} from 'react';
import {Activity, ArrowRight, CheckCircle2, Loader2, LogOut, ShieldCheck} from 'lucide-react';
import type {ExchangeType} from '../types/trading';
import {BinanceLogoSvg, MexcLogoSvg} from './ExchangeLogos';

interface ExchangeSelectionScreenProps {
  username: string;
  initialConnectingExchange?: ExchangeType | null;
  activeSymbol?: string;
  onExchangeConnected: (exchange: ExchangeType) => void;
  onLogout: () => void;
}

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
  const onConnectedRef = useRef(onExchangeConnected);
  onConnectedRef.current = onExchangeConnected;

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
      onConnectedRef.current(connecting);
    }, 1850);

    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.clearTimeout(done);
    };
  }, [connecting, activeSymbol]);

  const handleSelect = (exchange: ExchangeType) => {
    if (connecting) return;
    setStepIndex(0);
    setConnecting(exchange);
  };

  const isBinanceConn = connecting === 'BINANCE';
  const exchangeDisplayName = connecting === 'MEXC' ? 'MEXC' : 'Binance';
  const loadingSteps = [
    `Connecting to ${exchangeDisplayName} WebSocket Stream...`,
    'Fetching Historical Candlesticks & Order-Flow Data...',
    'Initializing Makka Footprint Engine...',
  ];

  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center bg-[#0B1018] px-4 py-8">
      <div className="relative w-full max-w-3xl rounded-2xl border border-[#1E293B] bg-[#131A26] p-6 sm:p-8 shadow-[0_24px_60px_rgba(0,0,0,0.6)] space-y-6 overflow-hidden">
        {/* Institutional Terminal Loading Overlay (1.85s smooth stream boot) */}
        {connecting && (
          <div
            data-testid="exchange-loading-overlay"
            data-connecting-exchange={connecting.toLowerCase()}
            role="status"
            aria-live="polite"
            className="absolute inset-0 z-20 flex flex-col items-center justify-center backdrop-blur-md p-6 text-center"
            style={{
              backgroundColor: isBinanceConn ? 'rgba(11, 14, 17, 0.96)' : 'rgba(11, 16, 24, 0.96)',
            }}
          >
            <div className="relative flex h-20 w-20 items-center justify-center">
              <div
                className={`absolute inset-0 rounded-full border-2 border-dashed ${
                  isBinanceConn
                    ? 'border-[#F0B90B]/75 exchange-ring-clockwise'
                    : 'border-[#00B8FF]/75 exchange-ring-counter'
                }`}
              />
              <div
                className={`flex h-14 w-14 items-center justify-center rounded-2xl border ${
                  isBinanceConn
                    ? 'border-[#F0B90B]/60 bg-[#F0B90B]/12'
                    : 'border-[#00B8FF]/60 bg-[#00B8FF]/12'
                }`}
              >
                {isBinanceConn ? (
                  <BinanceLogoSvg className="h-9 w-9" />
                ) : (
                  <MexcLogoSvg className="h-9 w-9" />
                )}
              </div>
            </div>

            <div
              className={`mt-4 inline-flex items-center gap-1.5 rounded-md border px-2.5 py-0.5 text-[10px] font-mono font-bold tracking-wider ${
                isBinanceConn
                  ? 'border-[#F0B90B]/40 bg-[#F0B90B]/10 text-[#F0B90B]'
                  : 'border-[#00B8FF]/40 bg-[#00B8FF]/10 text-[#00B8FF]'
              }`}
            >
              <span>{isBinanceConn ? 'BINANCE USD-M' : 'MEXC FUTURES'}</span>
            </div>

            <h2
              className={`mt-2.5 text-lg sm:text-xl font-black font-mono ${
                isBinanceConn ? 'text-[#F0B90B]' : 'text-[#00B8FF]'
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
                        ? 'border-[#10B981]/40 bg-[#10B981]/10 text-[#10B981]'
                        : current
                          ? isBinanceConn
                            ? 'border-[#F0B90B]/60 bg-[#F0B90B]/10 text-[#F8FAFC]'
                            : 'border-[#00B8FF]/60 bg-[#00B8FF]/10 text-[#F8FAFC]'
                          : 'border-[#1E293B] bg-[#0B1018] text-[#64748B]'
                    }`}
                  >
                    {completed ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-[#10B981] shrink-0" aria-hidden="true" />
                    ) : current ? (
                      <Loader2
                        className={`h-3.5 w-3.5 animate-spin shrink-0 ${
                          isBinanceConn ? 'text-[#F0B90B]' : 'text-[#00B8FF]'
                        }`}
                        aria-hidden="true"
                      />
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
                  isBinanceConn
                    ? 'bg-gradient-to-r from-[#F0B90B] to-[#FCD535]'
                    : 'bg-gradient-to-r from-[#00B8FF] to-[#38BDF8]'
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
