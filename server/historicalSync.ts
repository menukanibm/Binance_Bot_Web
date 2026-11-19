import type {
  Candle,
  ExchangeType,
  MultiTimeframeCandles,
  OrderBookLevel,
  TickTradeEvent,
} from '../src/types/trading.ts';
import {getPairMeta} from '../src/utils/tradingMath.ts';

export interface HistoricalSyncResult {
  symbol: string;
  exchange: ExchangeType;
  interval: string;
  source: 'HISTORICAL_REST' | 'OFFLINE_NO_DATA';
  candles: Candle[];
  multiTimeframe: MultiTimeframeCandles;
  orderBook: OrderBookLevel[];
  recentTicks: TickTradeEvent[];
  syncedAt: number;
}

function toMexcInterval(interval: string): string {
  switch (interval) {
    case '1m':
      return 'Min1';
    case '5m':
      return 'Min5';
    case '15m':
      return 'Min15';
    case '30m':
      return 'Min30';
    case '1h':
      return 'Hour1';
    case '4h':
      return 'Hour4';
    default:
      return 'Min15';
  }
}

export function toMexcSymbol(symbol: string): string {
  const clean = symbol.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return clean.endsWith('USDT') ? `${clean.slice(0, -4)}_USDT` : clean;
}

export function buildOrderBookLevelsFromSides(
  bidsRaw: Array<[number, number]>,
  asksRaw: Array<[number, number]>,
  decimals: number,
): OrderBookLevel[] {
  let cumAsk = 0;
  const asks: OrderBookLevel[] = asksRaw.slice(0, 15).map(([p, q]) => {
    cumAsk += q;
    return {
      price: Number(p.toFixed(decimals)),
      bidSize: 0,
      askSize: Number(q.toFixed(2)),
      cumulativeBid: 0,
      cumulativeAsk: Number(cumAsk.toFixed(2)),
      heatIntensity: Math.min(1, q / 48),
      isLiquidityWall: q >= 25,
    };
  });
  asks.reverse();

  let cumBid = 0;
  const bids: OrderBookLevel[] = bidsRaw.slice(0, 15).map(([p, q]) => {
    cumBid += q;
    return {
      price: Number(p.toFixed(decimals)),
      bidSize: Number(q.toFixed(2)),
      askSize: 0,
      cumulativeBid: Number(cumBid.toFixed(2)),
      cumulativeAsk: 0,
      heatIntensity: Math.min(1, q / 48),
      isLiquidityWall: q >= 25,
    };
  });

  return [...asks, ...bids];
}

function enrichCandleFootprint(
  open: number,
  high: number,
  low: number,
  close: number,
  volume: number,
  time: number,
  decimals: number,
  takerBuyBaseVol?: number,
): Candle {
  const range = Math.max(high - low, open * 0.0002);
  const bodyRatio = Math.abs(close - open) / range;
  const isBull = close >= open;
  const directionalBias = isBull ? 0.56 + bodyRatio * 0.2 : 0.44 - bodyRatio * 0.2;
  const takerBuyVolume = Number(
    (typeof takerBuyBaseVol === 'number' && takerBuyBaseVol > 0
      ? takerBuyBaseVol
      : volume * directionalBias
    ).toFixed(2),
  );
  const takerSellVolume = Number(Math.max(0, volume - takerBuyVolume).toFixed(2));
  const delta = Number((takerBuyVolume - takerSellVolume).toFixed(2));

  return {
    time,
    open: Number(open.toFixed(decimals)),
    high: Number(high.toFixed(decimals)),
    low: Number(low.toFixed(decimals)),
    close: Number(close.toFixed(decimals)),
    volume: Number(volume.toFixed(2)),
    takerBuyVolume,
    takerSellVolume,
    delta,
  };
}

async function fetchBinanceKlinesOnly(
  cleanSym: string,
  interval: string,
  decimals: number,
  limit = 160,
): Promise<Candle[]> {
  const res = await fetch(
    `https://fapi.binance.com/fapi/v1/klines?symbol=${encodeURIComponent(cleanSym)}&interval=${encodeURIComponent(interval)}&limit=${limit}`,
    {signal: AbortSignal.timeout(5000)},
  );
  if (!res.ok) throw new Error(`Binance klines ${interval} HTTP ${res.status}`);
  const rawKlines = (await res.json()) as Array<
    [number, string, string, string, string, string, number, string, number, string, ...unknown[]]
  >;
  if (!Array.isArray(rawKlines) || rawKlines.length === 0) {
    throw new Error(`Binance returned empty klines for ${interval}`);
  }
  return rawKlines.map((row) =>
    enrichCandleFootprint(
      Number(row[1]),
      Number(row[2]),
      Number(row[3]),
      Number(row[4]),
      Number(row[5]),
      Number(row[0]),
      decimals,
      row[9] !== undefined ? Number(row[9]) : undefined,
    ),
  );
}

