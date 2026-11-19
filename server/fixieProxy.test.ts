import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import type http from 'node:http';
import type https from 'node:https';
import test from 'node:test';
import {SocksProxyAgent} from 'socks-proxy-agent';
import {
  fetchSignedExchange,
  getFixieSocksAgent,
  isPrivateSignedExchangeUrl,
  type HttpsRequestFn,
} from './fixieProxy.ts';
import walletHandler from '../api/exchange/wallet.ts';
import orderHandler from '../api/exchange/order.ts';
import {encryptExchangeKeysServer} from './vaultCrypto.ts';

function createMockHttpsRequest(
  capturedOptions: https.RequestOptions[],
  statusCode = 200,
  responseBody = JSON.stringify({ok: true}),
): HttpsRequestFn {
  return ((options: https.RequestOptions, callback?: (res: http.IncomingMessage) => void) => {
    capturedOptions.push(options);
    const req = new EventEmitter() as http.ClientRequest;
    req.write = () => true;
    req.destroy = () => req;
    req.end = () => {
      const res = new EventEmitter() as http.IncomingMessage;
      res.statusCode = statusCode;
      res.statusMessage = statusCode === 200 ? 'OK' : 'Error';
      res.headers = {'content-type': 'application/json'};
      if (callback) callback(res);
      queueMicrotask(() => {
        res.emit('data', Buffer.from(responseBody, 'utf8'));
        res.emit('end');
        req.emit('close');
      });
      return req;
    };
    return req;
  }) as unknown as HttpsRequestFn;
}

test('isPrivateSignedExchangeUrl allows ONLY private/signed Binance & MEXC endpoints and blocks all public market data', () => {
  // Private / signed Binance Futures endpoints -> TRUE
  assert.equal(
    isPrivateSignedExchangeUrl('https://fapi.binance.com/fapi/v2/balance?timestamp=1&signature=abc'),
    true,
  );
  assert.equal(
    isPrivateSignedExchangeUrl('https://fapi.binance.com/fapi/v1/order?symbol=BTCUSDT&signature=abc'),
    true,
  );
  assert.equal(
    isPrivateSignedExchangeUrl('https://fapi.binance.com/fapi/v1/leverage?symbol=BTCUSDT&leverage=10'),
    true,
  );
  assert.equal(
    isPrivateSignedExchangeUrl('https://fapi.binance.com/fapi/v2/positionRisk?timestamp=1'),
    true,
  );
  assert.equal(
    isPrivateSignedExchangeUrl('https://fapi.binance.com/fapi/v1/openOrders?timestamp=1'),
    true,
  );

  // Private / signed MEXC Futures endpoints -> TRUE
  assert.equal(
    isPrivateSignedExchangeUrl('https://contract.mexc.com/api/v1/private/account/assets'),
    true,
  );
  assert.equal(
    isPrivateSignedExchangeUrl('https://contract.mexc.com/api/v1/private/order/submit'),
    true,
  );
  assert.equal(
    isPrivateSignedExchangeUrl('https://contract.mexc.com/api/v1/private/position/open_positions'),
    true,
  );
  assert.equal(
    isPrivateSignedExchangeUrl('https://contract.mexc.com/api/v1/private/position/change_leverage'),
    true,
  );

  // Public market data, scanner, klines, depth, tickers & Firebase -> STRICTLY FALSE (preserve Fixie 100/mo quota)
  assert.equal(
    isPrivateSignedExchangeUrl('https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=15m'),
    false,
  );
  assert.equal(
    isPrivateSignedExchangeUrl('https://fapi.binance.com/fapi/v1/depth?symbol=BTCUSDT&limit=20'),
    false,
  );
  assert.equal(
    isPrivateSignedExchangeUrl('https://fapi.binance.com/fapi/v1/aggTrades?symbol=BTCUSDT&limit=500'),
    false,
  );
  assert.equal(isPrivateSignedExchangeUrl('https://fapi.binance.com/fapi/v1/exchangeInfo'), false);
  assert.equal(isPrivateSignedExchangeUrl('https://fapi.binance.com/fapi/v1/ticker/24hr'), false);
  assert.equal(
    isPrivateSignedExchangeUrl('https://fapi.binance.com/fapi/v1/ticker/price?symbol=BTCUSDT'),
    false,
  );
  assert.equal(isPrivateSignedExchangeUrl('https://fapi.binance.com/fapi/v1/ping'), false);
  assert.equal(
    isPrivateSignedExchangeUrl('https://contract.mexc.com/api/v1/contract/kline/BTC_USDT'),
    false,
  );
  assert.equal(
    isPrivateSignedExchangeUrl('https://contract.mexc.com/api/v1/contract/detail'),
    false,
  );
  assert.equal(
    isPrivateSignedExchangeUrl('https://contract.mexc.com/api/v1/contract/ticker'),
    false,
  );
  assert.equal(
    isPrivateSignedExchangeUrl('https://example-default-rtdb.firebaseio.com/users.json'),
    false,
  );
});

