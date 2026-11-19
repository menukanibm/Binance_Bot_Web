import assert from 'node:assert/strict';
import test from 'node:test';
import {
  decryptExchangeKeysServer,
  encryptExchangeKeysServer,
  maskApiKey,
} from './vaultCrypto.ts';
import {handleWebhookDispatch, parseWebhookSignal} from './webhookEngine.ts';

test('AES-256-GCM vaultCrypto round-trip encrypts and decrypts in server memory', () => {
  const apiKey = 'bnbLiveKey_1234567890ABCDEF';
  const apiSecret = 'bnbSuperSecret_0987654321XYZ';
  const encrypted = encryptExchangeKeysServer(apiKey, apiSecret, 'test-secret-key');

  assert.ok(encrypted.startsWith('AES-256-GCM.'));
  assert.ok(!encrypted.includes(apiKey));
  assert.ok(!encrypted.includes(apiSecret));

  const decrypted = decryptExchangeKeysServer(encrypted, 'test-secret-key');
  assert.equal(decrypted.apiKey, apiKey);
  assert.equal(decrypted.apiSecret, apiSecret);

  assert.throws(() => decryptExchangeKeysServer(encrypted, 'wrong-secret-key'));
  assert.equal(maskApiKey(apiKey), 'bnbL••••••••CDEF');
});

test('parseWebhookSignal enforces 0.25%-1.2% SL clamp and 1:2 R:R minimum', () => {
  const tight = parseWebhookSignal({
    symbol: 'BTCUSDT',
    side: 'LONG',
    entryPrice: 100000,
    stopLoss: 99950, // 0.05% -> clamped up to 0.25%
    riskRewardRatio: 1.5, // clamped up to 2.0
  });
  assert.equal(tight.stopLossPercent, 0.25);
  assert.equal(tight.riskRewardRatio, 2);
  assert.equal(tight.stopLoss, 99750);
  assert.equal(tight.takeProfit, 100500);

  const wide = parseWebhookSignal({
    symbol: 'ETHUSDT',
    side: 'SHORT',
    entryPrice: 3000,
    stopLoss: 3150, // 5% -> clamped down to 1.2%
  });
  assert.equal(wide.stopLossPercent, 1.2);
  assert.equal(wide.stopLoss, 3036);
  assert.equal(wide.takeProfit, 2928);
});