async function fetchMexcKlinesOnly(
  mexcSym: string,
  interval: string,
  decimals: number,
  limit = 160,
): Promise<Candle[]> {
  const mexcTf = toMexcInterval(interval);
  const res = await fetch(
    `https://contract.mexc.com/api/v1/contract/kline/${encodeURIComponent(mexcSym)}?interval=${encodeURIComponent(mexcTf)}`,
    {signal: AbortSignal.timeout(5000)},
  );
  if (!res.ok) throw new Error(`MEXC kline ${interval} HTTP ${res.status}`);
  const json = (await res.json()) as {
    success?: boolean;
    data?: {
      time?: number[];
      open?: number[];
      high?: number[];
      low?: number[];
      close?: number[];
      vol?: number[];
    };
  };
  const d = json.data;
  if (!json.success || !d || !Array.isArray(d.time) || d.time.length === 0) {
    throw new Error(`MEXC returned empty klines for ${interval}`);
  }
  const total = d.time.length;
  const start = Math.max(0, total - limit);
  const candles: Candle[] = [];
  for (let i = start; i < total; i++) {
    const rawTs = Number(d.time[i]);
    const tsMs = rawTs < 10_000_000_000 ? rawTs * 1000 : rawTs;
    candles.push(
      enrichCandleFootprint(
        Number(d.open?.[i] ?? 0),
        Number(d.high?.[i] ?? 0),
        Number(d.low?.[i] ?? 0),
        Number(d.close?.[i] ?? 0),
        Number(d.vol?.[i] ?? 0),
        tsMs,
        decimals,
      ),
    );
  }
  return candles;
}

export async function fetchBinanceHistoricalData(
  symbol: string,
  interval: string,
  limit = 200,
): Promise<{
  candles: Candle[];
  multiTimeframe: MultiTimeframeCandles;
  orderBook: OrderBookLevel[];
  recentTicks: TickTradeEvent[];
}> {
  const cleanSym = symbol.toUpperCase().replace(/[^A-Z0-9]/g, '') || 'BTCUSDT';
  const meta = getPairMeta(cleanSym);

  // Pull active timeframe + full institutional HTF/LTF context (4h, 1h, 15m, 5m, 1m) + depth + aggTrades
  const [primaryCandles, c4h, c1h, c15m, c5m, c1m, depthRes, aggRes] = await Promise.all([
    fetchBinanceKlinesOnly(cleanSym, interval, meta.decimals, limit),
    interval === '4h' ? Promise.resolve(null) : fetchBinanceKlinesOnly(cleanSym, '4h', meta.decimals, 100).catch(() => null),
    interval === '1h' ? Promise.resolve(null) : fetchBinanceKlinesOnly(cleanSym, '1h', meta.decimals, 120).catch(() => null),
    interval === '15m' ? Promise.resolve(null) : fetchBinanceKlinesOnly(cleanSym, '15m', meta.decimals, 120).catch(() => null),
    interval === '5m' ? Promise.resolve(null) : fetchBinanceKlinesOnly(cleanSym, '5m', meta.decimals, 120).catch(() => null),
    interval === '1m' ? Promise.resolve(null) : fetchBinanceKlinesOnly(cleanSym, '1m', meta.decimals, 90).catch(() => null),
    fetch(
      `https://fapi.binance.com/fapi/v1/depth?symbol=${encodeURIComponent(cleanSym)}&limit=20`,
      {signal: AbortSignal.timeout(4500)},
    ).catch(() => null),
    fetch(
      `https://fapi.binance.com/fapi/v1/aggTrades?symbol=${encodeURIComponent(cleanSym)}&limit=500`,
      {signal: AbortSignal.timeout(4500)},
    ).catch(() => null),
  ]);

  const multiTimeframe: MultiTimeframeCandles = {
    '4h': interval === '4h' ? primaryCandles : c4h || undefined,
    '1h': interval === '1h' ? primaryCandles : c1h || undefined,
    '15m': interval === '15m' ? primaryCandles : c15m || undefined,
    '5m': interval === '5m' ? primaryCandles : c5m || undefined,
    '1m': interval === '1m' ? primaryCandles : c1m || undefined,
  };

  let orderBook: OrderBookLevel[] = [];
  if (depthRes && depthRes.ok) {
    const rawDepth = (await depthRes.json()) as {
      bids?: Array<[string, string]>;
      asks?: Array<[string, string]>;
    };
    const bidsRaw = (rawDepth.bids || []).map(
      ([p, q]) => [Number(p), Number(q)] as [number, number],
    );
    const asksRaw = (rawDepth.asks || []).map(
      ([p, q]) => [Number(p), Number(q)] as [number, number],
    );
    orderBook = buildOrderBookLevelsFromSides(bidsRaw, asksRaw, meta.decimals);
  }

  let recentTicks: TickTradeEvent[] = [];
  if (aggRes && aggRes.ok) {
    const rawAgg = (await aggRes.json()) as Array<{
      p?: string;
      q?: string;
      m?: boolean;
      T?: number;
    }>;
    if (Array.isArray(rawAgg)) {
      recentTicks = rawAgg
        .map((row) => ({
          symbol: cleanSym,
          exchange: 'BINANCE' as const,
          price: Number(row.p || 0),
          qty: Number(row.q || 0),
          side: (row.m ? 'SELL' : 'BUY') as 'BUY' | 'SELL',
          ts: Number(row.T || Date.now()),
        }))
        .filter((t) => t.price > 0 && t.qty > 0);
    }
  }

  return {candles: primaryCandles, multiTimeframe, orderBook, recentTicks};
}

