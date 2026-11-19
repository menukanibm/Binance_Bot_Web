import type {ExchangeType} from '../../src/types/trading.ts';
import {syncBotPositionsForUser} from '../../server/exchangePositions.ts';

interface VercelLikeRequest {
  method?: string;
  body?: unknown;
}

interface VercelLikeResponse {
  status: (code: number) => VercelLikeResponse;
  json: (payload: unknown) => void;
}

/**
 * Vercel Serverless Function: POST /api/exchange/sync-positions
 * Syncs authenticated Binance (/fapi/v2/positionRisk, /fapi/v1/openOrders) or MEXC
 * (/api/v1/private/position/open_positions) positions via Fixie SOCKS5 proxy.
 */
export default async function handler(req: VercelLikeRequest, res: VercelLikeResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ok: false, error: 'Method Not Allowed. Send POST.'});
    return;
  }

  const body = ((typeof req.body === 'string' ? JSON.parse(req.body) : req.body) || {}) as {
    username?: string;
    exchange?: string;
  };
  const username = String(body.username || '').trim();
  if (!username) {
    res.status(400).json({ok: false, error: 'Missing username'});
    return;
  }

  const exchange: ExchangeType = String(body.exchange || 'BINANCE')
    .toUpperCase()
    .includes('MEXC')
    ? 'MEXC'
    : 'BINANCE';

  try {
    const result = await syncBotPositionsForUser({username, exchange});
    res.status(200).json(result);
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: `Exchange position sync failed: ${(err as Error).message}`,
    });
  }
}
