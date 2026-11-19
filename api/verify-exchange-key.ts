import type {ExchangeType, FirebaseExchangeKeyRecord} from '../src/types/trading.ts';
import {verifyAndSaveExchangeKey} from '../server/verifyExchangeKey.ts';

interface VercelLikeRequest {
  method?: string;
  body?: unknown;
}

interface VercelLikeResponse {
  status: (code: number) => VercelLikeResponse;
  json: (payload: unknown) => void;
}

/**
 * Vercel Serverless Function: POST /api/verify-exchange-key
 * Performs a live signed exchange account handshake (`GET /fapi/v2/account` for Binance
 * or `GET /api/v1/private/account/assets` for MEXC) exclusively via `FIXIE_SOCKS_HOST`
 * SOCKS5 proxy. Encrypts & stores keys in Firebase RTDB ONLY if verification succeeds.
 */
export default async function handler(req: VercelLikeRequest, res: VercelLikeResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ok: false, saved: false, error: 'Method Not Allowed. Send POST.'});
    return;
  }

  const body = ((typeof req.body === 'string' ? JSON.parse(req.body) : req.body) || {}) as {
    username?: string;
    venue?: FirebaseExchangeKeyRecord['venue'];
    exchange?: string;
    label?: string;
    apiKey?: string;
    apiSecret?: string;
  };

  const username = String(body.username || '').trim();
  const apiKey = String(body.apiKey || '').trim();
  const apiSecret = String(body.apiSecret || '').trim();

  if (!username || !apiKey || !apiSecret) {
    res.status(400).json({
      ok: false,
      saved: false,
      errorCode: 'MISSING_FIELDS',
      error: 'Username, Exchange API Key, and API Secret are required.',
    });
    return;
  }

  const exchange: ExchangeType = String(body.exchange || body.venue || 'BINANCE')
    .toUpperCase()
    .includes('MEXC')
    ? 'MEXC'
    : 'BINANCE';

  try {
    const result = await verifyAndSaveExchangeKey({
      username,
      exchange,
      venue: body.venue || (exchange === 'MEXC' ? 'MEXC Futures' : 'Binance Futures'),
      label: body.label,
      apiKey,
      apiSecret,
    });

    if (!result.ok) {
      const httpCode =
        result.errorCode === 'INVALID_CREDENTIALS'
          ? 401
          : result.errorCode === 'IP_WHITELIST_MISMATCH' ||
              result.errorCode === 'FUTURES_PERMISSION_DISABLED' ||
              result.errorCode === 'IP_OR_PERMISSION_DENIED' ||
              result.errorCode === 'PROXY_GEO_BLOCKED'
            ? 403
            : 400;
      res.status(httpCode).json(result);
      return;
    }

    res.status(200).json(result);
  } catch (err) {
    res.status(502).json({
      ok: false,
      saved: false,
      errorCode: 'PROXY_HANDSHAKE_FAILED',
      error: `Exchange verification failed: ${(err as Error).message}`,
    });
  }
}