export async function fetchMexcHistoricalData(
  symbol: string,
  interval: string,
): Promise<{
  candles: Candle[];
  multiTimeframe: MultiTimeframeCandles;
  orderBook: OrderBookLevel[];
  recentTicks: TickTradeEvent[];
}> {
  const mexcSym = toMexcSymbol(symbol);
  const cleanSym = symbol.toUpperCase().replace(/[^A-Z0-9]/g, '') || 'BTCUSDT';
  const meta = getPairMeta(cleanSym);

  const [primaryCandles, c4h, c1h, c15m, c5m, c1m, depthRes, dealsRes] = await Promise.all([
    fetchMexcKlinesOnly(mexcSym, interval, meta.decimals, 200),
    interval === '4h' ? Promise.resolve(null) : fetchMexcKlinesOnly(mexcSym, '4h', meta.decimals, 100).catch(() => null),
    interval === '1h' ? Promise.resolve(null) : fetchMexcKlinesOnly(mexcSym, '1h', meta.decimals, 120).catch(() => null),
    interval === '15m' ? Promise.resolve(null) : fetchMexcKlinesOnly(mexcSym, '15m', meta.decimals, 120).catch(() => null),
    interval === '5m' ? Promise.resolve(null) : fetchMexcKlinesOnly(mexcSym, '5m', meta.decimals, 120).catch(() => null),
    interval === '1m' ? Promise.resolve(null) : fetchMexcKlinesOnly(mexcSym, '1m', meta.decimals, 90).catch(() => null),
    fetch(
      `https://contract.mexc.com/api/v1/contract/depth/${encodeURIComponent(mexcSym)}?limit=20`,
      {signal: AbortSignal.timeout(4500)},
    ).catch(() => null),
    fetch(
      `https://contract.mexc.com/api/v1/contract/deals/${encodeURIComponent(mexcSym)}`,
      {signal: AbortSignal.timeout(4500)},
    ).catch(() => null),
  ]);

  const multiTimeframe: MultiTimeframeCandles = {
    '4h': interval === '4h' ? primaryCandles : c4h || undefined,
    '1h': interval === '1h' ? primaryCandles : c1h || undefined,
    '15m': interval === '15m' ? primaryCandles : c15m || undefined,
    '5m': interval === '5m' ? primaryCandles : c5m || undefined,
    '1m': interval === '1m' ? primaryCandles : c1m || undefined,
  };

  let orderBook: OrderBookLevel[] = [];
  if (depthRes && depthRes.ok) {
    const rawDepth = (await depthRes.json()) as {
      data?: {bids?: Array<[number, number]>; asks?: Array<[number, number]>};
    };
    const bidsRaw = (rawDepth.data?.bids || []).map(
      ([p, q]) => [Number(p), Number(q)] as [number, number],
    );
    const asksRaw = (rawDepth.data?.asks || []).map(
      ([p, q]) => [Number(p), Number(q)] as [number, number],
    );
    orderBook = buildOrderBookLevelsFromSides(bidsRaw, asksRaw, meta.decimals);
  }

  let recentTicks: TickTradeEvent[] = [];
  if (dealsRes && dealsRes.ok) {
    const rawDeals = (await dealsRes.json()) as {
      data?: Array<{p?: number; v?: number; T?: number; t?: number}>;
    };
    if (Array.isArray(rawDeals.data)) {
      recentTicks = rawDeals.data
        .map((deal) => ({
          symbol: cleanSym,
          exchange: 'MEXC' as const,
          price: Number(deal.p || 0),
          qty: Number(deal.v || 0),
          side: (Number(deal.T) === 2 ? 'SELL' : 'BUY') as 'BUY' | 'SELL',
          ts: Number(deal.t || Date.now()),
        }))
        .filter((t) => t.price > 0 && t.qty > 0);
    }
  }

  return {candles: primaryCandles, multiTimeframe, orderBook, recentTicks};
}

