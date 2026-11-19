interface VercelLikeRequest {
  method?: string;
}

interface VercelLikeResponse {
  status: (code: number) => VercelLikeResponse;
  json: (payload: unknown) => void;
}

/**
 * Vercel Serverless Function: GET /api/geo-check
 * Probes Binance Futures (`fapi/v1/ping`, `fapi/v1/exchangeInfo`) and MEXC Futures
 * (`contract/ping`) directly from the deployed Vercel region (never via Fixie) to
 * diagnose HTTP 451 geo-restrictions and verify region health.
 */
export default async function handler(req: VercelLikeRequest, res: VercelLikeResponse) {
  if (req.method && req.method !== 'GET') {
    res.status(405).json({ok: false, error: 'Method Not Allowed. Send GET.'});
    return;
  }

  const probe = async (url: string) => {
    const started = Date.now();
    try {
      const r = await fetch(url, {signal: AbortSignal.timeout(5000)});
      return {
        url,
        ok: r.ok,
        status: r.status,
        latencyMs: Date.now() - started,
        usedWeight1m: r.headers.get('x-mbx-used-weight-1m') || undefined,
      };
    } catch (err) {
      return {
        url,
        ok: false,
        status: 0,
        latencyMs: Date.now() - started,
        error: (err as Error).message,
      };
    }
  };

  const [binancePing, binanceExchangeInfo, mexcPing] = await Promise.all([
    probe('https://fapi.binance.com/fapi/v1/ping'),
    probe('https://fapi.binance.com/fapi/v1/exchangeInfo'),
    probe('https://contract.mexc.com/api/v1/contract/ping'),
  ]);

  res.status(200).json({
    ok: binancePing.ok || mexcPing.ok,
    region: process.env.VERCEL_REGION || 'unknown',
    fixieConfigured: Boolean(process.env.FIXIE_SOCKS_HOST?.trim()),
    probes: {binancePing, binanceExchangeInfo, mexcPing},
    checkedAt: new Date().toISOString(),
  });
}
