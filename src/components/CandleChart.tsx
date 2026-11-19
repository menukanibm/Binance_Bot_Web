import React, {useMemo, useRef, useState} from 'react';
import {
  BarChart3,
  CandlestickChart,
  ChevronLeft,
  ChevronRight,
  Crosshair,
  Layers,
  Radio,
  ShieldCheck,
  SlidersHorizontal,
  TrendingDown,
  TrendingUp,
  Waves,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type {
  BotSettings,
  Candle,
  CcxtPairInfo,
  DirectionPreference,
  FootprintCandle,
  FootprintSignalAnalysis,
  MarketAnalysisTab,
  OrderBookLevel,
  Position,
  TickTradeEvent,
  TradeSignal,
} from '../types/trading';
import {
  buildTradingViewFootprintCandles,
  formatCompactVol,
} from '../utils/footprintEngine';
import {
  calculatePositionSizing,
  clampStopLossPercent,
  computeElliottWaves,
  computeGoldenPocket,
  computeVolumeProfile,
  detectSMCZones,
  formatPrice,
  getPairMeta,
  rawCandlesToFootprint,
} from '../utils/tradingMath';

interface CandleChartProps {
  candles: Candle[];
  recentTicks?: TickTradeEvent[];
  liveOrderBook?: OrderBookLevel[];
  analysis: FootprintSignalAnalysis | null;
  activePosition: Position | null;
  latestSignal: TradeSignal | null;
  symbol: string;
  interval: string;
  coinglassConnected: boolean;
  pairs: CcxtPairInfo[];
  settings: BotSettings;
  equity: number;
  hasVerifiedApiKey: boolean;
  tickPulse: number;
  onSymbolChange: (sym: string) => void;
  onIntervalChange: (tf: string) => void;
  onUpdateSettings: (partial: Partial<BotSettings>) => void;
  onExecuteManualTrade: (side: 'LONG' | 'SHORT') => void;
}

const INTERVALS = ['1m', '5m', '15m', '30m', '1h', '4h'];

const ANALYSIS_TABS: {key: MarketAnalysisTab; label: string; icon: React.ReactNode}[] = [
  {key: 'msnr_chart', label: 'MSNR + Footprint', icon: <CandlestickChart className="h-3.5 w-3.5" />},
  {key: 'footprint', label: 'Cluster Matrix', icon: <BarChart3 className="h-3.5 w-3.5" />},
  {key: 'orderbook', label: 'Order Book', icon: <Layers className="h-3.5 w-3.5" />},
  {key: 'smc', label: 'SMC / FVG', icon: <Crosshair className="h-3.5 w-3.5" />},
  {key: 'golden_pocket', label: 'Golden Pocket', icon: <TrendingUp className="h-3.5 w-3.5" />},
  {key: 'volume_profile', label: 'Volume Profile', icon: <BarChart3 className="h-3.5 w-3.5" />},
  {key: 'elliott_wave', label: 'Elliott Wave', icon: <Waves className="h-3.5 w-3.5" />},
];

const SEMANTIC_FOOTPRINT_THRESHOLD = 14;

export const CandleChart: React.FC<CandleChartProps> = ({
  candles,
  recentTicks = [],
  liveOrderBook = [],
  analysis,
  activePosition,
  symbol,
  interval,
  coinglassConnected,
  pairs,
  settings,
  equity,
  hasVerifiedApiKey,
  onSymbolChange,
  onIntervalChange,
  onUpdateSettings,
  onExecuteManualTrade,
}) => {
  const [subTab, setSubTab] = useState<MarketAnalysisTab>('msnr_chart');
  const [execSide, setExecSide] = useState<'LONG' | 'SHORT'>('LONG');

  // Overlay & Footprint Settings
  const [showMsnr, setShowMsnr] = useState(true);
  const [showFvgOb, setShowFvgOb] = useState(true);
  const [showGoldenPocket, setShowGoldenPocket] = useState(true);
  const [showBosChoch, setShowBosChoch] = useState(true);
  const [showTargets, setShowTargets] = useState(true);

  // Semantic Zoom & Pan State
  const [candlesInView, setCandlesInView] = useState<number>(32);
  const [panOffset, setPanOffset] = useState<number>(0); // 0 = live rightmost edge
  const [viewModeOverride, setViewModeOverride] = useState<'AUTO' | 'FOOTPRINT' | 'CANDLES'>('AUTO');

  // TradingView Footprint Tuning Options
  const [imbalanceRatioPct, setImbalanceRatioPct] = useState<number>(300);
  const [rowMultiplier, setRowMultiplier] = useState<number | 'AUTO'>('AUTO');
  const [showStackedZones, setShowStackedZones] = useState<boolean>(true);
  const [showValueArea, setShowValueArea] = useState<boolean>(true);
  const [showUnfinishedAuction, setShowUnfinishedAuction] = useState<boolean>(true);
  const [showFpConfig, setShowFpConfig] = useState<boolean>(false);

  // Crosshair & Drag Pan State
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [hoverYPrice, setHoverYPrice] = useState<number | null>(null);
  const dragStateRef = useRef<{dragging: boolean; startX: number; startPan: number}>({
    dragging: false,
    startX: 0,
    startPan: 0,
  });

  const meta = getPairMeta(symbol);
  const isFootprintMode =
    viewModeOverride === 'FOOTPRINT' ||
    (viewModeOverride === 'AUTO' && candlesInView <= SEMANTIC_FOOTPRINT_THRESHOLD);

  const clampedViewCount = isFootprintMode
    ? Math.min(14, Math.max(6, candlesInView))
    : Math.min(120, Math.max(15, candlesInView));

  const maxPan = Math.max(0, candles.length - clampedViewCount);
  const safePan = Math.min(maxPan, Math.max(0, panOffset));

  const visibleCandles = useMemo(() => {
    if (candles.length === 0) return [];
    const end = candles.length - safePan;
    const start = Math.max(0, end - clampedViewCount);
    return candles.slice(start, end);
  }, [candles, safePan, clampedViewCount]);

  // Legacy helper for secondary tabs (SMC / GP / VP / Elliott)
  const legacyFpCandles = useMemo(
    () => rawCandlesToFootprint(symbol, visibleCandles),
    [symbol, visibleCandles],
  );

  // Full TradingView Volume Footprint engine output
  const tvFootprintCandles = useMemo(
    () =>
      buildTradingViewFootprintCandles(symbol, visibleCandles, recentTicks, interval, {
        imbalanceRatioPct,
        rowMultiplier,
        candlesInView: visibleCandles.length,
      }),
    [symbol, visibleCandles, recentTicks, interval, imbalanceRatioPct, rowMultiplier],
  );

  const currentPrice = candles[candles.length - 1]?.close ?? analysis?.currentPrice ?? 0;
  const visibleLastPrice = visibleCandles[visibleCandles.length - 1]?.close ?? currentPrice;
  const latestFp = tvFootprintCandles[tvFootprintCandles.length - 1];

  const orderBook = useMemo(() => liveOrderBook, [liveOrderBook]);
  const smcZones = useMemo(() => detectSMCZones(legacyFpCandles), [legacyFpCandles]);
  const goldenPocket = useMemo(
    () => computeGoldenPocket(legacyFpCandles, meta.decimals),
    [legacyFpCandles, meta.decimals],
  );
  const volumeProfile = useMemo(
    () => computeVolumeProfile(legacyFpCandles, meta.decimals),
    [legacyFpCandles, meta.decimals],
  );
  const elliottWaves = useMemo(() => computeElliottWaves(legacyFpCandles), [legacyFpCandles]);

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

  // Unified SVG Geometry (Matches bottom Footprint Summary Table gutters 1:1)
  const svgW = 960;
  const plotLeft = 78; // 8.125%
  const plotRight = 888; // 92.5% -> 72px right axis (7.5%)
  const plotW = plotRight - plotLeft;
  const plotTop = 26;
  const plotHeight = isFootprintMode ? 304 : 230;
  const svgHeight = isFootprintMode ? 346 : 292;

  const chartGeom = useMemo(() => {
    const highs = visibleCandles.map((c) => c.high);
    const lows = visibleCandles.map((c) => c.low);
    const maxP = highs.length > 0 ? Math.max(...highs, visibleLastPrice * 1.001) : meta.basePrice * 1.005;
    const minP = lows.length > 0 ? Math.min(...lows, visibleLastPrice * 0.999) : meta.basePrice * 0.995;
    const pad = Math.max((maxP - minP) * 0.1, meta.tickSize);
    const top = maxP + pad;
    const bottom = minP - pad;
    const span = Math.max(top - bottom, 0.0001);
    const toY = (price: number) => plotTop + ((top - price) / span) * plotHeight;
    const fromY = (y: number) => top - ((y - plotTop) / plotHeight) * span;
    const maxVol = Math.max(...visibleCandles.map((c) => c.volume), 1);
    return {top, bottom, toY, fromY, maxVol};
  }, [visibleCandles, visibleLastPrice, meta.basePrice, meta.tickSize, plotHeight]);

  const symbolList = useMemo(() => {
    const set = new Set<string>([symbol, ...pairs.slice(0, 30).map((p) => p.symbol)]);
    return Array.from(set);
  }, [pairs, symbol]);

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
    const recent = tvFootprintCandles.slice(-6);
    const cvd = recent.reduce((sum, fc) => sum + fc.delta, 0);
    const buyVol = recent.reduce((sum, fc) => sum + (fc.buyVolume ?? 0), 0);
    const sellVol = recent.reduce((sum, fc) => sum + (fc.sellVolume ?? 0), 0);
    return {cvd, buyVol, sellVol};
  }, [tvFootprintCandles]);

  const handleZoomIn = () => {
    setViewModeOverride('AUTO');
    setCandlesInView((v) => Math.max(7, v > 18 ? Math.round(v * 0.68) : v - 2));
  };

  const handleZoomOut = () => {
    setViewModeOverride('AUTO');
    setCandlesInView((v) => Math.min(120, v < 18 ? v + 4 : Math.round(v * 1.4)));
  };

  const handleWheelZoom = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (e.deltaY < 0) {
      handleZoomIn();
    } else if (e.deltaY > 0) {
      handleZoomOut();
    }
  };

  const handleToggleFootprintZoom = () => {
    if (isFootprintMode) {
      setViewModeOverride('CANDLES');
      setCandlesInView(36);
    } else {
      setViewModeOverride('FOOTPRINT');
      setCandlesInView(9);
      setPanOffset(0);
    }
  };

  const activeHoverFp: FootprintCandle | null =
    hoverIdx !== null && tvFootprintCandles[hoverIdx] ? tvFootprintCandles[hoverIdx] : null;

  const canTradeManual = hasVerifiedApiKey && equity > 0;

  return (
    <div className="cyber-card rounded-xl overflow-hidden">
      {/* Top Terminal Controls Strip */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-[var(--ex-border)] bg-[var(--ex-surface-inset)] px-3 py-2.5 sm:px-4">
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Active Trading Symbol"
            value={symbol}
            onChange={(e) => {
              setPanOffset(0);
              onSymbolChange(e.target.value);
            }}
            className="rounded-lg border border-[var(--ex-border)] bg-[var(--ex-surface)] px-2.5 py-1.5 text-xs sm:text-sm font-mono font-black text-[var(--ex-accent)] ex-focus-ring cursor-pointer"
          >
            {symbolList.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>

          <div className="font-mono tabular-nums">
            <span className="text-sm sm:text-base font-black text-[var(--ex-text)]">
              ${formatPrice(currentPrice, meta.decimals)}
            </span>
            <span
              className="ml-2 text-xs font-bold"
              style={{color: meta.change24hPct >= 0 ? 'var(--ex-long)' : 'var(--ex-short)'}}
            >
              {meta.change24hPct >= 0 ? '+' : ''}
              {meta.change24hPct.toFixed(2)}%
            </span>
          </div>

          <span
            className={`hidden sm:inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-mono font-bold border ${
              coinglassConnected
                ? 'border-[rgba(var(--ex-long-rgb),0.4)] bg-[rgba(var(--ex-long-rgb),0.1)] text-[var(--ex-long)]'
                : 'border-[var(--ex-border)] bg-[var(--ex-surface)] text-[var(--ex-muted)]'
            }`}
          >
            <ShieldCheck className="h-3 w-3" aria-hidden="true" />
            <span>
              Delta: {latestFp && latestFp.delta >= 0 ? '+' : ''}
              {latestFp ? formatCompactVol(latestFp.delta) : 0} &middot; {candles.length} Bars
            </span>
          </span>
        </div>

        {/* Timeframe Interval Buttons */}
        <div className="flex flex-wrap items-center gap-1">
          {INTERVALS.map((tf) => (
            <button
              key={tf}
              type="button"
              onClick={() => {
                setPanOffset(0);
                onIntervalChange(tf);
              }}
              className={`rounded-md px-2.5 py-1 text-[11px] font-mono font-bold transition cursor-pointer border ${
                interval === tf
                  ? 'ex-tab-active font-black'
                  : 'bg-[var(--ex-surface)] text-[var(--ex-muted)] border-[var(--ex-border)] hover:text-[var(--ex-accent)]'
              }`}
            >
              {tf}
            </button>
          ))}
        </div>
      </div>

      {/* Market Analysis Sub-Tabs */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-[var(--ex-border)] bg-[var(--ex-surface-inset)] px-3 py-2 sm:px-4">
        {ANALYSIS_TABS.map((t) => {
          const active = subTab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setSubTab(t.key)}
              className={`tab-glow-hover inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-mono font-bold cursor-pointer whitespace-nowrap ${
                active
                  ? 'ex-accent-pill'
                  : 'border-[var(--ex-border)] bg-[var(--ex-surface)] text-[var(--ex-muted)] hover:text-[var(--ex-text)]'
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
            {/* Semantic Zoom, Pan, Overlay Toggles & Footprint Settings Toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--ex-border)] bg-[var(--ex-surface-inset)] px-2.5 py-2 text-[10px] font-mono">
              <div className="flex flex-wrap items-center gap-1.5">
                {[
                  {label: 'MSNR', active: showMsnr, toggle: () => setShowMsnr((v) => !v)},
                  {label: 'FVG & OB', active: showFvgOb, toggle: () => setShowFvgOb((v) => !v)},
                  {label: 'Golden Pocket', active: showGoldenPocket, toggle: () => setShowGoldenPocket((v) => !v)},
                  {label: 'BOS / CHoCH', active: showBosChoch, toggle: () => setShowBosChoch((v) => !v)},
                  {label: 'SL / TP', active: showTargets, toggle: () => setShowTargets((v) => !v)},
                ].map((ov) => (
                  <button
                    key={ov.label}
                    type="button"
                    onClick={ov.toggle}
                    className={`rounded px-2 py-0.5 font-bold transition cursor-pointer border whitespace-nowrap ${
                      ov.active
                        ? 'ex-accent-pill'
                        : 'border-[var(--ex-border)] bg-[var(--ex-surface)] text-[var(--ex-muted)] hover:text-[var(--ex-text)]'
                    }`}
                  >
                    {ov.label}
                  </button>
                ))}
              </div>

              {/* Zoom + History Panning + Footprint Mode Toggle */}
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={handleToggleFootprintZoom}
                  data-testid="toggle-footprint-zoom"
                  className={`inline-flex items-center gap-1 rounded px-2.5 py-0.5 font-black border cursor-pointer whitespace-nowrap transition ${
                    isFootprintMode
                      ? 'border-[rgba(var(--ex-long-rgb),0.7)] bg-[rgba(var(--ex-long-rgb),0.16)] text-[var(--ex-long)]'
                      : 'ex-accent-pill hover:opacity-90'
                  }`}
                >
                  <BarChart3 className="h-3 w-3" aria-hidden="true" />
                  <span>{isFootprintMode ? 'FOOTPRINT ON' : 'ZOOM TO FOOTPRINT'}</span>
                </button>

                <div className="inline-flex items-center rounded border border-[var(--ex-border)] bg-[var(--ex-surface)]">
                  <button
                    type="button"
                    onClick={() => setPanOffset((p) => Math.min(maxPan, p + Math.max(2, Math.floor(clampedViewCount / 3))))}
                    disabled={safePan >= maxPan}
                    aria-label="Pan Left History"
                    className="px-1.5 py-0.5 text-[var(--ex-muted)] hover:text-[var(--ex-accent)] disabled:opacity-35 cursor-pointer"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setPanOffset((p) => Math.max(0, p - Math.max(2, Math.floor(clampedViewCount / 3))))}
                    disabled={safePan === 0}
                    aria-label="Pan Right Forward"
                    className="px-1.5 py-0.5 text-[var(--ex-muted)] hover:text-[var(--ex-accent)] disabled:opacity-35 cursor-pointer"
                  >
                    <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                  {safePan > 0 && (
                    <button
                      type="button"
                      onClick={() => setPanOffset(0)}
                      className="inline-flex items-center gap-1 border-l border-[var(--ex-border)] px-2 py-0.5 text-[var(--ex-long)] font-bold hover:bg-[rgba(var(--ex-long-rgb),0.12)] cursor-pointer"
                    >
                      <Radio className="h-2.5 w-2.5" aria-hidden="true" />
                      <span>Live</span>
                    </button>
                  )}
                </div>

                <div className="inline-flex items-center rounded border border-[var(--ex-border)] bg-[var(--ex-surface)]">
                  <button
                    type="button"
                    onClick={handleZoomIn}
                    aria-label="Zoom In Chart"
                    className="px-1.5 py-0.5 text-[var(--ex-accent)] hover:bg-[rgba(var(--ex-accent-rgb),0.12)] cursor-pointer"
                  >
                    <ZoomIn className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                  <span className="px-1.5 text-[10px] text-[var(--ex-muted)] tabular-nums">
                    {visibleCandles.length} bars
                  </span>
                  <button
                    type="button"
                    onClick={handleZoomOut}
                    aria-label="Zoom Out Chart"
                    className="px-1.5 py-0.5 text-[var(--ex-accent)] hover:bg-[rgba(var(--ex-accent-rgb),0.12)] cursor-pointer"
                  >
                    <ZoomOut className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => setShowFpConfig((v) => !v)}
                  aria-label="Footprint Settings"
                  className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 font-bold cursor-pointer transition ${
                    showFpConfig
                      ? 'ex-accent-pill'
                      : 'border-[var(--ex-border)] bg-[var(--ex-surface)] text-[var(--ex-muted)] hover:text-[var(--ex-text)]'
                  }`}
                >
                  <SlidersHorizontal className="h-3 w-3" aria-hidden="true" />
                  <span>FP Config</span>
                </button>
              </div>
            </div>

            {/* Footprint Quick Settings Popover Bar */}
            {showFpConfig && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--ex-border)] bg-[var(--ex-surface-inset)] px-3 py-2 text-[11px] font-mono">
                <div className="flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-1.5 text-[var(--ex-muted)]">
                    <span>Imbalance %</span>
                    <select
                      aria-label="Imbalance Ratio Threshold"
                      value={imbalanceRatioPct}
                      onChange={(e) => setImbalanceRatioPct(Number(e.target.value))}
                      className="rounded border border-[var(--ex-border)] bg-[var(--ex-surface)] px-2 py-0.5 text-[var(--ex-accent)] font-bold"
                    >
                      <option value={200}>200%</option>
                      <option value={300}>300% (Default)</option>
                      <option value={400}>400%</option>
                      <option value={500}>500%</option>
                    </select>
                  </label>

                  <label className="flex items-center gap-1.5 text-slate-300">
                    <span>Row Size</span>
                    <select
                      aria-label="Footprint Row Size"
                      value={String(rowMultiplier)}
                      onChange={(e) =>
                        setRowMultiplier(
                          e.target.value === 'AUTO' ? 'AUTO' : Number(e.target.value),
                        )
                      }
                      className="rounded border border-slate-700 bg-[#06090f] px-2 py-0.5 text-cyan-300 font-bold"
                    >
                      <option value="AUTO">Auto Aggregation</option>
                      <option value="1">1x Base</option>
                      <option value="2">2x Ticks</option>
                      <option value="4">4x Ticks</option>
                    </select>
                  </label>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowStackedZones((v) => !v)}
                    className={`rounded px-2 py-0.5 border font-bold cursor-pointer ${
                      showStackedZones
                        ? 'border-emerald-400/60 bg-emerald-500/20 text-emerald-200'
                        : 'border-slate-700 text-slate-400'
                    }`}
                  >
                    Stacked Imbalances (3+)
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowValueArea((v) => !v)}
                    className={`rounded px-2 py-0.5 border font-bold cursor-pointer ${
                      showValueArea
                        ? 'border-cyan-400/60 bg-cyan-500/20 text-cyan-200'
                        : 'border-slate-700 text-slate-400'
                    }`}
                  >
                    POC &amp; 70% VA
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowUnfinishedAuction((v) => !v)}
                    className={`rounded px-2 py-0.5 border font-bold cursor-pointer ${
                      showUnfinishedAuction
                        ? 'border-amber-400/60 bg-amber-500/20 text-amber-200'
                        : 'border-slate-700 text-slate-400'
                    }`}
                  >
                    Unfinished Auctions
                  </button>
                </div>
              </div>
            )}

            {/* Main Unified Candlestick + TradingView Volume Footprint Chart Container */}
            <div
              data-testid="chart-viewport"
              data-chart-mode={isFootprintMode ? 'FOOTPRINT' : 'CANDLESTICK'}
              onWheel={handleWheelZoom}
              onMouseDown={(e) => {
                dragStateRef.current = {dragging: true, startX: e.clientX, startPan: safePan};
              }}
              onMouseUp={() => {
                dragStateRef.current.dragging = false;
              }}
              onMouseLeave={() => {
                dragStateRef.current.dragging = false;
                setHoverIdx(null);
                setHoverYPrice(null);
              }}
              className="relative rounded-xl border border-cyan-500/25 bg-[#06090e] p-2 sm:p-3 overflow-x-auto"
            >
              {/* Floating Crosshair HUD Tooltip */}
              {activeHoverFp && (
                <div
                  data-testid="chart-crosshair-tooltip"
                  className="pointer-events-none sticky left-0 top-2 z-10 mb-1.5 inline-flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-cyan-500/45 bg-[#070d18]/92 px-2.5 py-1 text-[10px] sm:text-[11px] font-mono shadow-[0_0_18px_rgba(0,0,0,0.75)] backdrop-blur-sm tabular-nums"
                >
                  <span className="font-black text-cyan-300">{activeHoverFp.timeLabel}</span>
                  <span className="text-slate-300">
                    O:{formatPrice(activeHoverFp.open, meta.decimals)} H:
                    {formatPrice(activeHoverFp.high, meta.decimals)} L:
                    {formatPrice(activeHoverFp.low, meta.decimals)} C:
                    {formatPrice(activeHoverFp.close, meta.decimals)}
                  </span>
                  <span className="text-slate-200">
                    Vol: <strong>{formatCompactVol(activeHoverFp.volume)}</strong>
                  </span>
                  <span
                    className={
                      activeHoverFp.delta >= 0
                        ? 'text-emerald-300 font-black'
                        : 'text-rose-300 font-black'
                    }
                  >
                    Δ {activeHoverFp.delta >= 0 ? '+' : ''}
                    {formatCompactVol(activeHoverFp.delta)} ({activeHoverFp.deltaPercent}%)
                  </span>
                  <span className="text-amber-300 font-bold">
                    POC: ${formatPrice(activeHoverFp.pocPrice, meta.decimals)}
                  </span>
                  <span className="hidden md:inline text-slate-400">
                    Max/Min Δ: +{formatCompactVol(activeHoverFp.maxDelta ?? 0)} /{' '}
                    {formatCompactVol(activeHoverFp.minDelta ?? 0)} &bull; CVD:{' '}
                    {formatCompactVol(activeHoverFp.cvd)}
                  </span>
                </div>
              )}

              <div className={isFootprintMode ? 'min-w-[740px]' : 'w-full'}>
              <svg
                viewBox={`0 0 ${svgW} ${svgHeight}`}
                onMouseMove={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const relX = ((e.clientX - rect.left) / Math.max(1, rect.width)) * svgW;
                  const relY = ((e.clientY - rect.top) / Math.max(1, rect.height)) * svgHeight;
                  if (dragStateRef.current.dragging) {
                    const deltaPx = e.clientX - dragStateRef.current.startX;
                    const barPx = rect.width / Math.max(1, visibleCandles.length);
                    const deltaBars = Math.round(deltaPx / Math.max(12, barPx));
                    const nextPan = Math.min(
                      maxPan,
                      Math.max(0, dragStateRef.current.startPan + deltaBars),
                    );
                    setPanOffset(nextPan);
                    return;
                  }
                  const slotW = plotW / Math.max(visibleCandles.length, 1);
                  const idx = Math.floor((relX - plotLeft) / slotW);
                  if (idx >= 0 && idx < visibleCandles.length && relY >= plotTop && relY <= plotTop + plotHeight) {
                    setHoverIdx(idx);
                    setHoverYPrice(chartGeom.fromY(relY));
                  } else {
                    setHoverIdx(null);
                    setHoverYPrice(null);
                  }
                }}
                className={`w-full select-none ${
                  isFootprintMode ? 'h-[330px] sm:h-[400px]' : 'h-[245px] sm:h-[310px]'
                }`}
                role="img"
                aria-label={`${symbol} ${interval} ${isFootprintMode ? 'TradingView Volume Footprint' : 'MSNR Candlestick'} Chart`}
              >
                {/* Horizontal Price Grid + Right Axis Labels */}
                {[0.15, 0.35, 0.55, 0.75, 0.92].map((pct) => {
                  const yPos = plotTop + pct * plotHeight;
                  const axisPrice = chartGeom.fromY(yPos);
                  return (
                    <g key={pct}>
                      <line
                        x1={plotLeft}
                        y1={yPos}
                        x2={plotRight}
                        y2={yPos}
                        stroke="#1e293b"
                        strokeDasharray="3 3"
                        strokeWidth="1"
                      />
                      <text
                        x={plotRight + 6}
                        y={yPos + 3}
                        fill="#64748b"
                        fontSize="10"
                        fontFamily="JetBrains Mono, monospace"
                      >
                        {formatPrice(axisPrice, meta.decimals)}
                      </text>
                    </g>
                  );
                })}

                {/* Golden Pocket (0.618 - 0.650) */}
                {showGoldenPocket &&
                  (() => {
                    const y618 = chartGeom.toY(goldenPocket.fib618);
                    const y650 = chartGeom.toY(goldenPocket.fib650);
                    const topY = Math.max(plotTop, Math.min(y618, y650));
                    const botY = Math.min(plotTop + plotHeight, Math.max(y618, y650));
                    const bandH = Math.max(4, botY - topY);
                    if (topY > plotTop + plotHeight || botY < plotTop) return null;
                    return (
                      <g>
                        <rect
                          x={plotLeft}
                          y={topY}
                          width={plotW}
                          height={bandH}
                          fill="rgba(251, 191, 36, 0.09)"
                          stroke="rgba(251, 191, 36, 0.3)"
                          strokeWidth="0.75"
                          strokeDasharray="4 3"
                        />
                        <text
                          x={plotRight - 6}
                          y={topY + 11}
                          textAnchor="end"
                          fill="#fbbf24"
                          fontSize="9.5"
                          fontFamily="JetBrains Mono, monospace"
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
                    const yTop = Math.max(plotTop, chartGeom.toY(z.topPrice));
                    const yBot = Math.min(plotTop + plotHeight, chartGeom.toY(z.bottomPrice));
                    if (yTop >= yBot) return null;
                    const isBullZone = z.type.startsWith('BULLISH');
                    const fill = isFootprintMode
                      ? isBullZone
                        ? 'rgba(16, 185, 129, 0.04)'
                        : 'rgba(244, 63, 94, 0.04)'
                      : isBullZone
                        ? 'rgba(16, 185, 129, 0.1)'
                        : 'rgba(244, 63, 94, 0.1)';
                    const stroke = isBullZone
                      ? 'rgba(52, 211, 153, 0.32)'
                      : 'rgba(251, 113, 133, 0.32)';
                    return (
                      <g key={z.id}>
                        <rect
                          x={plotLeft}
                          y={yTop}
                          width={plotW}
                          height={Math.max(4, yBot - yTop)}
                          fill={fill}
                          stroke={stroke}
                          strokeWidth="0.7"
                        />
                        {!isFootprintMode && (
                          <text
                            x={246}
                            y={yTop + 10}
                            fill={isBullZone ? '#6ee7b7' : '#fda4af'}
                            fontSize="9"
                            fontFamily="JetBrains Mono, monospace"
                            fontWeight="bold"
                          >
                            {z.label}
                          </text>
                        )}
                      </g>
                    );
                  })}

                {/* BOS / CHoCH Marker */}
                {showBosChoch &&
                  analysis?.structureEvent &&
                  (() => {
                    const midPrice =
                      analysis.bias === 'LONG' ? goldenPocket.fib382 : goldenPocket.fib618;
                    const yBos = chartGeom.toY(midPrice);
                    if (yBos < plotTop + 4 || yBos > plotTop + plotHeight - 4) return null;
                    const bosColor = analysis.bias === 'LONG' ? '#00f0ff' : '#fb7185';
                    return (
                      <g>
                        <line
                          x1={380}
                          y1={yBos}
                          x2={plotRight}
                          y2={yBos}
                          stroke={bosColor}
                          strokeWidth="1.2"
                          strokeDasharray="5 2"
                        />
                        <rect
                          x={382}
                          y={yBos - 13}
                          width={94}
                          height={12}
                          rx="2"
                          fill="#06090e"
                          stroke={bosColor}
                          strokeWidth="0.6"
                        />
                        <text
                          x={429}
                          y={yBos - 4}
                          textAnchor="middle"
                          fill={bosColor}
                          fontSize="8.5"
                          fontFamily="JetBrains Mono, monospace"
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
                    if (y < plotTop || y > plotTop + plotHeight) return null;
                    const color =
                      lvl.type === 'A'
                        ? '#f43f5e'
                        : lvl.type === 'V'
                          ? '#10b981'
                          : '#00f0ff';
                    return (
                      <g key={lvl.id}>
                        <line
                          x1={66}
                          y1={y}
                          x2={plotRight}
                          y2={y}
                          stroke={color}
                          strokeWidth="1.15"
                          strokeDasharray="6 4"
                          opacity="0.7"
                        />
                        <rect
                          x={12}
                          y={y - 8}
                          width={54}
                          height={16}
                          rx="3"
                          fill="#06090e"
                          stroke={color}
                          strokeWidth="0.75"
                          opacity="0.92"
                        />
                        <text
                          x={39}
                          y={y + 3}
                          textAnchor="middle"
                          fill={color}
                          fontSize="9"
                          fontFamily="JetBrains Mono, monospace"
                          fontWeight="bold"
                        >
                          {lvl.timeframe} {lvl.type}
                        </text>
                      </g>
                    );
                  })}

                {/* Active Position or Setup SL/TP Lines */}
                {showTargets &&
                  (() => {
                    const slPrice = activePosition?.stopLoss ?? analysis?.stopLoss;
                    const tpPrice = activePosition?.takeProfit ?? analysis?.takeProfit;
                    return (
                      <>
                        {slPrice &&
                          chartGeom.toY(slPrice) >= plotTop &&
                          chartGeom.toY(slPrice) <= plotTop + plotHeight && (
                            <g>
                              <line
                                x1={plotLeft}
                                y1={chartGeom.toY(slPrice)}
                                x2={plotRight}
                                y2={chartGeom.toY(slPrice)}
                                stroke="#fb7185"
                                strokeWidth="1.1"
                                strokeDasharray="2 3"
                              />
                              <text
                                x={72}
                                y={chartGeom.toY(slPrice) - 3}
                                fill="#fda4af"
                                fontSize="9.5"
                                fontFamily="JetBrains Mono, monospace"
                                fontWeight="bold"
                              >
                                SL ${formatPrice(slPrice, meta.decimals)}
                              </text>
                            </g>
                          )}
                        {tpPrice &&
                          chartGeom.toY(tpPrice) >= plotTop &&
                          chartGeom.toY(tpPrice) <= plotTop + plotHeight && (
                            <g>
                              <line
                                x1={plotLeft}
                                y1={chartGeom.toY(tpPrice)}
                                x2={plotRight}
                                y2={chartGeom.toY(tpPrice)}
                                stroke="#34d399"
                                strokeWidth="1.1"
                                strokeDasharray="2 3"
                              />
                              <text
                                x={72}
                                y={chartGeom.toY(tpPrice) - 3}
                                fill="#6ee7b7"
                                fontSize="9.5"
                                fontFamily="JetBrains Mono, monospace"
                                fontWeight="bold"
                              >
                                TP 1:2 ${formatPrice(tpPrice, meta.decimals)}
                              </text>
                            </g>
                          )}
                      </>
                    );
                  })()}

                {/* SEMANTIC RENDER: ZOOMED-IN TRADINGVIEW FOOTPRINT CLUSTERS OR ZOOMED-OUT CANDLESTICKS */}
                {isFootprintMode
                  ? tvFootprintCandles.map((fc, idx) => {
                      const slotW = plotW / Math.max(tvFootprintCandles.length, 1);
                      const slotLeft = plotLeft + idx * slotW;
                      const centerX = slotLeft + slotW / 2;
                      const isBull = fc.close >= fc.open;
                      const bodyColor = isBull ? '#10b981' : '#f43f5e';
                      const yHigh = chartGeom.toY(fc.high);
                      const yLow = chartGeom.toY(fc.low);
                      const yOpen = chartGeom.toY(fc.open);
                      const yClose = chartGeom.toY(fc.close);
                      const bodyTop = Math.min(yOpen, yClose);
                      const bodyH = Math.max(3, Math.abs(yClose - yOpen));
                      const clusterHalfW = Math.min(44, Math.max(24, slotW * 0.45));
                      const rowCount = Math.max(1, fc.levels.length);
                      const maxFitRowH = Math.max(12, Math.floor((plotHeight - 6) / rowCount));
                      const totalSpanPx = Math.max(rowCount * 15, yLow - yHigh);
                      const rowH = Math.min(maxFitRowH, Math.max(13, Math.min(22, totalSpanPx / rowCount)));
                      const blockH = rowH * rowCount;
                      const startY = Math.max(
                        plotTop + 2,
                        Math.min(yHigh, plotTop + plotHeight - blockH - 2),
                      );
                      const maxRowVol = Math.max(
                        ...fc.levels.map((l) => l.totalVol ?? l.bidVol + l.askVol),
                        1,
                      );

                      return (
                        <g key={`${fc.time}-${idx}`}>
                          {/* Subtle Value Area Side Rail */}
                          {showValueArea &&
                            (() => {
                              const yVah = chartGeom.toY(fc.vahPrice ?? fc.pocPrice);
                              const yVal = chartGeom.toY(fc.valPrice ?? fc.pocPrice);
                              const vaTop = Math.min(yVah, yVal);
                              const vaH = Math.max(6, Math.abs(yVal - yVah));
                              return (
                                <line
                                  x1={centerX - clusterHalfW - 2}
                                  y1={vaTop}
                                  x2={centerX - clusterHalfW - 2}
                                  y2={vaTop + vaH}
                                  stroke="rgba(56, 189, 248, 0.5)"
                                  strokeWidth="2"
                                />
                              );
                            })()}

                          {/* 3+ Stacked Imbalance Extended Horizontal S/R Zone */}
                          {showStackedZones &&
                            fc.stackedBuyLevels &&
                            fc.stackedBuyLevels.length >= 3 &&
                            (() => {
                              const zTop = chartGeom.toY(Math.max(...fc.stackedBuyLevels));
                              const zBot = chartGeom.toY(Math.min(...fc.stackedBuyLevels));
                              return (
                                <rect
                                  x={centerX + clusterHalfW}
                                  y={Math.min(zTop, zBot) - 4}
                                  width={Math.max(20, plotRight - (centerX + clusterHalfW))}
                                  height={Math.max(10, Math.abs(zBot - zTop) + 8)}
                                  fill="rgba(16, 185, 129, 0.08)"
                                  stroke="rgba(52, 211, 153, 0.45)"
                                  strokeWidth="0.7"
                                  strokeDasharray="3 2"
                                />
                              );
                            })()}
                          {showStackedZones &&
                            fc.stackedSellLevels &&
                            fc.stackedSellLevels.length >= 3 &&
                            (() => {
                              const zTop = chartGeom.toY(Math.max(...fc.stackedSellLevels));
                              const zBot = chartGeom.toY(Math.min(...fc.stackedSellLevels));
                              return (
                                <rect
                                  x={centerX + clusterHalfW}
                                  y={Math.min(zTop, zBot) - 4}
                                  width={Math.max(20, plotRight - (centerX + clusterHalfW))}
                                  height={Math.max(10, Math.abs(zBot - zTop) + 8)}
                                  fill="rgba(244, 63, 94, 0.08)"
                                  stroke="rgba(251, 113, 133, 0.45)"
                                  strokeWidth="0.7"
                                  strokeDasharray="3 2"
                                />
                              );
                            })()}

                          {/* Center Candle Wick + Colored Body Divider */}
                          <line
                            x1={centerX}
                            y1={yHigh}
                            x2={centerX}
                            y2={yLow}
                            stroke={bodyColor}
                            strokeWidth="1.5"
                            opacity="0.75"
                          />
                          <rect
                            x={centerX - 3}
                            y={bodyTop}
                            width={6}
                            height={bodyH}
                            fill={bodyColor}
                            rx="1"
                            opacity="0.92"
                          />

                          {/* Bid x Ask Level Cells */}
                          {fc.levels.map((lvl, rIdx) => {
                            const rowY = startY + rIdx * rowH;
                            const rowTotal = lvl.totalVol ?? lvl.bidVol + lvl.askVol;
                            const intensity = Math.min(0.45, 0.08 + (rowTotal / maxRowVol) * 0.37);
                            const isBidImb = lvl.imbalance === 'BID';
                            const isAskImb = lvl.imbalance === 'ASK';
                            const cellBg =
                              lvl.askVol >= lvl.bidVol
                                ? `rgba(16, 185, 129, ${intensity.toFixed(2)})`
                                : `rgba(244, 63, 94, ${intensity.toFixed(2)})`;
                            const isUaRow =
                              showUnfinishedAuction &&
                              ((rIdx === 0 && fc.unfinishedAuctionHigh) ||
                                (rIdx === fc.levels.length - 1 && fc.unfinishedAuctionLow));

                            return (
                              <g key={`${lvl.price}-${rIdx}`}>
                                {/* Volume Intensity Shading */}
                                <rect
                                  x={centerX - clusterHalfW}
                                  y={rowY}
                                  width={clusterHalfW * 2}
                                  height={rowH - 1.5}
                                  rx="2"
                                  fill={cellBg}
                                  stroke={
                                    lvl.isPoc && showValueArea
                                      ? '#fbbf24'
                                      : isUaRow
                                        ? '#38bdf8'
                                        : 'rgba(30, 41, 59, 0.45)'
                                  }
                                  strokeWidth={lvl.isPoc && showValueArea ? 1.4 : isUaRow ? 0.9 : 0.4}
                                />

                                {/* Diagonal Bid Imbalance Highlight (Left) */}
                                {isBidImb && (
                                  <rect
                                    x={centerX - clusterHalfW + 1}
                                    y={rowY + 1}
                                    width={clusterHalfW - 4}
                                    height={rowH - 3.5}
                                    rx="1.5"
                                    fill="rgba(244, 63, 94, 0.28)"
                                  />
                                )}

                                {/* Diagonal Ask Imbalance Highlight (Right) */}
                                {isAskImb && (
                                  <rect
                                    x={centerX + 3}
                                    y={rowY + 1}
                                    width={clusterHalfW - 4}
                                    height={rowH - 3.5}
                                    rx="1.5"
                                    fill="rgba(6, 182, 212, 0.26)"
                                  />
                                )}

                                {/* Left Bid Text (Large, Crisp Bold High-Contrast Monospace) */}
                                <text
                                  x={centerX - 6}
                                  y={rowY + rowH * 0.68}
                                  textAnchor="end"
                                  fill={
                                    isBidImb
                                      ? '#fda4af'
                                      : lvl.isPoc
                                        ? '#fef3c7'
                                        : '#cbd5e1'
                                  }
                                  fontSize={slotW >= 80 ? '11.5' : '10.5'}
                                  fontFamily="JetBrains Mono, monospace"
                                  fontWeight={isBidImb || lvl.isPoc ? '800' : '700'}
                                >
                                  {formatCompactVol(lvl.bidVol)}
                                </text>

                                {/* Right Ask Text (Large, Crisp Bold High-Contrast Monospace) */}
                                <text
                                  x={centerX + 6}
                                  y={rowY + rowH * 0.68}
                                  textAnchor="start"
                                  fill={
                                    isAskImb
                                      ? '#67e8f9'
                                      : lvl.isPoc
                                        ? '#fef3c7'
                                        : '#e2e8f0'
                                  }
                                  fontSize={slotW >= 80 ? '11.5' : '10.5'}
                                  fontFamily="JetBrains Mono, monospace"
                                  fontWeight={isAskImb || lvl.isPoc ? '800' : '700'}
                                >
                                  {formatCompactVol(lvl.askVol)}
                                </text>
                              </g>
                            );
                          })}
                        </g>
                      );
                    })
                  : visibleCandles.map((c, idx) => {
                      const slotW = plotW / Math.max(visibleCandles.length, 1);
                      const x = plotLeft + idx * slotW + slotW / 2;
                      const candleW = Math.max(3, slotW * 0.58);
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
                            y={svgHeight - 8 - volH}
                            width={candleW}
                            height={volH}
                            fill={c.delta >= 0 ? 'rgba(0, 240, 255, 0.45)' : 'rgba(244, 63, 94, 0.45)'}
                          />
                        </g>
                      );
                    })}

                {/* Interactive Crosshair Lines */}
                {hoverIdx !== null &&
                  visibleCandles[hoverIdx] &&
                  (() => {
                    const slotW = plotW / Math.max(visibleCandles.length, 1);
                    const cx = plotLeft + hoverIdx * slotW + slotW / 2;
                    const cy = hoverYPrice !== null ? chartGeom.toY(hoverYPrice) : null;
                    return (
                      <g className="pointer-events-none">
                        <line
                          x1={cx}
                          y1={plotTop}
                          x2={cx}
                          y2={plotTop + plotHeight}
                          stroke="rgba(0, 240, 255, 0.45)"
                          strokeDasharray="3 3"
                          strokeWidth="1"
                        />
                        {cy !== null && (
                          <line
                            x1={plotLeft}
                            y1={cy}
                            x2={plotRight}
                            y2={cy}
                            stroke="rgba(0, 240, 255, 0.35)"
                            strokeDasharray="3 3"
                            strokeWidth="1"
                          />
                        )}
                      </g>
                    );
                  })()}

                {/* Live Price Line & Tag */}
                <g>
                  <line
                    x1={plotLeft}
                    y1={chartGeom.toY(currentPrice)}
                    x2={plotRight}
                    y2={chartGeom.toY(currentPrice)}
                    stroke="#00f0ff"
                    strokeWidth="1"
                    opacity="0.65"
                  />
                  <rect
                    x={plotRight + 2}
                    y={chartGeom.toY(currentPrice) - 10}
                    width={72}
                    height={20}
                    rx="4"
                    fill="#00f0ff"
                  />
                  <text
                    x={plotRight + 38}
                    y={chartGeom.toY(currentPrice) + 3.5}
                    textAnchor="middle"
                    fill="#06090f"
                    fontSize="10.5"
                    fontFamily="JetBrains Mono, monospace"
                    fontWeight="800"
                  >
                    {currentPrice > 100 ? currentPrice.toFixed(1) : currentPrice.toFixed(3)}
                  </text>
                </g>
              </svg>

              {/* Column-Aligned Bottom TradingView Footprint Summary Table (1:1 Aligned with SVG Plot Gutters) */}
              {isFootprintMode && tvFootprintCandles.length > 0 && (
                <div
                  data-testid="footprint-summary-table"
                  className="mt-2 rounded-lg border border-cyan-500/25 bg-[#070d18] overflow-hidden"
                >
                  <div className="font-mono text-[10px] sm:text-[11px] tabular-nums">
                    {[
                      {
                        label: 'Time',
                        render: (fc: FootprintCandle) => (
                          <span className="text-slate-400 font-bold">{fc.timeLabel}</span>
                        ),
                      },
                      {
                        label: 'Delta',
                        render: (fc: FootprintCandle) => (
                          <span
                            className={`font-black ${
                              fc.delta >= 0 ? 'text-emerald-300' : 'text-rose-300'
                            }`}
                          >
                            {fc.delta >= 0 ? '+' : ''}
                            {formatCompactVol(fc.delta)}
                          </span>
                        ),
                      },
                      {
                        label: 'Delta %',
                        render: (fc: FootprintCandle) => (
                          <span
                            className={`font-bold ${
                              (fc.deltaPercent ?? 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'
                            }`}
                          >
                            {(fc.deltaPercent ?? 0) >= 0 ? '+' : ''}
                            {(fc.deltaPercent ?? 0).toFixed(1)}%
                          </span>
                        ),
                      },
                      {
                        label: 'Total Vol',
                        render: (fc: FootprintCandle) => (
                          <span className="text-slate-200 font-bold">
                            {formatCompactVol(fc.volume)}
                          </span>
                        ),
                      },
                      {
                        label: 'CVD',
                        render: (fc: FootprintCandle) => (
                          <span
                            className={`font-bold ${
                              fc.cvd >= 0 ? 'text-cyan-300' : 'text-amber-300'
                            }`}
                          >
                            {fc.cvd >= 0 ? '+' : ''}
                            {formatCompactVol(fc.cvd)}
                          </span>
                        ),
                      },
                    ].map((row) => (
                      <div
                        key={row.label}
                        className="flex items-center border-b last:border-b-0 border-slate-800/80"
                      >
                        <div
                          style={{width: `${(plotLeft / svgW) * 100}%`}}
                          className="shrink-0 border-r border-slate-800 bg-[#050811] px-2 py-1 text-[10px] font-bold uppercase text-cyan-300/90 truncate"
                        >
                          {row.label}
                        </div>
                        <div
                          className="grid flex-1"
                          style={{
                            gridTemplateColumns: `repeat(${tvFootprintCandles.length}, minmax(0, 1fr))`,
                          }}
                        >
                          {tvFootprintCandles.map((fc, i) => (
                            <div
                              key={`${row.label}-${fc.time}-${i}`}
                              className={`border-r last:border-r-0 border-slate-800/60 px-1 py-1 text-center truncate ${
                                hoverIdx === i ? 'bg-cyan-500/10' : ''
                              }`}
                            >
                              {row.render(fc)}
                            </div>
                          ))}
                        </div>
                        <div
                          style={{width: `${((svgW - plotRight) / svgW) * 100}%`}}
                          className="shrink-0 bg-[#050811] py-1"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}
              </div>
            </div>
          </div>
        )}

        {subTab === 'footprint' && (
          <div className="space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-cyan-500/20 bg-[#06090e]/90 px-3 py-2 text-xs font-mono">
              <span className="font-bold glow-heading-cyan">
                Bid x Ask Institutional Cluster Matrix (Last 6 Candles &bull; {imbalanceRatioPct}% Imbalance)
              </span>
              <div className="flex flex-wrap items-center gap-3 text-[11px] tabular-nums">
                <span className={footprintTotals.cvd >= 0 ? 'glow-emerald font-bold' : 'glow-rose font-bold'}>
                  CVD: {footprintTotals.cvd >= 0 ? '+' : ''}
                  {formatCompactVol(footprintTotals.cvd)}
                </span>
                <span className="text-emerald-300">Ask Vol: {formatCompactVol(footprintTotals.buyVol)}</span>
                <span className="text-rose-300">Bid Vol: {formatCompactVol(footprintTotals.sellVol)}</span>
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
              {tvFootprintCandles.slice(-6).map((fc) => (
                <div
                  key={fc.index}
                  className="rounded-lg border border-slate-800 bg-[#06090f] p-2 font-mono text-[10px]"
                >
                  <div className="flex items-center justify-between border-b border-slate-800 pb-1 mb-1">
                    <span className="text-slate-400">{fc.timeLabel}</span>
                    <span className={fc.delta >= 0 ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
                      Δ {fc.delta >= 0 ? '+' : ''}
                      {formatCompactVol(fc.delta)}
                    </span>
                  </div>
                  <div className="space-y-0.5">
                    {fc.levels.map((lvl, i) => (
                      <div
                        key={i}
                        className={`flex items-center justify-between rounded px-1 py-0.5 tabular-nums ${
                          lvl.isPoc
                            ? 'bg-amber-500/20 border border-amber-400/60 text-amber-200 font-bold'
                            : ''
                        }`}
                      >
                        <span className={lvl.imbalance === 'BID' ? 'text-rose-400 font-black' : 'text-slate-300'}>
                          {formatCompactVol(lvl.bidVol)}
                        </span>
                        <span className="text-[9px] text-slate-500">
                          {formatPrice(lvl.price, meta.decimals)}
                        </span>
                        <span className={lvl.imbalance === 'ASK' ? 'text-cyan-300 font-black' : 'text-slate-200'}>
                          {formatCompactVol(lvl.askVol)}
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

      {/* Risk & Manual Sniper Execution Footer Strip (Strictly Gatekept) */}
      <div className="border-t border-[var(--ex-border)] bg-[var(--ex-surface-inset)] px-3 py-3 sm:px-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3 text-xs font-mono">
            <label className="flex items-center gap-1.5 text-[var(--ex-muted)]">
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
                className="w-16 rounded border border-[var(--ex-border)] bg-[var(--ex-surface)] px-2 py-1 text-xs text-[var(--ex-accent)] font-bold ex-focus-ring"
              />
            </label>

            <label className="flex items-center gap-1.5 text-[var(--ex-muted)]">
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
                className="w-18 rounded border border-[var(--ex-border)] bg-[var(--ex-surface)] px-2 py-1 text-xs text-[var(--ex-short)] font-bold ex-focus-ring"
              />
            </label>

            <label className="flex items-center gap-1.5 text-[var(--ex-muted)]">
              <span>Lev</span>
              <select
                value={settings.leverage}
                onChange={(e) => onUpdateSettings({leverage: Number(e.target.value)})}
                className="rounded border border-[var(--ex-border)] bg-[var(--ex-surface)] px-2 py-1 text-xs text-[var(--ex-accent)] font-bold ex-focus-ring"
              >
                {[5, 10, 20, 25, 50].map((lev) => (
                  <option key={lev} value={lev}>
                    {lev}x
                  </option>
                ))}
              </select>
            </label>

            <label className="flex items-center gap-1.5 text-[var(--ex-muted)]">
              <span>Dir</span>
              <select
                value={settings.directionPreference}
                onChange={(e) =>
                  onUpdateSettings({
                    directionPreference: e.target.value as DirectionPreference,
                  })
                }
                className="rounded border border-[var(--ex-border)] bg-[var(--ex-surface)] px-2 py-1 text-xs text-[var(--ex-text)] font-bold ex-focus-ring"
              >
                <option value="BOTH">LONG + SHORT</option>
                <option value="LONG">LONG ONLY</option>
                <option value="SHORT">SHORT ONLY</option>
              </select>
            </label>

            <span className="text-[11px] text-[var(--ex-long)] font-bold tabular-nums">
              1:2 R:R Target &middot; Risk ${sizing.riskUsd} &rarr; +${sizing.rewardUsd}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2 font-mono">
            <button
              type="button"
              disabled={!canTradeManual}
              title={
                canTradeManual
                  ? 'Execute Manual Long Snipe'
                  : 'Disabled until exchange API key & positive wallet balance are available'
              }
              onClick={() => {
                setExecSide('LONG');
                onExecuteManualTrade('LONG');
              }}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-black whitespace-nowrap transition ${
                canTradeManual
                  ? 'border-[rgba(var(--ex-long-rgb),0.6)] bg-[rgba(var(--ex-long-rgb),0.15)] text-[var(--ex-long)] hover:bg-[rgba(var(--ex-long-rgb),0.25)] cursor-pointer'
                  : 'border-[var(--ex-border)] bg-[var(--ex-surface)] text-[var(--ex-muted)] cursor-not-allowed opacity-55'
              }`}
            >
              <TrendingUp className="h-3.5 w-3.5" aria-hidden="true" />
              <span>SNIPE LONG</span>
            </button>
            <button
              type="button"
              disabled={!canTradeManual}
              title={
                canTradeManual
                  ? 'Execute Manual Short Snipe'
                  : 'Disabled until exchange API key & positive wallet balance are available'
              }
              onClick={() => {
                setExecSide('SHORT');
                onExecuteManualTrade('SHORT');
              }}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-black whitespace-nowrap transition ${
                canTradeManual
                  ? 'border-[rgba(var(--ex-short-rgb),0.6)] bg-[rgba(var(--ex-short-rgb),0.15)] text-[var(--ex-short)] hover:bg-[rgba(var(--ex-short-rgb),0.25)] cursor-pointer'
                  : 'border-[var(--ex-border)] bg-[var(--ex-surface)] text-[var(--ex-muted)] cursor-not-allowed opacity-55'
              }`}
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
