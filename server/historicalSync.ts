import type {Candle, ExchangeType, OrderBookLevel, TickTradeEvent} from '../src/types/trading.ts';
import {generateCandles, generateOrderBook, getPairMeta} from '../src/utils/tradingMath.ts';

export interface HistoricalSyncResult {
  symbol: string;
  exchange: ExchangeType;
  interval: string;
  source: 'HISTORICAL_REST' | 'SYNTHETIC_FALLBACK';
  candles: Candle[];
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
  const asks: OrderBookLevel[] = asksRaw.slice(0, 10).map(([p, q]) => {
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
  const bids: OrderBookLevel[] = bidsRaw.slice(0, 10).map(([p, q]) => {
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

export async function fetchBinanceHistoricalData(
  symbol: string,
  interval: string,
  limit = 240,
): Promise<{candles: Candle[]; orderBook: OrderBookLevel[]; recentTicks: TickTradeEvent[]}> {
  const cleanSym = symbol.toUpperCase().replace(/[^A-Z0-9]/g, '') || 'BTCUSDT';
  const meta = getPairMeta(cleanSym);

  const [klinesRes, depthRes, aggRes] = await Promise.all([
    fetch(
      `https://fapi.binance.com/fapi/v1/klines?symbol=${encodeURIComponent(cleanSym)}&interval=${encodeURIComponent(interval)}&limit=${limit}`,
      {signal: AbortSignal.timeout(5000)},
    ),
    fetch(
      `https://fapi.binance.com/fapi/v1/depth?symbol=${encodeURIComponent(cleanSym)}&limit=20`,
      {signal: AbortSignal.timeout(4500)},
    ).catch(() => null),
    fetch(
      `https://fapi.binance.com/fapi/v1/aggTrades?symbol=${encodeURIComponent(cleanSym)}&limit=500`,
      {signal: AbortSignal.timeout(4500)},
    ).catch(() => null),
  ]);

  if (!klinesRes.ok) {
    throw new Error(`Binance klines HTTP ${klinesRes.status}`);
  }

  const rawKlines = (await klinesRes.json()) as Array<
    [number, string, string, string, string, string, number, string, number, string, ...unknown[]]
  >;
  if (!Array.isArray(rawKlines) || rawKlines.length === 0) {
    throw new Error('Binance returned empty klines');
  }

  const candles: Candle[] = rawKlines.map((row) =>
    enrichCandleFootprint(
      Number(row[1]),
      Number(row[2]),
      Number(row[3]),
      Number(row[4]),
      Number(row[5]),
      Math.floor(Number(row[0]) / 1000),
      meta.decimals,
      row[9] !== undefined ? Number(row[9]) : undefined,
    ),
  );

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

  if (orderBook.length === 0) {
    orderBook = generateOrderBook(cleanSym, candles[candles.length - 1].close);
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

  return {candles, orderBook, recentTicks};
}

export async function fetchMexcHistoricalData(
  symbol: string,
  interval: string,
): Promise<{candles: Candle[]; orderBook: OrderBookLevel[]; recentTicks: TickTradeEvent[]}> {
  const mexcSym = toMexcSymbol(symbol);
  const mexcTf = toMexcInterval(interval);
  const cleanSym = symbol.toUpperCase().replace(/[^A-Z0-9]/g, '') || 'BTCUSDT';
  const meta = getPairMeta(cleanSym);

  const [klineRes, depthRes, dealsRes] = await Promise.all([
    fetch(
      `https://contract.mexc.com/api/v1/contract/kline/${encodeURIComponent(mexcSym)}?interval=${encodeURIComponent(mexcTf)}`,
      {signal: AbortSignal.timeout(5000)},
    ),
    fetch(
      `https://contract.mexc.com/api/v1/contract/depth/${encodeURIComponent(mexcSym)}?limit=20`,
      {signal: AbortSignal.timeout(4500)},
    ).catch(() => null),
    fetch(
      `https://contract.mexc.com/api/v1/contract/deals/${encodeURIComponent(mexcSym)}`,
      {signal: AbortSignal.timeout(4500)},
    ).catch(() => null),
  ]);

  if (!klineRes.ok) {
    throw new Error(`MEXC kline HTTP ${klineRes.status}`);
  }

  const json = (await klineRes.json()) as {
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
    throw new Error('MEXC returned empty klines');
  }

  const total = d.time.length;
  const start = Math.max(0, total - 240);
  const candles: Candle[] = [];
  for (let i = start; i < total; i++) {
    candles.push(
      enrichCandleFootprint(
        Number(d.open?.[i] ?? 0),
        Number(d.high?.[i] ?? 0),
        Number(d.low?.[i] ?? 0),
        Number(d.close?.[i] ?? 0),
        Number(d.vol?.[i] ?? 0),
        Number(d.time[i]),
        meta.decimals,
      ),
    );
  }

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

  if (orderBook.length === 0 && candles.length > 0) {
    orderBook = generateOrderBook(cleanSym, candles[candles.length - 1].close);
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

  return {candles, orderBook, recentTicks};
}

export async function syncHistoricalMarketData(
  symbol: string,
  exchange: ExchangeType,
  interval: string,
): Promise<HistoricalSyncResult> {
  const cleanSym = symbol.toUpperCase().replace(/[^A-Z0-9]/g, '') || 'BTCUSDT';
  const meta = getPairMeta(cleanSym);

  try {
    const data =
      exchange === 'MEXC'
        ? await fetchMexcHistoricalData(cleanSym, interval)
        : await fetchBinanceHistoricalData(cleanSym, interval, 240);
    return {
      symbol: cleanSym,
      exchange,
      interval,
      source: 'HISTORICAL_REST',
      candles: data.candles,
      orderBook: data.orderBook,
      recentTicks: data.recentTicks,
      syncedAt: Date.now(),
    };
  } catch {
    const fallbackCandles = generateCandles(cleanSym, interval, 120, 0);
    const lastClose = fallbackCandles[fallbackCandles.length - 1]?.close ?? meta.basePrice;
    return {
      symbol: cleanSym,
      exchange,
      interval,
      source: 'SYNTHETIC_FALLBACK',
      candles: fallbackCandles,
      orderBook: generateOrderBook(cleanSym, lastClose),
      recentTicks: [],
      syncedAt: Date.now(),
    };
  }
}
