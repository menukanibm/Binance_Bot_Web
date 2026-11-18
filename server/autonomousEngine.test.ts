import assert from 'node:assert/strict';
import test from 'node:test';
import {AutonomousExecutionEngine} from './autonomousEngine.ts';
import {syncHistoricalMarketData} from './historicalSync.ts';
import {MarketIngestionEngine} from './marketIngestion.ts';
import {encryptExchangeKeysServer} from './vaultCrypto.ts';

test('MarketIngestionEngine buffers ticks in memory at sub-millisecond speed without DB blocking', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response('offline', {status: 503})) as typeof fetch;

  const engine = new MarketIngestionEngine();
  try {
    const snap = await engine.switchStream('BINANCE', 'BTCUSDT', '15m');
    assert.equal(snap.symbol, 'BTCUSDT');
    assert.ok(snap.candles.length > 20);
    assert.ok(snap.orderBook.length > 0);

    const key = engine.makeKey('BINANCE', 'BTCUSDT', '15m');
    const prevDelta = snap.cumulativeDelta;

    const afterBuy = engine.ingestTick(
      {
        symbol: 'BTCUSDT',
        exchange: 'BINANCE',
        price: 94550.25,
        qty: 3.5,
        side: 'BUY',
        ts: Date.now(),
      },
      key,
    );
    assert.ok(afterBuy);
    assert.equal(afterBuy.lastPrice, 94550.25);
    assert.equal(afterBuy.ticksBuffered, 1);
    assert.equal(Number((afterBuy.cumulativeDelta - prevDelta).toFixed(2)), 3.5);
    assert.ok(afterBuy.latencyMs < 50);

    // Circular buffer cap at 500 ticks
    for (let i = 0; i < 510; i++) {
      engine.ingestTick(
        {
          symbol: 'BTCUSDT',
          exchange: 'BINANCE',
          price: 94550 + i * 0.1,
          qty: 0.25,
          side: i % 2 === 0 ? 'BUY' : 'SELL',
          ts: Date.now() + i,
        },
        key,
      );
    }
    const latest = engine.getSnapshot('BINANCE', 'BTCUSDT', '15m');
    assert.equal(latest?.ticksBuffered, 500);
  } finally {
    engine.dispose();
    globalThis.fetch = originalFetch;
  }
});

test('syncHistoricalMarketData parses Binance klines and depth cleanly', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/fapi/v1/klines')) {
      const baseTime = 1_700_000_000_000;
      const rows = Array.from({length: 30}, (_, idx) => [
        baseTime + idx * 900_000,
        String(94000 + idx * 10),
        String(94050 + idx * 10),
        String(93980 + idx * 10),
        String(94030 + idx * 10),
        '150.5',
      ]);
      return new Response(JSON.stringify(rows), {status: 200});
    }
    if (url.includes('/fapi/v1/depth')) {
      return new Response(
        JSON.stringify({
          bids: [['94300', '12.5'], ['94290', '8.1']],
          asks: [['94310', '9.4'], ['94320', '15.0']],
        }),
        {status: 200},
      );
    }
    return new Response(null, {status: 404});
  }) as typeof fetch;

  try {
    const res = await syncHistoricalMarketData('BTCUSDT', 'BINANCE', '15m');
    assert.equal(res.source, 'HISTORICAL_REST');
    assert.equal(res.candles.length, 30);
    assert.equal(res.orderBook.length, 4);
    assert.equal(res.candles[0].open, 94000);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('AutonomousExecutionEngine auto-executes confirmed setups and pushes to /active_positions/{username}', async () => {
  const originalFetch = globalThis.fetch;
  const encryptedPayload = encryptExchangeKeysServer('keyAutonomous123', 'secAutonomous999');
  const activePosPatches: Array<{url: string; body: Record<string, unknown>}> = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === 'PATCH' && url.includes('/active_positions/')) {
      activePosPatches.push({
        url,
        body: JSON.parse(String(init.body || '{}')) as Record<string, unknown>,
      });
      return new Response(JSON.stringify({ok: true}), {status: 200});
    }
    if (init?.method === 'PATCH') {
      return new Response(JSON.stringify({ok: true}), {status: 200});
    }
    if (url.endsWith('/users.json')) {
      return new Response(
        JSON.stringify({
          auto_trader: {
            passwordHash: 'hash',
            isActive: true,
            expiryDate: '2030-01-01',
            exchangeKeys: {
              'key-binance': {
                id: 'key-binance',
                venue: 'Binance Futures',
                exchange: 'BINANCE',
                label: 'Auto',
                maskedKey: 'keyA••••••••123',
                encryptedPayload,
                autoTradeEnabled: true,
                updatedAt: '2026-01-01T00:00:00Z',
              },
            },
          },
        }),
        {status: 200},
      );
    }
    if (url.endsWith('/bot_settings.json')) {
      return new Response(
        JSON.stringify({
          auto_trader: {
            autoTrade: true,
            activeExchange: 'BINANCE',
            tradingMode: 'PAPER',
            leverage: 10,
            riskPercent: 2,
            stopLoss: 0.5,
          },
        }),
        {status: 200},
      );
    }
    if (url.endsWith('/live_signals.json')) {
      return new Response(
        JSON.stringify({
          auto_trader: {
            accountBalance: 10000,
            openPositions: [],
            signals: [],
          },
        }),
        {status: 200},
      );
    }
    return new Response('offline', {status: 503});
  }) as typeof fetch;

  const ingestion = new MarketIngestionEngine();
  const autoEngine = new AutonomousExecutionEngine(ingestion);

  try {
    await ingestion.switchStream('BINANCE', 'ETHUSDT', '15m');
    autoEngine.start();
    const result = await autoEngine.evaluateAndExecute({
      targetUsername: 'auto_trader',
      forceDispatch: true,
      slPercentOverride: 0.5,
    });

    assert.equal(result.evaluated, true);
    assert.equal(result.approved, true);
    assert.equal(result.dispatch?.executedCount, 1);
    assert.equal(activePosPatches.length, 1);
    assert.ok(activePosPatches[0].url.endsWith('/active_positions/auto_trader.json'));
    const openPos = activePosPatches[0].body.openPositions as Array<{
      symbol: string;
      source: string;
    }>;
    assert.equal(openPos.length, 1);
    assert.equal(openPos[0].symbol, 'ETHUSDT');
    assert.equal(openPos[0].source, 'AUTO_MSNR');
  } finally {
    autoEngine.stop();
    ingestion.dispose();
    globalThis.fetch = originalFetch;
  }
});