test('fetchSignedExchange attaches SocksProxyAgent from FIXIE_SOCKS_HOST exclusively to private Binance/MEXC requests', async () => {
  const prevFixie = process.env.FIXIE_SOCKS_HOST;
  const originalFetch = globalThis.fetch;
  process.env.FIXIE_SOCKS_HOST = 'socks5h://fixie:testpass@century.usefixie.com:1080';

  const capturedHttpsOpts: https.RequestOptions[] = [];
  const directFetchUrls: string[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    directFetchUrls.push(String(input));
    return new Response(JSON.stringify({direct: true}), {status: 200});
  }) as typeof fetch;

  try {
    const agent = getFixieSocksAgent();
    assert.ok(agent instanceof SocksProxyAgent);

    // 1. Signed Binance /fapi/v2/balance -> MUST use Fixie SocksProxyAgent
    const balRes = await fetchSignedExchange(
      'https://fapi.binance.com/fapi/v2/balance?timestamp=1&signature=sig',
      {headers: {'X-MBX-APIKEY': 'testKey'}},
      {httpsRequest: createMockHttpsRequest(capturedHttpsOpts, 200, JSON.stringify([{asset: 'USDT', balance: '500'}]))},
    );
    assert.equal(balRes.ok, true);
    assert.equal(balRes.proxiedViaFixie, true);
    assert.equal(capturedHttpsOpts.length, 1);
    assert.ok(capturedHttpsOpts[0].agent instanceof SocksProxyAgent);
    assert.equal(capturedHttpsOpts[0].hostname, 'fapi.binance.com');
    assert.ok(String(capturedHttpsOpts[0].path).startsWith('/fapi/v2/balance'));

    // 2. Signed Binance /fapi/v1/leverage -> MUST use Fixie SocksProxyAgent
    const levRes = await fetchSignedExchange(
      'https://fapi.binance.com/fapi/v1/leverage?symbol=BTCUSDT&leverage=10&signature=sig',
      {method: 'POST', headers: {'X-MBX-APIKEY': 'testKey'}},
      {httpsRequest: createMockHttpsRequest(capturedHttpsOpts, 200, JSON.stringify({leverage: 10}))},
    );
    assert.equal(levRes.ok, true);
    assert.equal(levRes.proxiedViaFixie, true);
    assert.equal(capturedHttpsOpts.length, 2);
    assert.ok(capturedHttpsOpts[1].agent instanceof SocksProxyAgent);

    // 3. Signed MEXC /api/v1/private/order/submit -> MUST use Fixie SocksProxyAgent
    const mexcRes = await fetchSignedExchange(
      'https://contract.mexc.com/api/v1/private/order/submit',
      {method: 'POST', body: JSON.stringify({symbol: 'BTC_USDT'})},
      {httpsRequest: createMockHttpsRequest(capturedHttpsOpts, 200, JSON.stringify({success: true, data: '991'}))},
    );
    assert.equal(mexcRes.ok, true);
    assert.equal(mexcRes.proxiedViaFixie, true);
    assert.equal(capturedHttpsOpts.length, 3);
    assert.ok(capturedHttpsOpts[2].agent instanceof SocksProxyAgent);

    // 4. Public Binance /fapi/v1/klines -> MUST bypass Fixie completely even if passed to fetchSignedExchange!
    const pubRes = await fetchSignedExchange(
      'https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=15m',
      {},
      {httpsRequest: createMockHttpsRequest(capturedHttpsOpts, 200, '[]')},
    );
    assert.equal(pubRes.ok, true);
    assert.equal(pubRes.proxiedViaFixie, false);
    assert.equal(capturedHttpsOpts.length, 3); // Unchanged — Fixie NOT invoked!
    assert.equal(directFetchUrls.length, 1);
    assert.ok(directFetchUrls[0].includes('/fapi/v1/klines'));
  } finally {
    if (prevFixie === undefined) {
      delete process.env.FIXIE_SOCKS_HOST;
    } else {
      process.env.FIXIE_SOCKS_HOST = prevFixie;
    }
    globalThis.fetch = originalFetch;
  }
});

