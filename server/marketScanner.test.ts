import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildFallbackPerpetualsUniverse,
  TwoStageMarketScanner,
} from './marketScanner.ts';

test('Fallback perpetuals universe removes 9-pair cap and provides 280+ active USDT-M contracts', () => {
  const binancePairs = buildFallbackPerpetualsUniverse('BINANCE');
  const mexcPairs = buildFallbackPerpetualsUniverse('MEXC');

  assert.ok(binancePairs.length >= 280, `Expected >=280 Binance pairs, got ${binancePairs.length}`);
  assert.ok(mexcPairs.length >= 280, `Expected >=280 MEXC pairs, got ${mexcPairs.length}`);
  assert.equal(binancePairs[0].symbol, 'BTCUSDT');
  assert.ok(binancePairs.some((p) => p.symbol === 'SUIUSDT'));
  assert.ok(binancePairs.some((p) => p.symbol === 'PEPEUSDT'));
  assert.ok(binancePairs.every((p) => p.symbol.endsWith('USDT') && p.lastPrice > 0));
});

test('TwoStageMarketScanner dynamically discovers exchange contracts and enforces Stage 2 rate-limit cap', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response('offline', {status: 503})) as typeof fetch;

  const scanner = new TwoStageMarketScanner();
  try {
    const res = await scanner.connectAndDiscover('BINANCE', 'BTCUSDT');
    assert.equal(res.telemetry.connected, true);
    assert.equal(res.telemetry.exchange, 'BINANCE');
    assert.ok(res.telemetry.contractsCount >= 280);
    assert.ok(res.telemetry.latencyMs > 0);
    assert.ok(res.telemetry.stage2Symbols.includes('BTCUSDT'));
    assert.ok(res.telemetry.stage2Symbols.length <= 6);

    const stage2Pairs = res.pairs.filter((p) => p.scanStage === 'STAGE_2_LOCKON');
    const stage1Pairs = res.pairs.filter((p) => p.scanStage === 'STAGE_1_DISCOVERY');
    assert.ok(stage2Pairs.length >= 1 && stage2Pairs.length <= 6);
    assert.ok(stage1Pairs.length >= 270);

    // Lock-on additional symbols respects the <=6 Stage 2 cap
    for (const sym of ['SUIUSDT', 'PEPEUSDT', 'WIFUSDT', 'ARBUSDT', 'OPUSDT', 'NEARUSDT']) {
      scanner.lockOnSymbol('BINANCE', sym);
    }
    const locked = scanner.getScannerState('BINANCE').stage2Symbols;
    assert.ok(locked.includes('NEARUSDT'));
    assert.ok(locked.length <= 6);
  } finally {
    scanner.dispose();
    globalThis.fetch = originalFetch;
  }
});

test('TwoStageMarketScanner parses live Binance exchangeInfo + 24hr ticker payload dynamically', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/fapi/v1/ping')) {
      return new Response('{}', {status: 200});
    }
    if (url.includes('/fapi/v1/exchangeInfo')) {
      const symbols = Array.from({length: 25}, (_, i) => ({
        symbol: i === 0 ? 'BTCUSDT' : `COIN${i}USDT`,
        baseAsset: i === 0 ? 'BTC' : `COIN${i}`,
        quoteAsset: 'USDT',
        contractType: 'PERPETUAL',
        status: 'TRADING',
        pricePrecision: 2,
        quantityPrecision: 3,
      }));
      return new Response(JSON.stringify({symbols}), {status: 200});
    }
    if (url.includes('/fapi/v1/ticker/24hr')) {
      const tickers = Array.from({length: 25}, (_, i) => ({
        symbol: i === 0 ? 'BTCUSDT' : `COIN${i}USDT`,
        lastPrice: String(100 + i * 10),
        priceChangePercent: '2.5',
        quoteVolume: String(50_000_000 + i * 1_000_000),
        highPrice: String(104 + i * 10),
        lowPrice: String(96 + i * 10),
      }));
      return new Response(JSON.stringify(tickers), {status: 200});
    }
    return new Response(null, {status: 404});
  }) as typeof fetch;

  const scanner = new TwoStageMarketScanner();
  try {
    const res = await scanner.connectAndDiscover('BINANCE', 'BTCUSDT');
    assert.equal(res.telemetry.source, 'LIVE_EXCHANGE');
    assert.equal(res.telemetry.contractsCount, 25);
    assert.ok(res.pairs.some((p) => p.symbol === 'COIN24USDT'));
  } finally {
    scanner.dispose();
    globalThis.fetch = originalFetch;
  }
});
