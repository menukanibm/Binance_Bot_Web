import React, {useMemo, useState} from 'react';
import {
  BarChart3,
  CandlestickChart,
  Crosshair,
  Layers,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
  Waves,
} from 'lucide-react';
import type {
  BotSettings,
  Candle,
  CcxtPairInfo,
  DirectionPreference,
  FootprintSignalAnalysis,
  MarketAnalysisTab,
  Position,
  TradeSignal,
} from '../types/trading';
import {
  calculatePositionSizing,
  clampStopLossPercent,
  computeElliottWaves,
  computeGoldenPocket,
  computeVolumeProfile,
  detectSMCZones,
  formatPrice,
  generateOrderBook,
  getPairMeta,
  rawCandlesToFootprint,
} from '../utils/tradingMath';

interface CandleChartProps {
  candles: Candle[];
  analysis: FootprintSignalAnalysis | null;
  activePosition: Position | null;
  latestSignal: TradeSignal | null;
  symbol: string;
  interval: string;
  coinglassConnected: boolean;
  pairs: CcxtPairInfo[];
  settings: BotSettings;
  equity: number;
  tickPulse: number;
  onSymbolChange: (sym: string) => void;
  onIntervalChange: (tf: string) => void;
  onUpdateSettings: (partial: Partial<BotSettings>) => void;
  onExecuteManualTrade: (side: 'LONG' | 'SHORT') => void;
}

const INTERVALS = ['1m', '5m', '15m', '30m', '1h', '4h'];

const ANALYSIS_TABS: {key: MarketAnalysisTab; label: string; icon: React.ReactNode}[] = [
  {key: 'msnr_chart', label: 'MSNR Chart', icon: <CandlestickChart className="h-3.5 w-3.5" />},
  {key: 'footprint', label: 'Footprint Cluster', icon: <BarChart3 className="h-3.5 w-3.5" />},
  {key: 'orderbook', label: 'Order Book', icon: <Layers className="h-3.5 w-3.5" />},
  {key: 'smc', label: 'SMC / FVG', icon: <Crosshair className="h-3.5 w-3.5" />},
  {key: 'golden_pocket', label: 'Golden Pocket', icon: <TrendingUp className="h-3.5 w-3.5" />},
  {key: 'volume_profile', label: 'Volume Profile', icon: <BarChart3 className="h-3.5 w-3.5" />},
  {key: 'elliott_wave', label: 'Elliott Wave', icon: <Waves className="h-3.5 w-3.5" />},
];

