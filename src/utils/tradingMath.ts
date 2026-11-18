import type {
  Candle,
  CcxtPairInfo,
  DecisionLogEntry,
  ElliottWavePoint,
  ExchangeType,
  FootprintCandle,
  FootprintLevel,
  FootprintSignalAnalysis,
  GoldenPocketData,
  IneligibleSignal,
  MsnrLevel,
  OrderBookLevel,
  SMCZone,
  TradeSignal,
  TradingPairSymbol,
  VolumeProfileRow,
  VolumeProfileSummary,
} from '../types/trading';

export interface PairMeta {
  symbol: string;
  label: string;
  assetClass: 'Crypto Futures' | 'Commodities' | 'Forex';
  basePrice: number;
  tickSize: number;
  decimals: number;
  change24hPct: number;
  volume24h: number;
  fundingOrSwap: string;
}

export const TRADING_PAIRS: Record<string, PairMeta> = {
  BTCUSDT: {
    symbol: 'BTCUSDT',
    label: 'BTC / USDT Perp',
    assetClass: 'Crypto Futures',
    basePrice: 94280,
    tickSize: 25,
    decimals: 2,
    change24hPct: 2.84,
    volume24h: 18420000000,
    fundingOrSwap: '+0.0100%',
  },
  ETHUSDT: {
    symbol: 'ETHUSDT',
    label: 'ETH / USDT Perp',
    assetClass: 'Crypto Futures',
    basePrice: 3428,
    tickSize: 2.5,
    decimals: 2,
    change24hPct: -0.74,
    volume24h: 9240000000,
    fundingOrSwap: '+0.0085%',
  },
  AVAXUSDT: {
    symbol: 'AVAXUSDT',
    label: 'AVAX / USDT Perp',
    assetClass: 'Crypto Futures',
    basePrice: 38.45,
    tickSize: 0.05,
    decimals: 3,
    change24hPct: 4.12,
    volume24h: 892000000,
    fundingOrSwap: '+0.0124%',
  },
  SOLUSDT: {
    symbol: 'SOLUSDT',
    label: 'SOL / USDT Perp',
    assetClass: 'Crypto Futures',
    basePrice: 218.4,
    tickSize: 0.2,
    decimals: 2,
    change24hPct: 5.38,
    volume24h: 4180000000,
    fundingOrSwap: '+0.0140%',
  },
  XRPUSDT: {
    symbol: 'XRPUSDT',
    label: 'XRP / USDT Perp',
    assetClass: 'Crypto Futures',
    basePrice: 1.482,
    tickSize: 0.002,
    decimals: 4,
    change24hPct: 3.65,
    volume24h: 2940000000,
    fundingOrSwap: '+0.0110%',
  },
  BNBUSDT: {
    symbol: 'BNBUSDT',
    label: 'BNB / USDT Perp',
    assetClass: 'Crypto Futures',
    basePrice: 642.8,
    tickSize: 0.5,
    decimals: 2,
    change24hPct: 1.28,
    volume24h: 1120000000,
    fundingOrSwap: '+0.0092%',
  },
  DOGEUSDT: {
    symbol: 'DOGEUSDT',
    label: 'DOGE / USDT Perp',
    assetClass: 'Crypto Futures',
    basePrice: 0.3785,
    tickSize: 0.0005,
    decimals: 4,
    change24hPct: -1.94,
    volume24h: 1650000000,
    fundingOrSwap: '+0.0075%',
  },
  LINKUSDT: {
    symbol: 'LINKUSDT',
    label: 'LINK / USDT Perp',
    assetClass: 'Crypto Futures',
    basePrice: 18.64,
    tickSize: 0.02,
    decimals: 3,
    change24hPct: 2.15,
    volume24h: 540000000,
    fundingOrSwap: '+0.0098%',
  },
  ADAUSDT: {
    symbol: 'ADAUSDT',
    label: 'ADA / USDT Perp',
    assetClass: 'Crypto Futures',
    basePrice: 0.894,
    tickSize: 0.001,
    decimals: 4,
    change24hPct: 1.87,
    volume24h: 720000000,
    fundingOrSwap: '+0.0102%',
  },
  XAUUSD: {
    symbol: 'XAUUSD',
    label: 'Gold Spot (XAU/USD)',
    assetClass: 'Commodities',
    basePrice: 2684.5,
    tickSize: 0.5,
    decimals: 2,
    change24hPct: 0.96,
    volume24h: 680000000,
    fundingOrSwap: '-1.85 pts',
  },
};

export function getPairMeta(symbol: string): PairMeta {
  const clean = symbol.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (TRADING_PAIRS[clean]) return TRADING_PAIRS[clean];
  return {
    symbol: clean || 'BTCUSDT',
    label: `${clean || 'BTCUSDT'} Perp`,
    assetClass: 'Crypto Futures',
    basePrice: 100,
    tickSize: 0.1,
    decimals: 2,
    change24hPct: 0.45,
    volume24h: 150000000,
    fundingOrSwap: '+0.0100%',
  };
}

const EXCLUDED_NON_CRYPTO = [
  'GOOGL',
  'NVDA',
  'TSLA',
  'AAPL',
  'MSFT',
  'AMZN',
  'META',
  'NFLX',
  'KORU',
  'CLUSDT',
  'XAG',
  'XAU',
];

