import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import type http from 'node:http';
import type https from 'node:https';
import test from 'node:test';
import {SocksProxyAgent} from 'socks-proxy-agent';
import type {HttpsRequestFn} from './fixieProxy.ts';
import {
  diagnoseBinanceError,
  diagnoseMexcError,
  verifyAndSaveExchangeKey,
} from './verifyExchangeKey.ts';
import verifyHandler from '../api/verify-exchange-key.ts';

function mockFixieHttps(
  captured: https.RequestOptions[],
  statusCode: number,
  payload: unknown,
): HttpsRequestFn {
  const bodyStr = JSON.stringify(payload);
  return ((options: https.RequestOptions, cb?: (res: http.IncomingMessage) => void) => {
    captured.push(options);
    const req = new EventEmitter() as http.ClientRequest;
    req.write = () => true;
    req.destroy = () => req;
    req.end = () => {
      const res = new EventEmitter() as http.IncomingMessage;
      res.statusCode = statusCode;
      res.statusMessage = statusCode === 200 ? 'OK' : 'Error';
      res.headers = {'content-type': 'application/json'};
      if (cb) cb(res);
      queueMicrotask(() => {
        res.emit('data', Buffer.from(bodyStr, 'utf8'));
        res.emit('end');
        req.emit('close');
      });
      return req;
    };
    return req;
  }) as unknown as HttpsRequestFn;
}

test('diagnoseBinanceError and diagnoseMexcError produce clear human-readable diagnostics', () => {
  const ipErr = diagnoseBinanceError(401, -2015, 'Invalid API-key, IP, or permissions for action (IP restricted)');
  assert.equal(ipErr.errorCode, 'IP_WHITELIST_MISMATCH');
  assert.match(ipErr.error, /Fixie Static IPs/i);

  const sigErr = diagnoseBinanceError(400, -1022, 'Signature for this request is not valid.');
  assert.equal(sigErr.errorCode, 'INVALID_CREDENTIALS');
  assert.match(sigErr.error, /Invalid API Key or Secret/i);

  const mexcIpErr = diagnoseMexcError(403, 700006, 'IP not in whitelist');
  assert.equal(mexcIpErr.errorCode, 'IP_WHITELIST_MISMATCH');
  assert.match(mexcIpErr.error, /Fixie Static IPs/i);
});

test('verifyAndSaveExchangeKey verifies Binance /fapi/v2/account through Fixie SOCKS5 and saves AES-256-GCM encrypted key on success', async () => {
  const prevFixie = process.env.FIXIE_SOCKS_HOST;
  const originalFetch = globalThis.fetch;
  process.env.FIXIE_SOCKS_HOST = 'socks5h://fixie:secret@century.usefixie.com:1080';

  const capturedHttps: https.RequestOptions[] = [];
  const rtdbWrites: Array<{method: string; url: string; body: string}> = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    rtdbWrites.push({
      method: init?.method || 'GET',
      url: String(input),
      body: String(init?.body || ''),
    });
    return new Response(JSON.stringify({ok: true}), {status: 200});
  }) as typeof fetch;

  try {
    const result = await verifyAndSaveExchangeKey(
      {
        username: 'Menuka',
        exchange: 'BINANCE',
        venue: 'Binance Futures',
        label: 'Primary Fixie Key',
        apiKey: 'bnLiveApiKey1234567890',
        apiSecret: 'bnLiveApiSecret0987654321',
        rtdbUrl: 'https://test-rtdb.firebaseio.com',
      },
      {
        httpsRequest: mockFixieHttps(capturedHttps, 200, {
          canTrade: true,
          totalWalletBalance: '3420.55',
          availableBalance: '2990.10',
          totalUnrealizedProfit: '15.25',
          assets: [
            {
              asset: 'USDT',
              walletBalance: '3420.55',
              availableBalance: '2990.10',
              unrealizedProfit: '15.25',
            },
          ],
        }),
      },
    );

    assert.equal(result.ok, true);
    assert.equal(result.saved, true);
    assert.equal(result.futuresEnabled, true);
    assert.equal(result.proxiedViaFixie, true);
    assert.equal(result.wallet?.totalWalletBalance, 3420.55);
    assert.equal(result.wallet?.availableBalance, 2990.1);
    assert.ok(result.record?.encryptedPayload.startsWith('AES-256-GCM.'));

    // Verified Fixie SocksProxyAgent attached to GET /fapi/v2/account
    assert.equal(capturedHttps.length, 1);
    assert.ok(capturedHttps[0].agent instanceof SocksProxyAgent);
    assert.equal(capturedHttps[0].hostname, 'fapi.binance.com');
    assert.ok(String(capturedHttps[0].path).startsWith('/fapi/v2/account'));

    // Verified Firebase RTDB write to /users/Menuka/exchangeKeys/BINANCE.json
    assert.ok(
      rtdbWrites.some(
        (w) => w.method === 'PUT' && w.url.endsWith('/users/Menuka/exchangeKeys/BINANCE.json'),
      ),
    );
  } finally {
    if (prevFixie === undefined) delete process.env.FIXIE_SOCKS_HOST;
    else process.env.FIXIE_SOCKS_HOST = prevFixie;
    globalThis.fetch = originalFetch;
  }
});