test('handleWebhookDispatch executes headless trade for eligible active users and skips expired/suspended users', async () => {
  const encryptedPayload = encryptExchangeKeysServer('apiKeyABC12345', 'apiSecretXYZ98765');
  const patchedPayloads: Array<{url: string; body: Record<string, unknown>}> = [];
  const originalFetch = globalThis.fetch;

  const mockRtdb: Record<string, unknown> = {
    '/users.json': {
      active_trader: {
        passwordHash: 'hash',
        isActive: true,
        expiryDate: '2030-01-01',
        exchangeKeys: {
          'key-binance': {
            id: 'key-binance',
            venue: 'Binance Futures',
            exchange: 'BINANCE',
            label: 'Main',
            maskedKey: 'apiK••••••••2345',
            encryptedPayload,
            autoTradeEnabled: true,
            updatedAt: '2026-01-01T00:00:00Z',
          },
        },
      },
      expired_trader: {
        passwordHash: 'hash',
        isActive: true,
        expiryDate: '2020-01-01',
        exchangeKeys: {
          'key-binance': {
            id: 'key-binance',
            venue: 'Binance Futures',
            exchange: 'BINANCE',
            label: 'Expired',
            maskedKey: 'apiK••••••••2345',
            encryptedPayload,
            autoTradeEnabled: true,
            updatedAt: '2026-01-01T00:00:00Z',
          },
        },
      },
      suspended_trader: {
        passwordHash: 'hash',
        isActive: false,
        expiryDate: '2030-01-01',
        exchangeKeys: {
          'key-binance': {
            id: 'key-binance',
            venue: 'Binance Futures',
            exchange: 'BINANCE',
            label: 'Suspended',
            maskedKey: 'apiK••••••••2345',
            encryptedPayload,
            autoTradeEnabled: true,
            updatedAt: '2026-01-01T00:00:00Z',
          },
        },
      },
    },
    '/bot_settings.json': {
      active_trader: {
        autoTrade: true,
        activeExchange: 'BINANCE',
        tradingMode: 'LIVE',
        leverage: 10,
        riskPercent: 2,
        stopLoss: 0.5,
      },
    },
    '/live_signals.json': {
      active_trader: {
        accountBalance: 2500,
        openPositions: [],
        signals: [],
      },
    },
  };

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === 'PATCH') {
      patchedPayloads.push({
        url,
        body: JSON.parse(String(init.body || '{}')) as Record<string, unknown>,
      });
      return new Response(JSON.stringify({ok: true}), {status: 200});
    }
    const matchedEntry = Object.entries(mockRtdb).find(([suffix]) => url.endsWith(suffix));
    return new Response(JSON.stringify(matchedEntry ? matchedEntry[1] : null), {status: 200});
  }) as typeof fetch;

  let orderCallCount = 0;
  try {
    const result = await handleWebhookDispatch(
      {
        source: 'TRADINGVIEW_MSNR',
        exchange: 'BINANCE',
        symbol: 'BTCUSDT',
        timeframe: '15m',
        side: 'LONG',
        entryPrice: 94000,
        stopLoss: 93530,
      },
      {
        rtdbUrl: 'https://test-rtdb.firebaseio.com',
        executeOrder: async (orderParams) => {
          orderCallCount += 1;
          assert.equal(orderParams.apiKey, 'apiKeyABC12345');
          assert.equal(orderParams.apiSecret, 'apiSecretXYZ98765');
          assert.equal(orderParams.side, 'LONG');
          assert.equal(orderParams.symbol, 'BTCUSDT');
          return {ok: true, orderId: 'ORD-998877', fillPrice: 94000};
        },
      },
    );

    assert.equal(result.ok, true);
    assert.equal(orderCallCount, 1);
    assert.equal(result.executedCount, 1);

    const activeRes = result.results.find((r) => r.username === 'active_trader');
    const expiredRes = result.results.find((r) => r.username === 'expired_trader');
    const suspendedRes = result.results.find((r) => r.username === 'suspended_trader');

    assert.equal(activeRes?.status, 'EXECUTED');
    assert.equal(activeRes?.orderId, 'ORD-998877');
    assert.equal(expiredRes?.status, 'SKIPPED');
    assert.equal(suspendedRes?.status, 'SKIPPED');

    assert.equal(patchedPayloads.length, 2);
    const livePatch = patchedPayloads.find((p) => p.url.endsWith('/live_signals/active_trader.json'));
    const activePatch = patchedPayloads.find((p) =>
      p.url.endsWith('/active_positions/active_trader.json'),
    );
    assert.ok(livePatch);
    assert.ok(activePatch);
    const openPos = activePatch.body.openPositions as Array<{symbol: string; id: string}>;
    assert.equal(openPos.length, 1);
    assert.equal(openPos[0].symbol, 'BTCUSDT');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('handleWebhookDispatch blocks $0.00 LIVE balance accounts from opening phantom positions', async () => {
  const encryptedPayload = encryptExchangeKeysServer('apiKeyZero12345', 'apiSecretZero98765');
  const originalFetch = globalThis.fetch;

  const mockRtdb: Record<string, unknown> = {
    '/users.json': {
      zero_bal_trader: {
        passwordHash: 'hash',
        isActive: true,
        expiryDate: '2030-01-01',
        exchangeKeys: {
          'key-binance': {
            id: 'key-binance',
            venue: 'Binance Futures',
            exchange: 'BINANCE',
            label: 'Zero',
            maskedKey: 'apiK••••••••2345',
            encryptedPayload,
            autoTradeEnabled: true,
            updatedAt: '2026-01-01T00:00:00Z',
          },
        },
      },
    },
    '/bot_settings.json': {
      zero_bal_trader: {
        autoTrade: true,
        activeExchange: 'BINANCE',
        tradingMode: 'LIVE',
        leverage: 10,
        riskPercent: 2,
        stopLoss: 0.5,
      },
    },
    '/live_signals.json': {
      zero_bal_trader: {
        accountBalance: 0,
        openPositions: [],
        signals: [],
      },
    },
  };

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    const matchedEntry = Object.entries(mockRtdb).find(([suffix]) => url.endsWith(suffix));
    return new Response(JSON.stringify(matchedEntry ? matchedEntry[1] : null), {status: 200});
  }) as typeof fetch;

  let orderCallCount = 0;
  try {
    const result = await handleWebhookDispatch(
      {
        source: 'TRADINGVIEW_MSNR',
        exchange: 'BINANCE',
        symbol: 'BTCUSDT',
        side: 'LONG',
        entryPrice: 94000,
      },
      {
        rtdbUrl: 'https://test-rtdb.firebaseio.com',
        executeOrder: async () => {
          orderCallCount += 1;
          return {ok: true, orderId: 'SHOULD-NOT-RUN'};
        },
      },
    );

    assert.equal(orderCallCount, 0);
    assert.equal(result.executedCount, 0);
    const res = result.results.find((r) => r.username === 'zero_bal_trader');
    assert.equal(res?.status, 'SKIPPED');
    assert.match(res?.reason || '', /\$0\.00/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