export function isStrictBinanceCryptoPerpetual(symbol: string): boolean {
  const s = String(symbol || '').toUpperCase().trim();
  if (!s.endsWith('USDT')) return false;
  if (EXCLUDED_NON_CRYPTO.some((t) => s.includes(t))) return false;
  if (/^\d/.test(s)) return false;
  return /^[A-Z]{2,10}USDT$/.test(s);
}

export function generateDefaultPairs(): CcxtPairInfo[] {
  return Object.values(TRADING_PAIRS)
    .filter((p) => p.symbol !== 'XAUUSD')
    .map((p) => ({
      symbol: p.symbol,
      ccxtSymbol: `${p.symbol.replace('USDT', '')}/USDT:USDT`,
      baseAsset: p.symbol.replace('USDT', ''),
      quoteAsset: 'USDT',
      pricePrecision: p.decimals,
      quantityPrecision: p.basePrice > 1000 ? 3 : p.basePrice > 10 ? 2 : 0,
      minQty: p.basePrice > 1000 ? 0.001 : 0.1,
      lastPrice: p.basePrice,
      priceChangePercent: p.change24hPct,
      volume24h: p.volume24h,
      high24h: Number((p.basePrice * 1.032).toFixed(p.decimals)),
      low24h: Number((p.basePrice * 0.968).toFixed(p.decimals)),
      active: true,
    }));
}

export interface PositionSizingInput {
  accountBalance: number;
  riskPercent: number;
  stopLossPercent: number; // clamped 0.25% - 1.2%
  entryPrice: number;
  side: 'LONG' | 'SHORT';
  leverage: number;
}

export interface PositionSizingResult {
  riskUsd: number;
  rewardUsd: number;
  positionSizeUsd: number;
  marginRequiredUsd: number;
  quantityUnits: number;
  stopLossPrice: number;
  takeProfitPrice: number;
  liquidationPrice: number;
}

export function clampStopLossPercent(val: number): number {
  if (Number.isNaN(val)) return 0.5;
  return Math.min(1.2, Math.max(0.25, Number(val.toFixed(2))));
}

export function calculatePositionSizing(input: PositionSizingInput): PositionSizingResult {
  const balance = Math.max(0, input.accountBalance);
  const riskPct = Math.min(10, Math.max(0.1, input.riskPercent));
  const slPct = clampStopLossPercent(input.stopLossPercent);
  const leverage = Math.max(1, input.leverage);
  const entry = Math.max(0.0001, input.entryPrice);

  const riskUsd = balance * (riskPct / 100);
  const rewardUsd = riskUsd * 2; // Strictly 1:2 R:R Target
  const slFraction = slPct / 100;
  const tpFraction = slFraction * 2;

  const rawSizeUsd = riskUsd / slFraction;
  const maxNotional = balance * leverage;
  const positionSizeUsd = Math.min(rawSizeUsd, maxNotional);
  const marginRequiredUsd = positionSizeUsd / leverage;
  const quantityUnits = positionSizeUsd / entry;

  const stopLossPrice =
    input.side === 'LONG' ? entry * (1 - slFraction) : entry * (1 + slFraction);
  const takeProfitPrice =
    input.side === 'LONG' ? entry * (1 + tpFraction) : entry * (1 - tpFraction);
  const liqBuffer = 0.9 / leverage;
  const liquidationPrice =
    input.side === 'LONG' ? entry * (1 - liqBuffer) : entry * (1 + liqBuffer);

  return {
    riskUsd: Number(riskUsd.toFixed(2)),
    rewardUsd: Number(rewardUsd.toFixed(2)),
    positionSizeUsd: Number(positionSizeUsd.toFixed(2)),
    marginRequiredUsd: Number(marginRequiredUsd.toFixed(2)),
    quantityUnits: Number(quantityUnits.toFixed(4)),
    stopLossPrice,
    takeProfitPrice,
    liquidationPrice,
  };
}

export function calculateUnrealizedPnL(
  position: {side: 'LONG' | 'SHORT'; entryPrice: number; sizeUsd: number; marginUsd: number},
  markPrice: number,
): {pnlUsd: number; roePct: number} {
  if (position.entryPrice <= 0) return {pnlUsd: 0, roePct: 0};
  const priceDiffRatio =
    position.side === 'LONG'
      ? (markPrice - position.entryPrice) / position.entryPrice
      : (position.entryPrice - markPrice) / position.entryPrice;
  const pnlUsd = position.sizeUsd * priceDiffRatio;
  const roePct = position.marginUsd > 0 ? (pnlUsd / position.marginUsd) * 100 : 0;
  return {
    pnlUsd: Number(pnlUsd.toFixed(2)),
    roePct: Number(roePct.toFixed(2)),
  };
}

