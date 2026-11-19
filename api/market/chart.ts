import {fetchVisualChartCandles} from '../../server/historicalSync.ts';
import type {ExchangeType} from '../../src/types/trading.ts';

interface VercelLikeRequest {
  method?: string;
  query?: Record<string, string | string[] | undefined>;
}

interface VercelLikeResponse {
  setHeader: (name: string, value: string) => void;
  status: (code: number) => VercelLikeResponse;
  json: (payload: unknown) => void;
  end: () => void;
}

/**
 * Vercel Serverless Route: GET /api/market/chart
 * Strictly read-only public market OHLCV fetch for the visual chart timeframe selector.
 * Never uses Fixie SOCKS5 proxy and never touches autonomous execution state.
 */
export default async function handler(req: VercelLikeRequest, res: VercelLikeResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method && req.method !== 'GET') {
    res.status(405).json({ok: false, error: 'Method Not Allowed. Use GET.'});
    return;
  }

  const query = req.query || {};
  const symbol = String(Array.isArray(query.symbol) ? query.symbol[0] : query.symbol || 'BTCUSDT')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  const interval = String(Array.isArray(query.interval) ? query.interval[0] : query.interval || '15m');
  const exchange: ExchangeType = String(
    Array.isArray(query.exchange) ? query.exchange[0] : query.exchange || 'BINANCE',
  )
    .toUpperCase()
    .includes('MEXC')
    ? 'MEXC'
    : 'BINANCE';
  const rawLimit = Number(Array.isArray(query.limit) ? query.limit[0] : query.limit || 200);
  const limit = Number.isFinite(rawLimit) ? Math.min(300, Math.max(30, rawLimit)) : 200;

  try {
    const result = await fetchVisualChartCandles(symbol, exchange, interval, limit);
    return res.status(200).json(result);
  } catch (err) {
    return res.status(502).json({
      ok: false,
      symbol,
      exchange,
      interval,
      source: 'OFFLINE_NO_DATA',
      candles: [],
      error: `Visual chart fetch failed: ${(err as Error).message}`,
    });
  }
}
