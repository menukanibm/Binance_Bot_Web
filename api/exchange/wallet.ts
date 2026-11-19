import type {ExchangeType} from '../../src/types/trading.ts';
import {syncLiveWalletBalanceForUser} from '../../server/exchangePositions.ts';

interface VercelLikeRequest {
  method?: string;
  body?: unknown;
}

interface VercelLikeResponse {
  status: (code: number) => VercelLikeResponse;
  json: (payload: unknown) => void;
}

/**
 * Vercel Serverless Function: POST /api/exchange/wallet
 * Checks live Binance (/fapi/v2/balance) or MEXC (/api/v1/private/account/assets)
 * Futures USDT balance exclusively via the Fixie SOCKS5 proxy (FIXIE_SOCKS_HOST).
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
    const wallet = await syncLiveWalletBalanceForUser({username, exchange});
    res.status(200).json(wallet);
  } catch (err) {
    res.status(500).json({
      ok: false,
      connected: false,
      exchange,
      asset: 'USDT',
      totalWalletBalance: 0,
      availableBalance: 0,
      unrealizedPnl: 0,
      error: `Live wallet sync failed: ${(err as Error).message}`,
      syncedAt: Date.now(),
    });
  }
}
