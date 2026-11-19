import http from 'node:http';
import https from 'node:https';
import {SocksProxyAgent} from 'socks-proxy-agent';

export interface SignedExchangeResponse {
  ok: boolean;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  proxiedViaFixie: boolean;
  text: () => Promise<string>;
  json: <T = unknown>() => Promise<T>;
}

export interface SignedExchangeRequestInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export type HttpsRequestFn = typeof https.request;

const BINANCE_PRIVATE_EXACT_PATHS = new Set<string>([
  '/fapi/v2/balance',
  '/fapi/v2/account',
  '/fapi/v1/order',
  '/fapi/v1/batchOrders',
  '/fapi/v1/leverage',
  '/fapi/v1/marginType',
  '/fapi/v2/positionRisk',
  '/fapi/v1/openOrders',
  '/fapi/v1/allOpenOrders',
]);

let cachedProxyUrl: string | null = null;
let cachedAgent: SocksProxyAgent | null = null;

/**
 * Returns the configured Fixie SOCKS5 proxy URL from `process.env.FIXIE_SOCKS_HOST`,
 * or null if not set.
 */
export function getFixieSocksHost(): string | null {
  const raw = (process.env.FIXIE_SOCKS_HOST || '').trim();
  return raw.length > 0 ? raw : null;
}

/**
 * Returns a memoized `SocksProxyAgent` configured for `process.env.FIXIE_SOCKS_HOST`,
 * or null when Fixie is not configured.
 */
export function getFixieSocksAgent(): SocksProxyAgent | null {
  const proxyUrl = getFixieSocksHost();
  if (!proxyUrl) {
    cachedProxyUrl = null;
    cachedAgent = null;
    return null;
  }
  if (cachedAgent && cachedProxyUrl === proxyUrl) {
    return cachedAgent;
  }
  cachedProxyUrl = proxyUrl;
  cachedAgent = new SocksProxyAgent(proxyUrl);
  return cachedAgent;
}

/**
 * Strict allowlist guard: returns true ONLY for authenticated/signed Binance & MEXC
 * Futures endpoints (wallet balance, account, positions, orders, leverage).
 *
 * Public market data (klines, depth, aggTrades, exchangeInfo, ticker, ping, WebSockets)
 * and Firebase RTDB URLs ALWAYS return false so the Fixie 100/mo quota is strictly
 * preserved for private/signed live trade & wallet requests.
 */
export function isPrivateSignedExchangeUrl(urlStr: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    return false;
  }

  const host = parsed.hostname.toLowerCase();
  const pathname = parsed.pathname;

  if (host === 'fapi.binance.com' || host === 'testnet.binancefuture.com') {
    return BINANCE_PRIVATE_EXACT_PATHS.has(pathname);
  }

  if (host === 'contract.mexc.com') {
    return pathname.startsWith('/api/v1/private/');
  }

  return false;
}

function sendViaNodeHttps(
  urlStr: string,
  init: SignedExchangeRequestInit,
  agent: SocksProxyAgent,
  requestFn: HttpsRequestFn = https.request,
): Promise<SignedExchangeResponse> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(urlStr);
    const method = (init.method || 'GET').toUpperCase();
    const bodyStr = init.body;
    const headers: Record<string, string> = {
      ...(init.headers || {}),
    };
    if (bodyStr !== undefined && !Object.keys(headers).some((k) => k.toLowerCase() === 'content-length')) {
      headers['Content-Length'] = String(Buffer.byteLength(bodyStr, 'utf8'));
    }

    const timeoutMs = init.timeoutMs ?? 6500;
    const reqOptions: https.RequestOptions = {
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port ? Number(parsed.port) : 443,
      path: `${parsed.pathname}${parsed.search}`,
      method,
      headers,
      agent,
      timeout: timeoutMs,
    };

    const req: http.ClientRequest = requestFn(reqOptions, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer | string) => {
        chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
      });
      res.on('end', () => {
        const rawBody = Buffer.concat(chunks).toString('utf8');
        const status = res.statusCode ?? 0;
        const normalizedHeaders: Record<string, string> = {};
        for (const [key, val] of Object.entries(res.headers || {})) {
          if (typeof val === 'string') {
            normalizedHeaders[key.toLowerCase()] = val;
          } else if (Array.isArray(val)) {
            normalizedHeaders[key.toLowerCase()] = val.join(', ');
          }
        }
        resolve({
          ok: status >= 200 && status < 300,
          status,
          statusText: res.statusMessage || '',
          headers: normalizedHeaders,
          proxiedViaFixie: true,
          text: async () => rawBody,
          json: async <T = unknown>() => JSON.parse(rawBody) as T,
        });
      });
      res.on('error', reject);
    });

    const onAbort = () => {
      req.destroy(new Error('Signed exchange request aborted'));
    };
    if (init.signal) {
      if (init.signal.aborted) {
        req.destroy(new Error('Signed exchange request aborted'));
        return;
      }
      init.signal.addEventListener('abort', onAbort, {once: true});
    }

    req.on('timeout', () => {
      req.destroy(new Error(`Fixie SOCKS5 request timed out after ${timeoutMs}ms`));
    });

    req.on('error', (err) => {
      if (init.signal) init.signal.removeEventListener('abort', onAbort);
      reject(err);
    });

    req.on('close', () => {
      if (init.signal) init.signal.removeEventListener('abort', onAbort);
    });

    if (bodyStr !== undefined) {
      req.write(bodyStr);
    }
    req.end();
  });
}

/**
 * Executes an authenticated/signed Binance or MEXC Futures HTTP request.
 *
 * - Routes through Fixie SOCKS5 (`SocksProxyAgent` via `node:https`) ONLY when:
 *   1. `url` passes `isPrivateSignedExchangeUrl(url)` (private/signed endpoint), AND
 *   2. `process.env.FIXIE_SOCKS_HOST` is configured.
 * - Any public URL or unconfigured local environment falls back to direct `fetch()`
 *   without touching Fixie.
 */
export async function fetchSignedExchange(
  url: string,
  init: SignedExchangeRequestInit = {},
  deps?: {httpsRequest?: HttpsRequestFn},
): Promise<SignedExchangeResponse> {
  const isPrivate = isPrivateSignedExchangeUrl(url);
  const agent = isPrivate ? getFixieSocksAgent() : null;

  if (agent) {
    return sendViaNodeHttps(url, init, agent, deps?.httpsRequest || https.request);
  }

  const timeoutMs = init.timeoutMs ?? 6500;
  const res = await fetch(url, {
    method: init.method || 'GET',
    headers: init.headers,
    body: init.body,
    signal: init.signal || AbortSignal.timeout(timeoutMs),
  });

  const normalizedHeaders: Record<string, string> = {};
  res.headers.forEach((value, key) => {
    normalizedHeaders[key.toLowerCase()] = value;
  });

  return {
    ok: res.ok,
    status: res.status,
    statusText: res.statusText,
    headers: normalizedHeaders,
    proxiedViaFixie: false,
    text: () => res.text(),
    json: <T = unknown>() => res.json() as Promise<T>,
  };
}
