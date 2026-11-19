import type {ExchangeType} from '../../src/types/trading.ts';
import {executeSignedOrderForUser} from '../../server/webhookEngine.ts';

interface VercelLikeRequest {
  method?: string;
  body?: unknown;
}

interface VercelLikeResponse {
  status: (code: number) => VercelLikeResponse;
  json: (payload: unknown) => void;
}

/**
 * Vercel Serverless Function: POST /api/exchange/order
 * Executes/closes signed Binance (/fapi/v1/order, /fapi/v1/leverage) or MEXC
 * (/api/v1/private/order/submit, /api/v1/private/position/change_leverage)
 * Futures orders exclusively via the Fixie SOCKS5 proxy (FIXIE_SOCKS_HOST).
 */
export default async function handler(req: VercelLikeRequest, res: VercelLikeResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ok: false, error: 'Method Not Allowed. Send POST.'});
    return;
  }

  const body = ((typeof req.body === 'string' ? JSON.parse(req.body) : req.body) || {}) as {
    username?: string;
    exchange?: string;
    action?: 'OPEN' | 'CLOSE' | 'SET_LEVERAGE';
    symbol?: string;
    side?: 'LONG' | 'SHORT';
    orderType?: 'MARKET' | 'LIMIT';
    quantity?: number;
    price?: number;
    leverage?: number;
    syncLeverage?: boolean;
  };

  const username = String(body.username || '').trim();
  const symbol = String(body.symbol || '').trim();
  if (!username || !symbol) {
    res.status(400).json({ok: false, error: 'Username and symbol are required.'});
    return;
  }

  const exchange: ExchangeType = String(body.exchange || 'BINANCE')
    .toUpperCase()
    .includes('MEXC')
    ? 'MEXC'
    : 'BINANCE';

  const action: 'OPEN' | 'CLOSE' | 'SET_LEVERAGE' =
    body.action === 'CLOSE' || body.action === 'SET_LEVERAGE' ? body.action : 'OPEN';

  try {
    const result = await executeSignedOrderForUser({
      username,
      exchange,
      action,
      symbol,
      side: body.side,
      orderType: body.orderType,
      quantity: body.quantity,
      price: body.price,
      leverage: body.leverage,
      syncLeverage: body.syncLeverage,
    });
    res.status(result.ok ? 200 : 400).json(result);
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: `Signed Futures action failed: ${(err as Error).message}`,
    });
  }
}