test('verifyAndSaveExchangeKey blocks saving broken keys when canTrade is false or IP whitelist fails', async () => {
  const prevFixie = process.env.FIXIE_SOCKS_HOST;
  const originalFetch = globalThis.fetch;
  process.env.FIXIE_SOCKS_HOST = 'socks5h://fixie:secret@century.usefixie.com:1080';

  const rtdbWrites: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    rtdbWrites.push(String(input));
    return new Response(JSON.stringify({ok: true}), {status: 200});
  }) as typeof fetch;

  try {
    // Case 1: Futures permission unchecked (canTrade: false)
    const cap1: https.RequestOptions[] = [];
    const noFutures = await verifyAndSaveExchangeKey(
      {
        username: 'Menuka',
        exchange: 'BINANCE',
        apiKey: 'bnNoFuturesKey1234',
        apiSecret: 'bnNoFuturesSec5678',
      },
      {
        httpsRequest: mockFixieHttps(cap1, 200, {
          canTrade: false,
          totalWalletBalance: '100.00',
        }),
      },
    );
    assert.equal(noFutures.ok, false);
    assert.equal(noFutures.saved, false);
    assert.equal(noFutures.errorCode, 'FUTURES_PERMISSION_DISABLED');
    assert.match(noFutures.error || '', /Enable Futures/i);
    assert.equal(rtdbWrites.length, 0); // ZERO Firebase writes!

    // Case 2: IP Whitelist Mismatch (-2015)
    const cap2: https.RequestOptions[] = [];
    const ipFail = await verifyAndSaveExchangeKey(
      {
        username: 'Menuka',
        exchange: 'BINANCE',
        apiKey: 'bnIpBlockedKey1234',
        apiSecret: 'bnIpBlockedSec5678',
      },
      {
        httpsRequest: mockFixieHttps(cap2, 401, {
          code: -2015,
          msg: 'Invalid API-key, IP, or permissions for action: IP not whitelisted.',
        }),
      },
    );
    assert.equal(ipFail.ok, false);
    assert.equal(ipFail.saved, false);
    assert.equal(ipFail.errorCode, 'IP_WHITELIST_MISMATCH');
    assert.match(ipFail.error || '', /Fixie Static IPs/i);
    assert.equal(rtdbWrites.length, 0); // ZERO Firebase writes!
  } finally {
    if (prevFixie === undefined) delete process.env.FIXIE_SOCKS_HOST;
    else process.env.FIXIE_SOCKS_HOST = prevFixie;
    globalThis.fetch = originalFetch;
  }
});

test('Vercel serverless /api/verify-exchange-key returns 401 on invalid credentials and 200 on valid MEXC handshake', async () => {
  const prevFixie = process.env.FIXIE_SOCKS_HOST;
  delete process.env.FIXIE_SOCKS_HOST;
  const originalFetch = globalThis.fetch;

  let mexcShouldSucceed = false;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('contract.mexc.com/api/v1/private/account/assets')) {
      if (!mexcShouldSucceed) {
        return new Response(
          JSON.stringify({success: false, code: 401, message: 'Invalid signature'}),
          {status: 401},
        );
      }
      return new Response(
        JSON.stringify({
          success: true,
          data: [{currency: 'USDT', equity: 1280.4, availableBalance: 1100.0, unrealized: 10.2}],
        }),
        {status: 200},
      );
    }
    return new Response(JSON.stringify({ok: true}), {status: 200});
  }) as typeof fetch;

  const invoke = async (body: unknown) => {
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
    await verifyHandler({method: 'POST', body}, res);
    return {statusCode, payload: payload as Record<string, unknown>};
  };

  try {
    const failRes = await invoke({
      username: 'Menuka',
      exchange: 'MEXC',
      apiKey: 'badKey',
      apiSecret: 'badSecret',
    });
    assert.equal(failRes.statusCode, 401);
    assert.equal(failRes.payload.ok, false);
    assert.equal(failRes.payload.saved, false);

    mexcShouldSucceed = true;
    const okRes = await invoke({
      username: 'Menuka',
      exchange: 'MEXC',
      apiKey: 'goodMexcKey1234',
      apiSecret: 'goodMexcSec5678',
    });
    assert.equal(okRes.statusCode, 200);
    assert.equal(okRes.payload.ok, true);
    assert.equal(okRes.payload.saved, true);
    assert.equal((okRes.payload.wallet as {totalWalletBalance: number}).totalWalletBalance, 1280.4);
  } finally {
    if (prevFixie !== undefined) process.env.FIXIE_SOCKS_HOST = prevFixie;
    globalThis.fetch = originalFetch;
  }
});