export const CandleChart: React.FC<CandleChartProps> = ({
  candles,
  analysis,
  activePosition,
  symbol,
  interval,
  coinglassConnected,
  pairs,
  settings,
  equity,
  tickPulse,
  onSymbolChange,
  onIntervalChange,
  onUpdateSettings,
  onExecuteManualTrade,
}) => {
  const [subTab, setSubTab] = useState<MarketAnalysisTab>('msnr_chart');
  const [execSide, setExecSide] = useState<'LONG' | 'SHORT'>('LONG');
  const [showMsnr, setShowMsnr] = useState(true);
  const [showFvgOb, setShowFvgOb] = useState(true);
  const [showGoldenPocket, setShowGoldenPocket] = useState(true);
  const [showBosChoch, setShowBosChoch] = useState(true);
  const [showTargets, setShowTargets] = useState(true);

  const meta = getPairMeta(symbol);
  const visibleCandles = useMemo(() => candles.slice(-36), [candles]);
  const fpCandles = useMemo(() => rawCandlesToFootprint(symbol, visibleCandles), [symbol, visibleCandles]);
  const currentPrice = visibleCandles[visibleCandles.length - 1]?.close ?? meta.basePrice;
  const latestFp = fpCandles[fpCandles.length - 1];

  const orderBook = useMemo(
    () => generateOrderBook(symbol, currentPrice, tickPulse),
    [symbol, currentPrice, tickPulse],
  );
  const smcZones = useMemo(() => detectSMCZones(fpCandles), [fpCandles]);
  const goldenPocket = useMemo(
    () => computeGoldenPocket(fpCandles, meta.decimals),
    [fpCandles, meta.decimals],
  );
  const volumeProfile = useMemo(
    () => computeVolumeProfile(fpCandles, meta.decimals),
    [fpCandles, meta.decimals],
  );
  const elliottWaves = useMemo(() => computeElliottWaves(fpCandles), [fpCandles]);

  const sizing = useMemo(
    () =>
      calculatePositionSizing({
        accountBalance: equity,
        riskPercent: settings.riskPercentage,
        stopLossPercent: settings.stopLossPercent,
        entryPrice: currentPrice,
        side: execSide,
        leverage: settings.leverage,
      }),
    [equity, settings.riskPercentage, settings.stopLossPercent, currentPrice, execSide, settings.leverage],
  );

  // Compute SVG coordinate bounds for MSNR Candlestick Chart
  const chartGeom = useMemo(() => {
    const highs = visibleCandles.map((c) => c.high);
    const lows = visibleCandles.map((c) => c.low);
    const maxP = Math.max(...highs, currentPrice * 1.002);
    const minP = Math.min(...lows, currentPrice * 0.998);
    const pad = Math.max((maxP - minP) * 0.1, meta.tickSize);
    const top = maxP + pad;
    const bottom = minP - pad;
    const span = Math.max(top - bottom, 0.0001);
    const toY = (price: number) => 20 + ((top - price) / span) * 210;
    const maxVol = Math.max(...visibleCandles.map((c) => c.volume), 1);
    return {top, bottom, toY, maxVol};
  }, [visibleCandles, currentPrice, meta.tickSize]);

  const symbolList = useMemo(() => {
    const set = new Set<string>([
      'BTCUSDT',
      'ETHUSDT',
      'AVAXUSDT',
      'SOLUSDT',
      'XRPUSDT',
      'XAUUSD',
      ...pairs.slice(0, 15).map((p) => p.symbol),
    ]);
    return Array.from(set);
  }, [pairs]);

  const maxDepthQty = useMemo(
    () => Math.max(...orderBook.map((l) => Math.max(l.bidSize, l.askSize)), 1),
    [orderBook],
  );
  const maxVpVol = useMemo(
    () => Math.max(...volumeProfile.rows.map((r) => r.totalVolume), 1),
    [volumeProfile.rows],
  );

  const orderBookMetrics = useMemo(() => {
    const bidSum = orderBook.reduce((acc, r) => acc + r.bidSize, 0);
    const askSum = orderBook.reduce((acc, r) => acc + r.askSize, 0);
    const total = Math.max(bidSum + askSum, 1);
    const bidPct = (bidSum / total) * 100;
    const askPct = 100 - bidPct;
    const asks = orderBook.filter((r) => r.askSize > 0);
    const bids = orderBook.filter((r) => r.bidSize > 0);
    const bestAsk = asks.length > 0 ? Math.min(...asks.map((r) => r.price)) : currentPrice;
    const bestBid = bids.length > 0 ? Math.max(...bids.map((r) => r.price)) : currentPrice;
    const spread = Math.max(0, bestAsk - bestBid);
    return {bidSum, askSum, bidPct, askPct, spread};
  }, [orderBook, currentPrice]);

  const footprintTotals = useMemo(() => {
    const recent = fpCandles.slice(-6);
    const cvd = recent.reduce((sum, fc) => sum + fc.delta, 0);
    const buyVol = recent.reduce(
      (sum, fc) => sum + fc.levels.reduce((s, lvl) => s + lvl.askVol, 0),
      0,
    );
    const sellVol = recent.reduce(
      (sum, fc) => sum + fc.levels.reduce((s, lvl) => s + lvl.bidVol, 0),
      0,
    );
    return {cvd, buyVol, sellVol};
  }, [fpCandles]);

  return (
    <div className="cyber-card rounded-xl overflow-hidden">
      {/* Top Terminal Controls Strip */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-cyan-500/20 bg-[#06090e]/85 px-3 py-2.5 sm:px-4">
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Active Trading Symbol"
            value={symbol}
            onChange={(e) => onSymbolChange(e.target.value)}
            className="rounded-lg border border-cyan-500/45 bg-[#06090f] px-2.5 py-1.5 text-xs sm:text-sm font-mono font-black text-cyan-300 focus:border-cyan-400 focus:outline-none cursor-pointer"
          >
            {symbolList.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>

          <div className="font-mono tabular-nums">
            <span className="text-sm sm:text-base font-black text-white glow-white">
              ${formatPrice(currentPrice, meta.decimals)}
            </span>
            <span
              className={`ml-2 text-xs font-bold ${
                meta.change24hPct >= 0 ? 'text-emerald-400' : 'text-rose-400'
              }`}
            >
              {meta.change24hPct >= 0 ? '+' : ''}
              {meta.change24hPct.toFixed(2)}%
            </span>
          </div>

          <span
            className={`hidden sm:inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-mono font-bold border ${
              coinglassConnected
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                : 'border-slate-700 bg-slate-900 text-slate-400'
            }`}
          >
            <ShieldCheck className="h-3 w-3" aria-hidden="true" />
            <span>Delta: {latestFp && latestFp.delta >= 0 ? '+' : ''}{latestFp?.delta ?? 0}</span>
          </span>
        </div>

        {/* Timeframe Interval Buttons */}
        <div className="flex flex-wrap items-center gap-1">
          {INTERVALS.map((tf) => (
            <button
              key={tf}
              type="button"
              onClick={() => onIntervalChange(tf)}
              className={`rounded-md px-2 py-1 text-[11px] font-mono font-bold transition cursor-pointer ${
                interval === tf
                  ? 'bg-cyan-500 text-slate-950 font-black shadow-[0_0_12px_rgba(0,240,255,0.65)]'
                  : 'bg-[#0b1220] text-slate-400 border border-slate-800 hover:text-cyan-200'
              }`}
            >
              {tf}
            </button>
          ))}
        </div>
      </div>

      {/* Market Analysis Sub-Tabs (Wrapping cleanly across mobile & desktop) */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-800/80 bg-[#0b1220] px-3 py-2 sm:px-4">
        {ANALYSIS_TABS.map((t) => {
          const active = subTab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setSubTab(t.key)}
              className={`tab-glow-hover inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-mono font-bold cursor-pointer ${
                active
                  ? 'border-cyan-400 bg-cyan-500/20 text-cyan-200 shadow-[0_0_12px_rgba(0,240,255,0.3)]'
                  : 'border-slate-800 bg-[#070b14] text-slate-400 hover:text-cyan-200'
              }`}
            >
              {t.icon}
              <span>{t.label}</span>
            </button>
          );
        })}
      </div>

      {/* Active Visualization Area */}
      <div className="p-3 sm:p-4">
        {subTab === 'msnr_chart' && (
          <div className="space-y-2.5">
            {/* Interactive Chart Overlay Toggles */}
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-cyan-500/20 bg-[#06090e]/90 px-2.5 py-1.5 text-[10px] font-mono">
              <span className="font-bold uppercase tracking-wider glow-label-cyan">
                Chart Overlays:
              </span>
              <div className="flex flex-wrap items-center gap-1.5">
                {[
                  {label: 'MSNR Levels', active: showMsnr, toggle: () => setShowMsnr((v) => !v)},
                  {label: 'FVG & OB', active: showFvgOb, toggle: () => setShowFvgOb((v) => !v)},
                  {label: 'Golden Pocket', active: showGoldenPocket, toggle: () => setShowGoldenPocket((v) => !v)},
                  {label: 'BOS / CHoCH', active: showBosChoch, toggle: () => setShowBosChoch((v) => !v)},
                  {label: 'Entry / SL / TP', active: showTargets, toggle: () => setShowTargets((v) => !v)},
                ].map((ov) => (
                  <button
                    key={ov.label}
                    type="button"
                    onClick={ov.toggle}
                    className={`rounded px-2 py-0.5 font-bold transition cursor-pointer border ${
                      ov.active
                        ? 'border-cyan-400/60 bg-cyan-500/20 text-cyan-200'
                        : 'border-slate-800 bg-[#0d131a] text-slate-500 hover:text-slate-300'
                    }`}
                  >
                    {ov.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="relative rounded-xl border border-cyan-500/25 bg-[#06090e] p-2 sm:p-3">
              <svg
                viewBox="0 0 860 280"
                className="w-full h-[230px] sm:h-[280px] select-none"
                role="img"
                aria-label={`${symbol} ${interval} MSNR Candlestick & Footprint Chart`}
              >
                {/* Horizontal grid */}
                {[0.2, 0.4, 0.6, 0.8].map((pct) => (
                  <line
                    key={pct}
                    x1="10"
                    y1={20 + pct * 210}
                    x2="790"
                    y2={20 + pct * 210}
                    stroke="#1e293b"
                    strokeDasharray="3 3"
                    strokeWidth="1"
                  />
                ))}

                {/* Golden Pocket (0.618 - 0.650) Shaded Band */}
                {showGoldenPocket && (() => {
                  const y618 = chartGeom.toY(goldenPocket.fib618);
                  const y650 = chartGeom.toY(goldenPocket.fib650);
                  const topY = Math.max(15, Math.min(y618, y650));
                  const botY = Math.min(235, Math.max(y618, y650));
                  const bandH = Math.max(4, botY - topY);
                  if (topY > 235 || botY < 15) return null;
                  return (
                    <g>
                      <rect
                        x="10"
                        y={topY}
                        width="780"
                        height={bandH}
                        fill="rgba(251, 191, 36, 0.12)"
                        stroke="rgba(251, 191, 36, 0.35)"
                        strokeWidth="0.75"
                        strokeDasharray="4 3"
                      />
                      <text
                        x="784"
                        y={topY + 9}
                        textAnchor="end"
                        fill="#fbbf24"
                        fontSize="8.5"
                        fontFamily="monospace"
                        fontWeight="bold"
                      >
                        GP 0.618–0.650
                      </text>
                    </g>
                  );
                })()}

                {/* SMC Fair Value Gaps & Order Blocks */}
                {showFvgOb &&
                  smcZones.slice(0, 4).map((z) => {
                    const yTop = Math.max(15, chartGeom.toY(z.topPrice));
                    const yBot = Math.min(235, chartGeom.toY(z.bottomPrice));
                    if (yTop >= yBot) return null;
                    const isBullZone = z.type.startsWith('BULLISH');
                    const fill = isBullZone ? 'rgba(16, 185, 129, 0.12)' : 'rgba(244, 63, 94, 0.12)';
                    const stroke = isBullZone ? 'rgba(52, 211, 153, 0.45)' : 'rgba(251, 113, 133, 0.45)';
                    return (
                      <g key={z.id}>
                        <rect
                          x="220"
                          y={yTop}
                          width="570"
                          height={Math.max(4, yBot - yTop)}
                          fill={fill}
                          stroke={stroke}
                          strokeWidth="0.8"
                        />
                        <text
                          x="225"
                          y={yTop + 9}
                          fill={isBullZone ? '#6ee7b7' : '#fda4af'}
                          fontSize="8"
                          fontFamily="monospace"
                          fontWeight="bold"
                        >
                          {z.label}
                        </text>
                      </g>
                    );
                  })}

                {/* BOS / CHoCH Structural Break Marker */}
                {showBosChoch && analysis?.structureEvent && (() => {
                  const midPrice =
                    analysis.bias === 'LONG'
                      ? goldenPocket.fib382
                      : goldenPocket.fib618;
                  const yBos = chartGeom.toY(midPrice);
                  if (yBos < 18 || yBos > 232) return null;
                  const bosColor = analysis.bias === 'LONG' ? '#00f0ff' : '#fb7185';
                  return (
                    <g>
                      <line
                        x1="340"
                        y1={yBos}
                        x2="790"
                        y2={yBos}
                        stroke={bosColor}
                        strokeWidth="1.2"
                        strokeDasharray="5 2"
                      />
                      <rect
                        x="342"
                        y={yBos - 13}
                        width="86"
                        height="12"
                        rx="2"
                        fill="#06090e"
                        stroke={bosColor}
                        strokeWidth="0.6"
                      />
                      <text
                        x="385"
                        y={yBos - 4}
                        textAnchor="middle"
                        fill={bosColor}
                        fontSize="8"
                        fontFamily="monospace"
                        fontWeight="bold"
                      >
                        {analysis.structureEvent.replace('_', ' ')}
                      </text>
                    </g>
                  );
                })()}

                {/* MSNR Fresh Levels */}
                {showMsnr &&
                  analysis?.freshLevels?.map((lvl) => {
                    const y = chartGeom.toY(lvl.price);
                    if (y < 15 || y > 235) return null;
                    const color =
                      lvl.type === 'A'
                        ? '#f43f5e'
                        : lvl.type === 'V'
                          ? '#10b981'
                          : '#00f0ff';
                    return (
                      <g key={lvl.id}>
                        <line
                          x1="60"
                          y1={y}
                          x2="790"
                          y2={y}
                          stroke={color}
                          strokeWidth="1.2"
                          strokeDasharray="6 4"
                          opacity="0.75"
                        />
                        <rect
                          x="10"
                          y={y - 8}
                          width="46"
                          height="15"
                          rx="3"
                          fill="#06090e"
                          stroke={color}
                          strokeWidth="0.75"
                          opacity="0.92"
                        />
                        <text
                          x="33"
                          y={y + 3}
                          textAnchor="middle"
                          fill={color}
                          fontSize="9"
                          fontFamily="monospace"
                          fontWeight="bold"
                        >
                          {lvl.timeframe} {lvl.type}
                        </text>
                      </g>
                    );
                  })}

                {/* Active Position or Setup Entry/SL/TP Lines */}
                {showTargets && (() => {
                  const slPrice = activePosition?.stopLoss ?? analysis?.stopLoss;
                  const tpPrice = activePosition?.takeProfit ?? analysis?.takeProfit;
                  return (
                    <>
                      {slPrice && chartGeom.toY(slPrice) >= 12 && chartGeom.toY(slPrice) <= 238 && (
                        <g>
                          <line
                            x1="10"
                            y1={chartGeom.toY(slPrice)}
                            x2="790"
                            y2={chartGeom.toY(slPrice)}
                            stroke="#fb7185"
                            strokeWidth="1.1"
                            strokeDasharray="2 3"
                          />
                          <text
                            x="68"
                            y={chartGeom.toY(slPrice) - 3}
                            fill="#fda4af"
                            fontSize="8.5"
                            fontFamily="monospace"
                            fontWeight="bold"
                          >
                            SL ${formatPrice(slPrice, meta.decimals)}
                          </text>
                        </g>
                      )}
                      {tpPrice && chartGeom.toY(tpPrice) >= 12 && chartGeom.toY(tpPrice) <= 238 && (
                        <g>
                          <line
                            x1="10"
                            y1={chartGeom.toY(tpPrice)}
                            x2="790"
                            y2={chartGeom.toY(tpPrice)}
                            stroke="#34d399"
                            strokeWidth="1.1"
                            strokeDasharray="2 3"
                          />
                          <text
                            x="68"
                            y={chartGeom.toY(tpPrice) - 3}
                            fill="#6ee7b7"
                            fontSize="8.5"
                            fontFamily="monospace"
                            fontWeight="bold"
                          >
                            TP 1:2 ${formatPrice(tpPrice, meta.decimals)}
                          </text>
                        </g>
                      )}
                    </>
                  );
                })()}

                {/* Candlesticks + Bottom Volume/Delta Histogram */}
                {visibleCandles.map((c, idx) => {
                  const slotW = 770 / Math.max(visibleCandles.length, 1);
                  const x = 16 + idx * slotW + slotW / 2;
                  const candleW = Math.max(4, slotW * 0.58);
                  const isBull = c.close >= c.open;
                  const color = isBull ? '#10b981' : '#f43f5e';
                  const yHigh = chartGeom.toY(c.high);
                  const yLow = chartGeom.toY(c.low);
                  const yOpen = chartGeom.toY(c.open);
                  const yClose = chartGeom.toY(c.close);
                  const bodyTop = Math.min(yOpen, yClose);
                  const bodyH = Math.max(2, Math.abs(yClose - yOpen));
                  const volH = Math.max(2, (c.volume / chartGeom.maxVol) * 32);

                  return (
                    <g key={`${c.time}-${idx}`}>
                      <line x1={x} y1={yHigh} x2={x} y2={yLow} stroke={color} strokeWidth="1.4" />
                      <rect
                        x={x - candleW / 2}
                        y={bodyTop}
                        width={candleW}
                        height={bodyH}
                        fill={color}
                        rx="1"
                      />
                      <rect
                        x={x - candleW / 2}
                        y={272 - volH}
                        width={candleW}
                        height={volH}
                        fill={c.delta >= 0 ? 'rgba(0, 240, 255, 0.45)' : 'rgba(244, 63, 94, 0.45)'}
                      />
                    </g>
                  );
                })}

                {/* Current Price Tag */}
                <g>
                  <line
                    x1="10"
                    y1={chartGeom.toY(currentPrice)}
                    x2="790"
                    y2={chartGeom.toY(currentPrice)}
                    stroke="#00f0ff"
                    strokeWidth="1"
                    opacity="0.65"
                  />
                  <rect
                    x="792"
                    y={chartGeom.toY(currentPrice) - 9}
                    width="64"
                    height="18"
                    rx="4"
                    fill="#00f0ff"
                  />
                  <text
                    x="824"
                    y={chartGeom.toY(currentPrice) + 3}
                    textAnchor="middle"
                    fill="#06090f"
                    fontSize="9.5"
                    fontFamily="monospace"
                    fontWeight="bold"
                  >
                    {currentPrice > 100 ? currentPrice.toFixed(1) : currentPrice.toFixed(3)}
                  </text>
                </g>
              </svg>
            </div>
          </div>
        )}

        {subTab === 'footprint' && (
          <div className="space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-cyan-500/20 bg-[#06090e]/90 px-3 py-2 text-xs font-mono">
              <span className="font-bold glow-heading-cyan">
                Bid x Ask Institutional Cluster Matrix (Last 6 Candles)
              </span>
              <div className="flex flex-wrap items-center gap-3 text-[11px] tabular-nums">
                <span className={footprintTotals.cvd >= 0 ? 'glow-emerald font-bold' : 'glow-rose font-bold'}>
                  CVD: {footprintTotals.cvd >= 0 ? '+' : ''}
                  {footprintTotals.cvd}
                </span>
                <span className="text-emerald-300">Ask Vol: {footprintTotals.buyVol}</span>
                <span className="text-rose-300">Bid Vol: {footprintTotals.sellVol}</span>
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
              {fpCandles.slice(-6).map((fc) => (
                <div
                  key={fc.index}
                  className="rounded-lg border border-slate-800 bg-[#06090f] p-2 font-mono text-[10px]"
                >
                  <div className="flex items-center justify-between border-b border-slate-800 pb-1 mb-1">
                    <span className="text-slate-400">{fc.timeLabel}</span>
                    <span className={fc.delta >= 0 ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
                      Δ {fc.delta >= 0 ? '+' : ''}
                      {fc.delta}
                    </span>
                  </div>
                  <div className="space-y-0.5">
                    {fc.levels.map((lvl, i) => (
                      <div
                        key={i}
                        className={`flex items-center justify-between rounded px-1 py-0.5 tabular-nums ${
                          lvl.isPoc
                            ? 'bg-cyan-500/20 border border-cyan-400/50 text-cyan-200 font-bold'
                            : ''
                        }`}
                      >
                        <span className={lvl.imbalance === 'BID' ? 'text-rose-400 font-bold' : 'text-slate-400'}>
                          {lvl.bidVol}
                        </span>
                        <span className="text-[9px] text-slate-500">
                          {formatPrice(lvl.price, meta.decimals)}
                        </span>
                        <span className={lvl.imbalance === 'ASK' ? 'text-emerald-400 font-bold' : 'text-slate-300'}>
                          {lvl.askVol}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {subTab === 'orderbook' && (
          <div className="space-y-3 font-mono text-xs">
            {/* Order Book Depth Imbalance Heatmap Summary */}
            <div className="rounded-xl border border-cyan-500/25 bg-[#06090e]/95 p-3 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                <span className="font-black glow-heading-cyan">
                  ORDER BOOK DEPTH HEATMAP &amp; LIQUIDITY IMBALANCE
                </span>
                <div className="flex items-center gap-3 tabular-nums">
                  <span className="glow-emerald font-bold">
                    BID {orderBookMetrics.bidPct.toFixed(1)}%
                  </span>
                  <span className="text-cyan-300">
                    Spread: ${formatPrice(orderBookMetrics.spread, meta.decimals)}
                  </span>
                  <span className="glow-rose font-bold">
                    ASK {orderBookMetrics.askPct.toFixed(1)}%
                  </span>
                </div>
              </div>
              <div className="h-2.5 w-full rounded-full bg-rose-950/70 overflow-hidden flex border border-slate-800">
                <div
                  className="h-full bg-gradient-to-r from-emerald-500 to-cyan-400 transition-all"
                  style={{width: `${orderBookMetrics.bidPct}%`}}
                />
                <div
                  className="h-full bg-gradient-to-r from-rose-500/80 to-rose-400 transition-all"
                  style={{width: `${orderBookMetrics.askPct}%`}}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="rounded-xl border border-rose-500/25 bg-[#06090e] p-3 space-y-1.5">
                <div className="flex justify-between text-[11px] font-bold text-rose-300 border-b border-slate-800 pb-1.5">
                  <span>ASK LIQUIDITY WALLS</span>
                  <span>SIZE / CUM</span>
                </div>
              {orderBook
                .filter((r) => r.askSize > 0)
                .map((row) => (
                  <div key={row.price} className="relative flex items-center justify-between px-2 py-1 rounded overflow-hidden">
                    <div
                      className="absolute inset-y-0 right-0 bg-rose-500/15"
                      style={{width: `${Math.min(100, (row.askSize / maxDepthQty) * 100)}%`}}
                    />
                    <span className="relative text-rose-300 tabular-nums">
                      ${formatPrice(row.price, meta.decimals)}
                      {row.isLiquidityWall && (
                        <span className="ml-1.5 rounded bg-rose-500/25 px-1 text-[9px] text-rose-200">
                          WALL
                        </span>
                      )}
                    </span>
                    <span className="relative text-slate-200 tabular-nums">
                      {row.askSize.toFixed(1)} ({row.cumulativeAsk.toFixed(0)})
                    </span>
                  </div>
                ))}
            </div>

            <div className="rounded-xl border border-emerald-500/25 bg-[#06090f] p-3 space-y-1.5">
              <div className="flex justify-between text-[11px] font-bold text-emerald-300 border-b border-slate-800 pb-1.5">
                <span>BID LIQUIDITY WALLS</span>
                <span>SIZE / CUM</span>
              </div>
              {orderBook
                .filter((r) => r.bidSize > 0)
                .map((row) => (
                  <div key={row.price} className="relative flex items-center justify-between px-2 py-1 rounded overflow-hidden">
                    <div
                      className="absolute inset-y-0 right-0 bg-emerald-500/15"
                      style={{width: `${Math.min(100, (row.bidSize / maxDepthQty) * 100)}%`}}
                    />
                    <span className="relative text-emerald-300 tabular-nums">
                      ${formatPrice(row.price, meta.decimals)}
                      {row.isLiquidityWall && (
                        <span className="ml-1.5 rounded bg-emerald-500/25 px-1 text-[9px] text-emerald-200">
                          WALL
                        </span>
                      )}
                    </span>
                    <span className="relative text-slate-200 tabular-nums">
                      {row.bidSize.toFixed(1)} ({row.cumulativeBid.toFixed(0)})
                    </span>
                  </div>
                ))}
            </div>
            </div>
          </div>
        )}

        {subTab === 'smc' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 font-mono text-xs">
            {smcZones.map((z) => (
              <div
                key={z.id}
                className="rounded-xl border border-cyan-500/25 bg-[#06090f] p-3 space-y-1"
              >
                <div className="flex items-center justify-between">
                  <span className="font-black text-cyan-300">{z.label}</span>
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                      z.mitigated
                        ? 'bg-slate-800 text-slate-400'
                        : 'bg-emerald-500/20 text-emerald-300'
                    }`}
                  >
                    {z.mitigated ? 'MITIGATED' : 'UNMITIGATED'}
                  </span>
                </div>
                <div className="text-slate-300 tabular-nums">
                  Zone: ${formatPrice(z.bottomPrice, meta.decimals)} – $
                  {formatPrice(z.topPrice, meta.decimals)}
                </div>
                <div className="text-[10px] text-slate-500">
                  Type: {z.type} &bull; Candles {z.startIndex}..{z.endIndex}
                </div>
              </div>
            ))}
          </div>
        )}

        {subTab === 'golden_pocket' && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 font-mono text-xs">
            {[
              {label: 'Swing High (0.0)', val: goldenPocket.swingHigh, tone: 'text-rose-300'},
              {label: 'Fib 0.382', val: goldenPocket.fib382, tone: 'text-slate-300'},
              {label: 'Equilibrium (0.50)', val: goldenPocket.fib500, tone: 'text-cyan-300'},
              {label: 'Golden 0.618', val: goldenPocket.fib618, tone: 'text-amber-300 font-black'},
              {label: 'Golden 0.650', val: goldenPocket.fib650, tone: 'text-amber-300 font-black'},
              {label: 'Deep 0.786', val: goldenPocket.fib786, tone: 'text-emerald-300'},
              {label: 'Swing Low (1.0)', val: goldenPocket.swingLow, tone: 'text-emerald-400'},
              {label: 'Institutional Bias', valText: goldenPocket.bias, tone: 'glow-cyan font-black'},
            ].map((item) => (
              <div
                key={item.label}
                className="rounded-xl border border-slate-800 bg-[#06090f] p-3"
              >
                <div className="text-[10px] text-slate-400 uppercase">{item.label}</div>
                <div className={`mt-1 text-sm tabular-nums ${item.tone}`}>
                  {item.valText ? item.valText : `$${formatPrice(item.val!, meta.decimals)}`}
                </div>
              </div>
            ))}
          </div>
        )}

        {subTab === 'volume_profile' && (
          <div className="space-y-3 font-mono text-xs">
            <div className="flex flex-wrap items-center gap-4 rounded-xl border border-slate-800 bg-[#06090f] px-3 py-2">
              <span className="text-emerald-300 font-bold">
                VAH: ${formatPrice(volumeProfile.vahPrice, meta.decimals)}
              </span>
              <span className="glow-cyan font-black">
                POC: ${formatPrice(volumeProfile.pocPrice, meta.decimals)}
              </span>
              <span className="text-rose-300 font-bold">
                VAL: ${formatPrice(volumeProfile.valPrice, meta.decimals)}
              </span>
            </div>
            <div className="space-y-1">
              {volumeProfile.rows.slice(0, 10).map((row) => (
                <div
                  key={row.price}
                  className="flex items-center gap-2 rounded bg-[#06090f] px-2.5 py-1 text-[11px]"
                >
                  <span className="w-24 shrink-0 tabular-nums text-slate-300">
                    ${formatPrice(row.price, meta.decimals)}
                  </span>
                  <div className="flex-1 h-2.5 rounded bg-slate-900 overflow-hidden">
                    <div
                      className={`h-full ${
                        row.zone === 'POC'
                          ? 'bg-cyan-400'
                          : row.zone === 'VA'
                            ? 'bg-emerald-500/70'
                            : 'bg-slate-600'
                      }`}
                      style={{width: `${(row.totalVolume / maxVpVol) * 100}%`}}
                    />
                  </div>
                  <span className="w-16 text-right tabular-nums text-slate-400">
                    {row.totalVolume}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {subTab === 'elliott_wave' && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 font-mono text-xs">
            {elliottWaves.map((w) => (
              <div
                key={w.waveLabel}
                className="rounded-xl border border-slate-800 bg-[#06090f] p-3 flex items-center justify-between"
              >
                <div>
                  <div className="text-[10px] text-slate-400">{w.phase}</div>
                  <div className="text-sm font-black glow-cyan">Wave ({w.waveLabel})</div>
                </div>
                <div className="text-right tabular-nums text-slate-200 font-bold">
                  ${formatPrice(w.price, meta.decimals)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Risk & Manual Sniper Execution Footer Strip */}
      <div className="border-t border-slate-800/90 bg-[#070b14] px-3 py-3 sm:px-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3 text-xs font-mono">
            <label className="flex items-center gap-1.5 text-slate-300">
              <span>Risk %</span>
              <input
                type="number"
                min={0.5}
                max={5}
                step={0.5}
                value={settings.riskPercentage}
                onChange={(e) =>
                  onUpdateSettings({
                    riskPercentage: Math.min(5, Math.max(0.5, Number(e.target.value) || 1)),
                  })
                }
                className="w-16 rounded border border-slate-700 bg-[#06090f] px-2 py-1 text-xs text-cyan-300 font-bold"
              />
            </label>

            <label className="flex items-center gap-1.5 text-slate-300">
              <span>SL % (0.25–1.2)</span>
              <input
                type="number"
                min={0.25}
                max={1.2}
                step={0.05}
                value={settings.stopLossPercent}
                onChange={(e) =>
                  onUpdateSettings({
                    stopLossPercent: clampStopLossPercent(Number(e.target.value)),
                  })
                }
                className="w-18 rounded border border-slate-700 bg-[#06090f] px-2 py-1 text-xs text-rose-300 font-bold"
              />
            </label>

            <label className="flex items-center gap-1.5 text-slate-300">
              <span>Lev</span>
              <select
                value={settings.leverage}
                onChange={(e) => onUpdateSettings({leverage: Number(e.target.value)})}
                className="rounded border border-slate-700 bg-[#06090f] px-2 py-1 text-xs text-cyan-300 font-bold"
              >
                {[5, 10, 20, 25, 50].map((lev) => (
                  <option key={lev} value={lev}>
                    {lev}x
                  </option>
                ))}
              </select>
            </label>

            <label className="flex items-center gap-1.5 text-slate-300">
              <span>Dir</span>
              <select
                value={settings.directionPreference}
                onChange={(e) =>
                  onUpdateSettings({
                    directionPreference: e.target.value as DirectionPreference,
                  })
                }
                className="rounded border border-slate-700 bg-[#06090f] px-2 py-1 text-xs text-slate-200 font-bold"
              >
                <option value="BOTH">LONG + SHORT</option>
                <option value="LONG">LONG ONLY</option>
                <option value="SHORT">SHORT ONLY</option>
              </select>
            </label>

            <span className="text-[11px] text-emerald-300 font-bold">
              1:2 R:R Target &bull; Risk ${sizing.riskUsd} &rarr; +${sizing.rewardUsd}
            </span>
          </div>

          <div className="flex items-center gap-2 font-mono">
            <button
              type="button"
              onClick={() => {
                setExecSide('LONG');
                onExecuteManualTrade('LONG');
              }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-400/60 bg-emerald-500/20 px-3 py-1.5 text-xs font-black text-emerald-300 hover:bg-emerald-500/30 cursor-pointer"
            >
              <TrendingUp className="h-3.5 w-3.5" aria-hidden="true" />
              <span>SNIPE LONG</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setExecSide('SHORT');
                onExecuteManualTrade('SHORT');
              }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-rose-400/60 bg-rose-500/20 px-3 py-1.5 text-xs font-black text-rose-300 hover:bg-rose-500/30 cursor-pointer"
            >
              <TrendingDown className="h-3.5 w-3.5" aria-hidden="true" />
              <span>SNIPE SHORT</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