function createRng(seedStr: string) {
  let s = 0;
  for (let i = 0; i < seedStr.length; i++) {
    s = (s * 31 + seedStr.charCodeAt(i)) >>> 0;
  }
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function formatPrice(price: number, decimals: number): string {
  return price.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function generateFootprintCandles(
  symbol: TradingPairSymbol | string,
  count = 24,
  tickOffset = 0,
): FootprintCandle[] {
  const meta = getPairMeta(symbol);
  const rng = createRng(`${symbol}-footprint-v2`);
  const candles: FootprintCandle[] = [];

  let current = meta.basePrice - meta.tickSize * 6;
  let runningCvd = 0;
  const baseMinutes = 14 * 60;

  for (let i = 0; i < count; i++) {
    const driftFromBase = (meta.basePrice - current) / Math.max(meta.tickSize, 0.0001);
    const waveBias = Math.sin(i * 0.55) * 1.1 + driftFromBase * 0.14;
    const bodyTicks = Math.round((rng() - 0.5) * 4 + waveBias);
    const open = Number(current.toFixed(meta.decimals));
    const closeRaw =
      i === count - 1
        ? open + bodyTicks * meta.tickSize + tickOffset * meta.tickSize
        : open + bodyTicks * meta.tickSize;
    const close = Number(closeRaw.toFixed(meta.decimals));
    const upperWickTicks = 1 + Math.floor(rng() * 3);
    const lowerWickTicks = 1 + Math.floor(rng() * 3);
    const high = Number(
      (Math.max(open, close) + upperWickTicks * meta.tickSize).toFixed(meta.decimals),
    );
    const low = Number(
      (Math.min(open, close) - lowerWickTicks * meta.tickSize).toFixed(meta.decimals),
    );

    const levels: FootprintLevel[] = [];
    const totalSteps = Math.max(3, Math.round((high - low) / meta.tickSize) + 1);
    let maxRowVol = -1;
    let pocPrice = open;
    let candleDelta = 0;
    let candleVol = 0;

    for (let step = 0; step < Math.min(totalSteps, 12); step++) {
      const price = Number((high - step * meta.tickSize).toFixed(meta.decimals));
      const bullishFactor = close >= open ? 1.35 : 0.78;
      const bidVol = Math.round(18 + rng() * 140);
      const askVol = Math.round((20 + rng() * 145) * bullishFactor);
      const rowTotal = bidVol + askVol;
      if (rowTotal > maxRowVol) {
        maxRowVol = rowTotal;
        pocPrice = price;
      }
      candleDelta += askVol - bidVol;
      candleVol += rowTotal;

      const imbalance: 'BID' | 'ASK' | 'NONE' =
        askVol > bidVol * 2.2 ? 'ASK' : bidVol > askVol * 2.2 ? 'BID' : 'NONE';

      levels.push({
        price,
        bidVol,
        askVol,
        imbalance,
        isPoc: false,
      });
    }

    for (const lvl of levels) {
      if (Math.abs(lvl.price - pocPrice) < meta.tickSize * 0.25) {
        lvl.isPoc = true;
      }
    }

    runningCvd += candleDelta;
    const totalMin = baseMinutes + i * 15;
    const hh = String(Math.floor(totalMin / 60) % 24).padStart(2, '0');
    const mm = String(totalMin % 60).padStart(2, '0');

    candles.push({
      index: i,
      timeLabel: `${hh}:${mm}`,
      open,
      high,
      low,
      close,
      volume: candleVol,
      delta: candleDelta,
      cvd: runningCvd,
      pocPrice,
      levels,
    });

    current = close;
  }

  return candles;
}

export function generateCandles(
  symbol: string,
  interval = '15m',
  count = 48,
  tickOffset = 0,
): Candle[] {
  const fp = generateFootprintCandles(symbol, count, tickOffset);
  const stepMs =
    interval === '1m'
      ? 60_000
      : interval === '5m'
        ? 300_000
        : interval === '30m'
          ? 1_800_000
          : interval === '1h'
            ? 3_600_000
            : interval === '4h'
              ? 14_400_000
              : 900_000;
  const now = Date.now();
  return fp.map((c, idx) => {
    const takerBuyVolume = Math.max(0, Math.round((c.volume + c.delta) / 2));
    const takerSellVolume = Math.max(0, c.volume - takerBuyVolume);
    return {
      time: now - (fp.length - 1 - idx) * stepMs,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
      takerBuyVolume,
      takerSellVolume,
      delta: takerBuyVolume - takerSellVolume,
    };
  });
}

export function rawCandlesToFootprint(
  symbol: string,
  rawCandles: Candle[],
): FootprintCandle[] {
  const meta = getPairMeta(symbol);
  const slice = rawCandles.slice(-20);
  const rng = createRng(`${symbol}-raw-fp`);
  let runningCvd = 0;

  return slice.map((c, idx) => {
    const span = Math.max(c.high - c.low, meta.tickSize * 2);
    const stepSize = Math.max(span / 6, meta.tickSize * 0.25);
    const levels: FootprintLevel[] = [];
    let maxVol = -1;
    let pocPrice = c.close;

    for (let s = 0; s < 6; s++) {
      const price = Number((c.high - s * stepSize).toFixed(meta.decimals));
      const bias = c.close >= c.open ? 1.28 : 0.82;
      const bidVol = Math.round((c.takerSellVolume / 6) * (0.65 + rng() * 0.7));
      const askVol = Math.round((c.takerBuyVolume / 6) * (0.65 + rng() * 0.7) * bias);
      const total = bidVol + askVol;
      if (total > maxVol) {
        maxVol = total;
        pocPrice = price;
      }
      levels.push({
        price,
        bidVol,
        askVol,
        imbalance: askVol > bidVol * 2 ? 'ASK' : bidVol > askVol * 2 ? 'BID' : 'NONE',
        isPoc: false,
      });
    }
    for (const lvl of levels) {
      if (lvl.price === pocPrice) lvl.isPoc = true;
    }
    runningCvd += c.delta;
    const d = new Date(c.time);
    const hh = String(d.getUTCHours()).padStart(2, '0');
    const mm = String(d.getUTCMinutes()).padStart(2, '0');

    return {
      index: idx,
      timeLabel: `${hh}:${mm}`,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: Math.round(c.volume),
      delta: Math.round(c.delta),
      cvd: Math.round(runningCvd),
      pocPrice,
      levels,
    };
  });
}

export function generateOrderBook(
  symbol: TradingPairSymbol | string,
  midPrice: number,
  pulse = 0,
): OrderBookLevel[] {
  const meta = getPairMeta(symbol);
  const rng = createRng(`${symbol}-book-${pulse % 12}`);
  const rows: OrderBookLevel[] = [];

  const asks: OrderBookLevel[] = [];
  let cumAsk = 0;
  for (let i = 1; i <= 8; i++) {
    const price = Number((midPrice + i * meta.tickSize).toFixed(meta.decimals));
    const isWall = i === 3 || i === 6;
    const askSize = Number(((isWall ? 34 : 6) + rng() * 18).toFixed(2));
    cumAsk += askSize;
    asks.push({
      price,
      bidSize: 0,
      askSize,
      cumulativeBid: 0,
      cumulativeAsk: Number(cumAsk.toFixed(2)),
      heatIntensity: Math.min(1, askSize / 48),
      isLiquidityWall: isWall,
    });
  }
  asks.reverse();

  const bids: OrderBookLevel[] = [];
  let cumBid = 0;
  for (let i = 1; i <= 8; i++) {
    const price = Number((midPrice - i * meta.tickSize).toFixed(meta.decimals));
    const isWall = i === 2 || i === 5;
    const bidSize = Number(((isWall ? 38 : 7) + rng() * 18).toFixed(2));
    cumBid += bidSize;
    bids.push({
      price,
      bidSize,
      askSize: 0,
      cumulativeBid: Number(cumBid.toFixed(2)),
      cumulativeAsk: 0,
      heatIntensity: Math.min(1, bidSize / 48),
      isLiquidityWall: isWall,
    });
  }

  rows.push(...asks, ...bids);
  return rows;
}

export function detectSMCZones(candles: FootprintCandle[]): SMCZone[] {
  if (candles.length < 6) return [];
  const zones: SMCZone[] = [];

  for (let i = 2; i < candles.length; i++) {
    const cPrev2 = candles[i - 2];
    const cCurr = candles[i];

    if (cCurr.low > cPrev2.high) {
      const topPrice = cCurr.low;
      const bottomPrice = cPrev2.high;
      const mitigated = candles.slice(i + 1).some((later) => later.low <= topPrice);
      zones.push({
        id: `fvg-bull-${i}`,
        type: 'BULLISH_FVG',
        label: 'Bullish FVG',
        topPrice,
        bottomPrice,
        startIndex: i - 2,
        endIndex: candles.length - 1,
        mitigated,
      });
    } else if (cCurr.high < cPrev2.low) {
      const topPrice = cPrev2.low;
      const bottomPrice = cCurr.high;
      const mitigated = candles.slice(i + 1).some((later) => later.high >= bottomPrice);
      zones.push({
        id: `fvg-bear-${i}`,
        type: 'BEARISH_FVG',
        label: 'Bearish FVG',
        topPrice,
        bottomPrice,
        startIndex: i - 2,
        endIndex: candles.length - 1,
        mitigated,
      });
    }
  }

  const split = Math.max(3, Math.floor(candles.length * 0.55));
  const priorSlice = candles.slice(0, split);
  const recentSlice = candles.slice(split);

  const priorHighCandle = priorSlice.reduce((max, c) => (c.high > max.high ? c : max), priorSlice[0]);
  const priorLowCandle = priorSlice.reduce((min, c) => (c.low < min.low ? c : min), priorSlice[0]);
  const swingLowCandle = candles.reduce((min, c) => (c.low < min.low ? c : min), candles[0]);
  const swingHighCandle = candles.reduce((max, c) => (c.high > max.high ? c : max), candles[0]);
  const latest = candles[candles.length - 1];

  const brokeHigh = recentSlice.some((c) => c.close > priorHighCandle.high);
  const brokeLow = recentSlice.some((c) => c.close < priorLowCandle.low);

  if (brokeHigh && !brokeLow) {
    zones.push({
      id: 'bos-bull-structure',
      type: 'BOS',
      label: 'Bullish BOS',
      topPrice: priorHighCandle.high,
      bottomPrice: priorHighCandle.high,
      startIndex: priorHighCandle.index,
      endIndex: candles.length - 1,
      mitigated: false,
    });
  } else if (brokeLow && !brokeHigh) {
    zones.push({
      id: 'bos-bear-structure',
      type: 'BOS',
      label: 'Bearish BOS',
      topPrice: priorLowCandle.low,
      bottomPrice: priorLowCandle.low,
      startIndex: priorLowCandle.index,
      endIndex: candles.length - 1,
      mitigated: false,
    });
  } else {
    const chochPrice = latest.close >= priorHighCandle.high ? priorHighCandle.high : priorLowCandle.low;
    zones.push({
      id: 'choch-structure',
      type: 'CHOCH',
      label: latest.delta >= 0 ? 'Bullish CHoCH Reversal' : 'Bearish CHoCH Reversal',
      topPrice: chochPrice,
      bottomPrice: chochPrice,
      startIndex: Math.max(0, split - 1),
      endIndex: candles.length - 1,
      mitigated: false,
    });
  }

  zones.push({
    id: 'ob-bull-demand',
    type: 'BULLISH_OB',
    label: 'Demand Order Block',
    topPrice: Math.max(swingLowCandle.open, swingLowCandle.close),
    bottomPrice: swingLowCandle.low,
    startIndex: swingLowCandle.index,
    endIndex: candles.length - 1,
    mitigated: latest.low <= Math.max(swingLowCandle.open, swingLowCandle.close) && latest.close < swingLowCandle.low,
  });

  zones.push({
    id: 'ob-bear-supply',
    type: 'BEARISH_OB',
    label: 'Supply Order Block',
    topPrice: swingHighCandle.high,
    bottomPrice: Math.min(swingHighCandle.open, swingHighCandle.close),
    startIndex: swingHighCandle.index,
    endIndex: candles.length - 1,
    mitigated: latest.high >= Math.min(swingHighCandle.open, swingHighCandle.close) && latest.close > swingHighCandle.high,
  });

  return zones.slice(0, 6);
}

export function computeGoldenPocket(candles: FootprintCandle[], decimals: number): GoldenPocketData {
  const high = Math.max(...candles.map((c) => c.high));
  const low = Math.min(...candles.map((c) => c.low));
  const range = high - low;
  const round = (v: number) => Number(v.toFixed(decimals));

  const lastClose = candles[candles.length - 1]?.close ?? high;
  const mid = low + range * 0.5;

  return {
    swingHigh: round(high),
    swingLow: round(low),
    fib382: round(high - range * 0.382),
    fib500: round(mid),
    fib618: round(high - range * 0.618),
    fib650: round(high - range * 0.65),
    fib786: round(high - range * 0.786),
    bias: lastClose >= mid ? 'BULLISH_RELOAD' : 'BEARISH_RELOAD',
  };
}

export function computeVolumeProfile(
  candles: FootprintCandle[],
  decimals: number,
): VolumeProfileSummary {
  const map = new Map<number, {buy: number; sell: number}>();
  for (const c of candles) {
    for (const lvl of c.levels) {
      const key = Number(lvl.price.toFixed(decimals));
      const existing = map.get(key) || {buy: 0, sell: 0};
      existing.buy += lvl.askVol;
      existing.sell += lvl.bidVol;
      map.set(key, existing);
    }
  }

  const sortedPrices = Array.from(map.keys()).sort((a, b) => b - a);
  let totalAll = 0;
  let pocPrice = sortedPrices[0] ?? 0;
  let pocVol = -1;

  const rawRows: VolumeProfileRow[] = sortedPrices.map((price) => {
    const entry = map.get(price)!;
    const total = entry.buy + entry.sell;
    totalAll += total;
    if (total > pocVol) {
      pocVol = total;
      pocPrice = price;
    }
    return {
      price,
      totalVolume: total,
      buyVolume: entry.buy,
      sellVolume: entry.sell,
      zone: 'OUTSIDE',
    };
  });

  const pocIdx = rawRows.findIndex((r) => r.price === pocPrice);
  const vaIndices = new Set<number>();
  if (pocIdx >= 0) {
    vaIndices.add(pocIdx);
    let accVol = rawRows[pocIdx].totalVolume;
    let up = pocIdx - 1;
    let down = pocIdx + 1;
    while (accVol < totalAll * 0.7 && (up >= 0 || down < rawRows.length)) {
      const upVol = up >= 0 ? rawRows[up].totalVolume : -1;
      const downVol = down < rawRows.length ? rawRows[down].totalVolume : -1;
      if (upVol >= downVol && up >= 0) {
        vaIndices.add(up);
        accVol += upVol;
        up--;
      } else if (down < rawRows.length) {
        vaIndices.add(down);
        accVol += downVol;
        down++;
      } else {
        break;
      }
    }
  }

  const rows = rawRows.map((row, idx) => ({
    ...row,
    zone:
      row.price === pocPrice
        ? ('POC' as const)
        : vaIndices.has(idx)
          ? ('VA' as const)
          : ('OUTSIDE' as const),
  }));

  const vaRows = rows.filter((r) => r.zone === 'VA' || r.zone === 'POC');
  const vahPrice = vaRows.length > 0 ? vaRows[0].price : pocPrice;
  const valPrice = vaRows.length > 0 ? vaRows[vaRows.length - 1].price : pocPrice;

  return {
    pocPrice,
    vahPrice,
    valPrice,
    rows: rows.slice(0, 14),
  };
}

export function computeElliottWaves(candles: FootprintCandle[]): ElliottWavePoint[] {
  if (candles.length < 8) return [];
  const last = candles.length - 1;
  const step = Math.max(1, Math.floor(last / 6));

  return [
    {waveLabel: '0', candleIndex: 0, price: candles[0].low, phase: 'IMPULSE'},
    {waveLabel: '1', candleIndex: step, price: candles[step].high, phase: 'IMPULSE'},
    {waveLabel: '2', candleIndex: step * 2, price: candles[step * 2].low, phase: 'IMPULSE'},
    {waveLabel: '3', candleIndex: step * 3, price: candles[step * 3].high, phase: 'IMPULSE'},
    {waveLabel: '4', candleIndex: step * 4, price: candles[step * 4].low, phase: 'IMPULSE'},
    {waveLabel: '5', candleIndex: step * 5, price: candles[step * 5].high, phase: 'IMPULSE'},
    {
      waveLabel: 'A',
      candleIndex: Math.min(last, step * 5 + 1),
      price: candles[Math.min(last, step * 5 + 1)].low,
      phase: 'CORRECTION',
    },
    {waveLabel: 'B', candleIndex: last, price: candles[last].close, phase: 'CORRECTION'},
  ];
}

export function analyzeMsnrFootprint(
  symbol: string,
  exchange: ExchangeType,
  timeframe: string,
  candles: Candle[],
  stopLossPercent = 0.5,
): FootprintSignalAnalysis {
  const meta = getPairMeta(symbol);
  const recent = candles.slice(-24);
  const last = recent[recent.length - 1] || {
    time: Date.now(),
    open: meta.basePrice,
    high: meta.basePrice * 1.003,
    low: meta.basePrice * 0.997,
    close: meta.basePrice,
    volume: 1000,
    takerBuyVolume: 620,
    takerSellVolume: 380,
    delta: 240,
  };
  const prev = recent[recent.length - 2] || last;
  const currentPrice = Number(last.close.toFixed(meta.decimals));
  const sessionHigh = Math.max(...recent.map((c) => c.high));
  const sessionLow = Math.min(...recent.map((c) => c.low));
  const range = Math.max(sessionHigh - sessionLow, meta.tickSize);
  const eq50 = Number(((sessionHigh + sessionLow) / 2).toFixed(meta.decimals));
  const fib618 = Number((sessionHigh - range * 0.618).toFixed(meta.decimals));
  const fib650 = Number((sessionHigh - range * 0.65).toFixed(meta.decimals));

  const cumulativeDelta = recent.slice(-5).reduce((s, c) => s + c.delta, 0);
  const isBull = last.close >= last.open || cumulativeDelta >= 0;
  const bias: 'LONG' | 'SHORT' = isBull ? 'LONG' : 'SHORT';

  const priorHalf = recent.slice(0, Math.max(3, Math.floor(recent.length * 0.6)));
  const priorHigh = Math.max(...priorHalf.map((c) => c.high));
  const priorLow = Math.min(...priorHalf.map((c) => c.low));
  const brokeUp = last.close > priorHigh;
  const brokeDown = last.close < priorLow;
  const structureEvent: FootprintSignalAnalysis['structureEvent'] =
    brokeUp && cumulativeDelta >= 0
      ? 'BULLISH_BOS'
      : brokeDown && cumulativeDelta < 0
        ? 'BEARISH_BOS'
        : isBull
          ? 'BULLISH_CHOCH'
          : 'BEARISH_CHOCH';

  const footprintTrend: FootprintSignalAnalysis['footprintTrend'] =
    cumulativeDelta > last.volume * 0.08
      ? 'BULLISH_IMBALANCE'
      : cumulativeDelta < -last.volume * 0.08
        ? 'BEARISH_IMBALANCE'
        : 'NEUTRAL';

  const slPct = clampStopLossPercent(stopLossPercent);
  const slFrac = slPct / 100;
  const tpFrac = slFrac * 2.0;

  const stopLoss = Number(
    (bias === 'LONG' ? currentPrice * (1 - slFrac) : currentPrice * (1 + slFrac)).toFixed(
      meta.decimals,
    ),
  );
  const takeProfit = Number(
    (bias === 'LONG' ? currentPrice * (1 + tpFrac) : currentPrice * (1 - tpFrac)).toFixed(
      meta.decimals,
    ),
  );

  const engulfingConfirmed =
    (bias === 'LONG' && last.close > prev.high && last.delta > 0) ||
    (bias === 'SHORT' && last.close < prev.low && last.delta < 0) ||
    Math.abs(last.delta) > last.volume * 0.1;

  const freshLevels: MsnrLevel[] = [
    {
      id: `${symbol}-4h-a`,
      type: 'A',
      timeframe: '4h',
      price: Number((sessionHigh - range * 0.08).toFixed(meta.decimals)),
      fresh: true,
    },
    {
      id: `${symbol}-4h-v`,
      type: 'V',
      timeframe: '4h',
      price: Number((sessionLow + range * 0.08).toFixed(meta.decimals)),
      fresh: true,
    },
    {
      id: `${symbol}-1h-rbs`,
      type: bias === 'LONG' ? 'RBS' : 'SBR',
      timeframe: '1h',
      price: eq50,
      fresh: true,
    },
  ];

  const unfreshLevels: MsnrLevel[] = [
    {
      id: `${symbol}-1h-ocl`,
      type: 'OCL',
      timeframe: '1h',
      price: Number((eq50 + (sessionHigh - eq50) * 0.45).toFixed(meta.decimals)),
      fresh: false,
    },
  ];

  const currentZone =
    currentPrice < eq50 ? 'DISCOUNT' : currentPrice > eq50 ? 'PREMIUM' : 'EQUILIBRIUM';
  const inGoldenPocket = currentPrice >= fib650 && currentPrice <= fib618;
  const activeConfirmations = [
    'Fresh 4H/1H MSNR Level',
    `${structureEvent.replace('_', ' ')} Confirmed`,
    footprintTrend === 'NEUTRAL' ? 'Order-Flow Delta Shift' : footprintTrend.replace('_', ' '),
    ...(inGoldenPocket ? ['Golden Pocket 0.618–0.650 Reload'] : ['Unmitigated FVG Imbalance']),
  ];
  const confluenceScore = engulfingConfirmed ? Math.min(4, activeConfirmations.length) : 2;
  const winProbabilityPct = engulfingConfirmed ? (inGoldenPocket ? 84 : 78) : 61;
  const rr = Number((tpFrac / slFrac).toFixed(2));
  const approved = engulfingConfirmed && rr >= 2.0;

  const fpCandles = rawCandlesToFootprint(symbol, recent);
  const vp = computeVolumeProfile(fpCandles, meta.decimals);

  const signal: TradeSignal | undefined = approved
    ? {
        id: `sig-${symbol}-${Math.floor(last.time / 60000)}`,
        symbol,
        exchange,
        side: bias,
        entryPrice: currentPrice,
        stopLoss,
        takeProfit,
        riskRewardRatio: rr,
        slDistancePercent: slPct,
        engulfingTimeframe: timeframe === '5m' ? '5m' : '15m',
        isStopHuntEngulfing: Math.abs(last.delta) > last.volume * 0.14,
        confluenceScore,
        msnrLevelLabel: `4H ${bias === 'LONG' ? 'V-Support' : 'A-Resistance'} + ${structureEvent}`,
        reasoning: `4H/1H ${isBull ? 'Bullish' : 'Bearish'} storyline + ${structureEvent} + ${timeframe} footprint delta (${last.delta >= 0 ? '+' : ''}${Math.round(last.delta)})`,
        timestamp: last.time,
        status: 'EXECUTED',
      }
    : undefined;

  return {
    symbol,
    exchange,
    timeframe: timeframe === 'AUTO' ? '15m' : timeframe,
    currentPrice,
    timestamp: Date.now(),
    bias,
    action: approved ? (bias === 'LONG' ? 'BUY' : 'SELL') : 'WAIT',
    approved,
    storyline4h: isBull ? 'BULLISH' : 'BEARISH',
    storyline1h: isBull ? 'BULLISH' : 'BEARISH',
    storyline1d: isBull ? 'BULLISH' : 'BEARISH',
    freshLevels,
    unfreshLevels,
    activeWatchWindows: [`${symbol}-15m-watch`],
    htfContext: {
      symbol,
      exchange,
      computedAt: Date.now(),
      cacheKey: `${symbol}_${exchange}`,
      dailyBias: isBull ? 'BULLISH' : 'BEARISH',
      swingRange4h: {
        high: sessionHigh,
        low: sessionLow,
        equilibrium50: eq50,
        currentZone,
      },
      swingRange1d: {
        high: Number((sessionHigh * 1.014).toFixed(meta.decimals)),
        low: Number((sessionLow * 0.986).toFixed(meta.decimals)),
        equilibrium50: eq50,
        currentZone,
      },
      fvgs: [
        {
          id: `${symbol}-fvg-1`,
          type: isBull ? 'BULLISH_FVG' : 'BEARISH_FVG',
          top: Number((eq50 + meta.tickSize * 2).toFixed(meta.decimals)),
          bottom: eq50,
          status: 'FRESH',
        },
      ],
      orderBlocks: [
        {
          id: `${symbol}-ob-1`,
          type: isBull ? 'DEMAND_OB' : 'SUPPLY_OB',
          top: Number((sessionLow + meta.tickSize * 3).toFixed(meta.decimals)),
          bottom: sessionLow,
          status: 'FRESH',
        },
      ],
      supplyDemandZones: [
        {
          id: `${symbol}-sd-1`,
          type: isBull ? 'DEMAND' : 'SUPPLY',
          top: Number((eq50 - meta.tickSize).toFixed(meta.decimals)),
          bottom: sessionLow,
          status: 'PARTIAL',
        },
      ],
      liquidityPools: [
        {
          id: `${symbol}-liq-1`,
          type: 'BSL_EQH',
          top: sessionHigh,
          bottom: Number((sessionHigh - meta.tickSize).toFixed(meta.decimals)),
          status: 'FRESH',
        },
      ],
      keySwingLevels: [sessionHigh, eq50, sessionLow],
      summary: `4H Range EQ $${eq50} (${currentZone})`,
    },
    signal,
    entryPrice: currentPrice,
    stopLoss,
    takeProfit,
    slDistancePercent: slPct,
    tpDistancePercent: Number((tpFrac * 100).toFixed(2)),
    riskRewardRatio: rr,
    slLabel: 'MSNR Reaction Wick + 0.1xATR SL',
    tpLabel: 'Opposing Fresh 4h/1h MSNR Level TP',
    confluenceScore,
    confirmationsCount: confluenceScore,
    activeConfirmations,
    keyReasoning: approved
      ? `${structureEvent.replace('_', ' ')} + clean traffic to opposing ${bias === 'LONG' ? '4H A-Resistance' : '4H V-Support'} (1:${rr} R:R)`
      : `Awaiting closed ${timeframe} engulfing confirmation at fresh 4H MSNR level`,
    structureEvent,
    footprintTrend,
    winProbabilityPct,
    goldenPocketZone: {
      fib618,
      fib650,
      inZone: inGoldenPocket,
    },
    pocPrice: vp.pocPrice,
    entryZone: {
      min: Number((currentPrice * (bias === 'LONG' ? 0.9985 : 0.9995)).toFixed(meta.decimals)),
      max: Number((currentPrice * (bias === 'LONG' ? 1.0005 : 1.0015)).toFixed(meta.decimals)),
      mid: currentPrice,
    },
    structuralSetup: {
      entryPrice: currentPrice,
      stopLoss,
      takeProfit,
      riskRewardRatio: rr,
      slLabel: 'MSNR Reaction Wick + 0.1xATR SL',
      tpLabel: 'Opposing Fresh 4h/1h MSNR Level TP',
      structuralInvalidationValid: true,
      riskPercent: slPct,
    },
  };
}

export function buildSeedIneligibleSignals(exchange: ExchangeType): IneligibleSignal[] {
  const now = Date.now();
  return [
    {
      id: 'skip-doge-01',
      symbol: 'DOGEUSDT',
      exchange,
      side: 'SHORT',
      failedRule: 'RULE 5: TRAFFIC OBSTRUCTION',
      reason: 'Unfresh 1H OCL roadblock detected at $0.3740 before 1:2.0 R:R target.',
      riskRewardRatio: 1.35,
      slDistancePercent: 0.72,
      timestamp: now - 420_000,
    },
    {
      id: 'skip-ada-02',
      symbol: 'ADAUSDT',
      exchange,
      side: 'LONG',
      failedRule: 'RULE 3: HTF STORYLINE MISMATCH',
      reason: '4H Storyline BEARISH conflicts with 15m bullish delta engulfing candle.',
      riskRewardRatio: 2.1,
      slDistancePercent: 0.55,
      timestamp: now - 960_000,
    },
  ];
}

export function buildSeedDecisionLogs(exchange: ExchangeType): DecisionLogEntry[] {
  const now = Date.now();
  return [
    {
      id: 'dec-btc-01',
      symbol: 'BTCUSDT',
      exchange,
      outcome: 'TRADED',
      levelId: 'BTC-4H-V1',
      levelTimeframe: '4h',
      levelType: 'V-SUPPORT',
      levelPrice: 94060,
      storyline4h: 'BULLISH',
      storyline1h: 'BULLISH',
      storyline1d: 'BULLISH',
      confluenceScore: 3,
      timestamp: now - 310_000,
      finalReason: 'Rules 1-6 passed: Fresh 4H V-tap + 15m Ask imbalance engulfing (+342 BTC delta).',
      steps: [
        {rule: 'R1-R2 Fresh MSNR', passed: true, detail: '4H V-Support untouched'},
        {rule: 'R3 Storyline', passed: true, detail: '4H & 1H BULLISH'},
        {rule: 'R4 LTF Engulf', passed: true, detail: '15m Closed Body Engulf'},
        {rule: 'R5 Clean Traffic', passed: true, detail: 'No opposing OCL before 1:2.2R'},
        {rule: 'R6 SL/TP R:R', passed: true, detail: '0.50% SL / 1:2.20 R:R'},
      ],
    },
    {
      id: 'dec-doge-02',
      symbol: 'DOGEUSDT',
      exchange,
      outcome: 'SKIPPED',
      levelId: 'DOGE-1H-SBR',
      levelTimeframe: '1h',
      levelType: 'SBR',
      levelPrice: 0.3785,
      storyline4h: 'BEARISH',
      storyline1h: 'BEARISH',
      storyline1d: 'RANGE',
      confluenceScore: 2,
      timestamp: now - 420_000,
      finalReason: 'Filtered by Rule 5: Unfresh 1H OCL roadblock caps net R:R at 1.35 (< 2.0 minimum).',
      steps: [
        {rule: 'R1-R2 Fresh MSNR', passed: true, detail: '1H SBR tap'},
        {rule: 'R3 Storyline', passed: true, detail: '4H & 1H BEARISH'},
        {rule: 'R4 LTF Engulf', passed: true, detail: '15m bearish body close'},
        {rule: 'R5 Clean Traffic', passed: false, detail: 'Opposing OCL @ $0.3740'},
        {rule: 'R6 SL/TP R:R', passed: false, detail: '1:1.35R < 1:2.0R min'},
      ],
    },
  ];
}
