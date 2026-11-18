import React, {useState} from 'react';
import {Activity, ArrowRight, CheckCircle2, LogOut, ShieldCheck} from 'lucide-react';
import type {ExchangeType} from '../types/trading';

interface ExchangeSelectionScreenProps {
  username: string;
  initialConnectingExchange?: ExchangeType | null;
  onExchangeConnected: (exchange: ExchangeType) => void;
  onLogout: () => void;
}

export const ExchangeSelectionScreen: React.FC<ExchangeSelectionScreenProps> = ({
  username,
  initialConnectingExchange,
  onExchangeConnected,
  onLogout,
}) => {
  const [connecting, setConnecting] = useState<ExchangeType | null>(
    initialConnectingExchange || null,
  );

  const handleSelect = (exchange: ExchangeType) => {
    if (connecting) return;
    setConnecting(exchange);
    window.setTimeout(() => {
      onExchangeConnected(exchange);
    }, 650);
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-[#06090f] px-4 py-8">
      <div className="w-full max-w-3xl rounded-2xl border border-cyan-500/35 bg-[#0a101d] p-6 sm:p-8 shadow-[0_0_45px_rgba(0,240,255,0.14)] space-y-6">
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
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-[#06090f] px-3 py-2 text-xs font-mono font-bold text-slate-300 hover:border-rose-500/50 hover:text-rose-300 cursor-pointer"
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
                ? 'border-amber-400 bg-amber-950/25 shadow-[0_0_30px_rgba(245,158,11,0.28)]'
                : 'border-amber-500/35 bg-[#070b14] hover:border-amber-400/80 hover:bg-amber-950/15'
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="relative flex h-14 w-14 items-center justify-center">
                <div className="absolute inset-0 rounded-full border-2 border-dashed border-amber-400/50 exchange-ring-clockwise" />
                <div className="h-9 w-9 rotate-45 rounded-lg bg-amber-400/20 border border-amber-400 flex items-center justify-center shadow-[0_0_16px_rgba(245,158,11,0.5)]">
                  <span className="-rotate-45 text-sm font-black text-amber-300 font-mono">B</span>
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
              <span className="inline-flex items-center gap-1 font-bold text-amber-300">
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
                ? 'border-cyan-400 bg-cyan-950/30 shadow-[0_0_30px_rgba(0,240,255,0.28)]'
                : 'border-cyan-500/35 bg-[#070b14] hover:border-cyan-400/80 hover:bg-cyan-950/15'
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="relative flex h-14 w-14 items-center justify-center">
                <div className="absolute inset-0 rounded-full border-2 border-dashed border-cyan-400/50 exchange-ring-counter" />
                <div className="h-9 w-9 rounded-xl bg-cyan-500/20 border border-cyan-400 flex items-center justify-center shadow-[0_0_16px_rgba(0,240,255,0.5)]">
                  <span className="text-sm font-black text-cyan-300 font-mono">M</span>
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
              <span className="inline-flex items-center gap-1 font-bold text-cyan-300">
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