test('Vercel serverless /api/exchange/wallet and /api/exchange/order routes handle balance, leverage, open, and close cleanly', async () => {
  const prevFixie = process.env.FIXIE_SOCKS_HOST;
  delete process.env.FIXIE_SOCKS_HOST; // Use direct fetch mock to verify serverless handlers end-to-end
  const originalFetch = globalThis.fetch;
  const encryptedPayload = encryptExchangeKeysServer('vercelKey123', 'vercelSec456');
  const calledBinancePaths: string[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/users/Menuka/exchangeKeys.json')) {
      return new Response(
        JSON.stringify({
          BINANCE: {
            id: 'BINANCE',
            venue: 'Binance Futures',
            exchange: 'BINANCE',
            label: 'Vercel Key',
            maskedKey: 'verc••••••••123',
            encryptedPayload,
            autoTradeEnabled: true,
            updatedAt: '2026-01-01T00:00:00Z',
          },
        }),
        {status: 200},
      );
    }
    if (url.startsWith('https://fapi.binance.com/fapi/v2/balance')) {
      calledBinancePaths.push('/fapi/v2/balance');
      return new Response(
        JSON.stringify([{asset: 'USDT', balance: '950.00', availableBalance: '810.50', crossUnPnl: '12.25'}]),
        {status: 200},
      );
    }
    if (url.startsWith('https://fapi.binance.com/fapi/v1/leverage')) {
      calledBinancePaths.push('/fapi/v1/leverage');
      return new Response(JSON.stringify({leverage: 15}), {status: 200});
    }
    if (url.startsWith('https://fapi.binance.com/fapi/v1/order')) {
      calledBinancePaths.push(url.includes('reduceOnly=true') ? '/fapi/v1/order:CLOSE' : '/fapi/v1/order:OPEN');
      return new Response(JSON.stringify({orderId: 778899, avgPrice: '64200.50'}), {status: 200});
    }
    if (init?.method === 'PATCH') {
      return new Response(JSON.stringify({ok: true}), {status: 200});
    }
    return new Response('null', {status: 200});
  }) as typeof fetch;

  const invoke = async (
    handler: (req: {method?: string; body?: unknown}, res: {status: (c: number) => any; json: (p: unknown) => void}) => Promise<void>,
    body: unknown,
  ) => {
    let statusCode = 0;
    let payload: unknown = null;
    const res = {
      status(code: number) {
        statusCode = code;
        return res;
      },
      json(p: unknown) {
        payload = p;
      },
    };
    await handler({method: 'POST', body}, res);
    return {statusCode, payload: payload as Record<string, unknown>};
  };

  try {
    const walletRes = await invoke(walletHandler, {username: 'Menuka', exchange: 'BINANCE'});
    assert.equal(walletRes.statusCode, 200);
    assert.equal(walletRes.payload.ok, true);
    assert.equal(walletRes.payload.totalWalletBalance, 950);

    const openRes = await invoke(orderHandler, {
      username: 'Menuka',
      exchange: 'BINANCE',
      action: 'OPEN',
      symbol: 'BTCUSDT',
      side: 'LONG',
      quantity: 0.02,
      price: 64200,
      leverage: 15,
      syncLeverage: true,
    });
    assert.equal(openRes.statusCode, 200);
    assert.equal(openRes.payload.ok, true);
    assert.equal(openRes.payload.orderId, '778899');

    const closeRes = await invoke(orderHandler, {
      username: 'Menuka',
      exchange: 'BINANCE',
      action: 'CLOSE',
      symbol: 'BTCUSDT',
      side: 'LONG',
      quantity: 0.02,
      price: 64500,
    });
    assert.equal(closeRes.statusCode, 200);
    assert.equal(closeRes.payload.ok, true);

    assert.deepEqual(calledBinancePaths, [
      '/fapi/v2/balance',
      '/fapi/v1/leverage',
      '/fapi/v1/order:OPEN',
      '/fapi/v1/order:CLOSE',
    ]);
  } finally {
    if (prevFixie !== undefined) {
      process.env.FIXIE_SOCKS_HOST = prevFixie;
    }
    globalThis.fetch = originalFetch;
  }
});
