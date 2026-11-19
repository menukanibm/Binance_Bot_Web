import assert from 'node:assert/strict';
import test from 'node:test';
import {
  purgeStaleFirebaseRecords,
  syncLiveWalletBalanceForUser,
} from './exchangePositions.ts';
import {encryptExchangeKeysServer} from './vaultCrypto.ts';
import {handleWebhookDispatch} from './webhookEngine.ts';

test('syncLiveWalletBalanceForUser decrypts Firebase key and fetches real Binance Futures USDT balance', async () => {
  const originalFetch = globalThis.fetch;
  const encryptedPayload = encryptExchangeKeysServer('binanceLiveKey123', 'binanceLiveSec456');
  const patchedUrls: string[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/users/Menuka/exchangeKeys.json')) {
      return new Response(
        JSON.stringify({
          BINANCE: {
            id: 'BINANCE',
            venue: 'Binance Futures',
            exchange: 'BINANCE',
            label: 'Primary',
            maskedKey: 'bina••••••••123',
            encryptedPayload,
            autoTradeEnabled: true,
            updatedAt: '2026-01-01T00:00:00Z',
          },
        }),
        {status: 200},
      );
    }
    if (url.startsWith('https://fapi.binance.com/fapi/v2/balance')) {
      return new Response(
        JSON.stringify([
          {
            asset: 'USDT',
            balance: '1842.75',
            availableBalance: '1510.20',
            crossUnPnl: '42.15',
          },
        ]),
        {status: 200},
      );
    }
    if (init?.method === 'PATCH') {
      patchedUrls.push(url);
      return new Response(JSON.stringify({ok: true}), {status: 200});
    }
    return new Response(null, {status: 404});
  }) as typeof fetch;

  try {
    const wallet = await syncLiveWalletBalanceForUser({
      username: 'Menuka',
      exchange: 'BINANCE',
    });
    assert.equal(wallet.ok, true);
    assert.equal(wallet.connected, true);
    assert.equal(wallet.totalWalletBalance, 1842.75);
    assert.equal(wallet.availableBalance, 1510.2);
    assert.equal(wallet.unrealizedPnl, 42.15);
    assert.ok(patchedUrls.some((u) => u.includes('/live_signals/Menuka.json')));
    assert.ok(patchedUrls.some((u) => u.includes('/active_positions/Menuka.json')));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('syncLiveWalletBalanceForUser returns $0.00 disconnected state when no API key is stored', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response('null', {status: 200})) as typeof fetch;

  try {
    const wallet = await syncLiveWalletBalanceForUser({
      username: 'NoKeyUser',
      exchange: 'BINANCE',
    });
    assert.equal(wallet.connected, false);
    assert.equal(wallet.totalWalletBalance, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('purgeStaleFirebaseRecords deletes stale /signals, /filtered, /logs and unexecuted /live_signals', async () => {
  const originalFetch = globalThis.fetch;
  const deletedUrls: string[] = [];
  let patchedSignalsBody: Record<string, unknown> | null = null;
  const sessionStart = 1_750_000_000_000;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === 'DELETE') {
      deletedUrls.push(url);
      return new Response(null, {status: 200});
    }
    if (url.includes('/live_signals/Menuka.json') && (!init?.method || init.method === 'GET')) {
      return new Response(
        JSON.stringify({
          signals: [
            {id: 'stale-old', status: 'PENDING', timestamp: sessionStart - 500_000},
            {id: 'fresh-exec', status: 'EXECUTED', timestamp: sessionStart + 5_000},
          ],
        }),
        {status: 200},
      );
    }
    if (init?.method === 'PATCH' && url.includes('/live_signals/Menuka.json')) {
      patchedSignalsBody = JSON.parse(String(init.body || '{}')) as Record<string, unknown>;
      return new Response(JSON.stringify({ok: true}), {status: 200});
    }
    return new Response('null', {status: 200});
  }) as typeof fetch;

  try {
    const res = await purgeStaleFirebaseRecords({
      username: 'Menuka',
      sessionStartedAt: sessionStart,
    });
    assert.equal(res.ok, true);
    assert.ok(deletedUrls.some((u) => u.endsWith('/signals/Menuka.json')));
    assert.ok(deletedUrls.some((u) => u.endsWith('/filtered/Menuka.json')));
    assert.ok(deletedUrls.some((u) => u.endsWith('/logs/Menuka.json')));
    assert.ok(patchedSignalsBody);
    const kept = (patchedSignalsBody as {signals: Array<{id: string}>}).signals;
    assert.equal(kept.length, 1);
    assert.equal(kept[0].id, 'fresh-exec');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('handleWebhookDispatch rejects stale webhook price >3% off live exchange mark price', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/fapi/v1/ticker/price')) {
      return new Response(JSON.stringify({symbol: 'BTCUSDT', price: '95000.00'}), {status: 200});
    }
    return new Response('{}', {status: 200});
  }) as typeof fetch;

  try {
    const result = await handleWebhookDispatch(
      {
        secret: 'makka-msnr-live-2026',
        symbol: 'BTCUSDT',
        side: 'LONG',
        entryPrice: 60000, // Stale price (>36% off live $95,000)
        stopLoss: 59700,
        exchange: 'BINANCE',
      },
      {validateLivePrice: true},
    );
    assert.equal(result.ok, false);
    assert.equal(result.executedCount, 0);
    assert.match(result.results[0]?.reason || '', /rejected/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