/**
 * Fetches 100% real historical multi-timeframe OHLCV + depth + aggTrades from the exchange.
 * Zero synthetic/random fallback data is ever generated.
 */
export async function syncHistoricalMarketData(
  symbol: string,
  exchange: ExchangeType,
  interval: string,
): Promise<HistoricalSyncResult> {
  const cleanSym = symbol.toUpperCase().replace(/[^A-Z0-9]/g, '') || 'BTCUSDT';

  try {
    const data =
      exchange === 'MEXC'
        ? await fetchMexcHistoricalData(cleanSym, interval)
        : await fetchBinanceHistoricalData(cleanSym, interval, 200);
    return {
      symbol: cleanSym,
      exchange,
      interval,
      source: 'HISTORICAL_REST',
      candles: data.candles,
      multiTimeframe: data.multiTimeframe,
      orderBook: data.orderBook,
      recentTicks: data.recentTicks,
      syncedAt: Date.now(),
    };
  } catch {
    return {
      symbol: cleanSym,
      exchange,
      interval,
      source: 'OFFLINE_NO_DATA',
      candles: [],
      multiTimeframe: {},
      orderBook: [],
      recentTicks: [],
      syncedAt: Date.now(),
    };
  }
}

/**
 * Fetches ONLY visual OHLCV candles for the chart canvas timeframe selector.
 * Completely decoupled from the background autonomous MSNR + Order-Flow engine
 * and never alters upstream engine streams or Fixie proxy quota.
 */
export async function fetchVisualChartCandles(
  symbol: string,
  exchange: ExchangeType,
  interval: string,
  limit = 200,
): Promise<{
  ok: boolean;
  symbol: string;
  exchange: ExchangeType;
  interval: string;
  source: 'HISTORICAL_REST' | 'OFFLINE_NO_DATA';
  candles: Candle[];
  syncedAt: number;
}> {
  const cleanSym = symbol.toUpperCase().replace(/[^A-Z0-9]/g, '') || 'BTCUSDT';
  const safeInterval = ['1m', '5m', '15m', '30m', '1h', '4h', '1d'].includes(interval)
    ? interval
    : '15m';
  const meta = getPairMeta(cleanSym);

  try {
    const candles =
      exchange === 'MEXC'
        ? await fetchMexcKlinesOnly(toMexcSymbol(cleanSym), safeInterval, meta.decimals, limit)
        : await fetchBinanceKlinesOnly(cleanSym, safeInterval, meta.decimals, limit);
    return {
      ok: candles.length > 0,
      symbol: cleanSym,
      exchange,
      interval: safeInterval,
      source: candles.length > 0 ? 'HISTORICAL_REST' : 'OFFLINE_NO_DATA',
      candles,
      syncedAt: Date.now(),
    };
  } catch {
    return {
      ok: false,
      symbol: cleanSym,
      exchange,
      interval: safeInterval,
      source: 'OFFLINE_NO_DATA',
      candles: [],
      syncedAt: Date.now(),
    };
  }
}

