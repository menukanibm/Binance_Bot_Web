import assert from 'node:assert/strict';
import test from 'node:test';
import type {Candle, OrderBookLevel, OrderFlowL3Snapshot, TickTradeEvent} from '../types/trading.ts';
import {evaluateInstitutionalSetup} from './msnrEngine.ts';

function buildBullishHtfSeries(basePrice: number): Candle[] {
  // Creates clear higher-highs & higher-lows with a fresh V-support near basePrice * 1.000
  const prices: Array<[number, number, number, number]> = [
    [basePrice * 0.992, basePrice * 0.996, basePrice * 0.990, basePrice * 0.995],
    [basePrice * 0.995, basePrice * 0.999, basePrice * 0.994, basePrice * 0.998],
    [basePrice * 0.998, basePrice * 1.002, basePrice * 0.996, basePrice * 0.997],
    [basePrice * 0.997, basePrice * 0.998, basePrice * 0.991, basePrice * 0.993],
    [basePrice * 0.993, basePrice * 0.999, basePrice * 0.992, basePrice * 0.999],
    [basePrice * 0.999, basePrice * 1.006, basePrice * 0.998, basePrice * 1.005],
    [basePrice * 1.005, basePrice * 1.007, basePrice * 1.001, basePrice * 1.002],
    // Fresh V-Support pivot at basePrice * 1.000
    [basePrice * 1.002, basePrice * 1.003, basePrice * 1.000, basePrice * 1.002],
    [basePrice * 1.002, basePrice * 1.009, basePrice * 1.0015, basePrice * 1.008],
    [basePrice * 1.008, basePrice * 1.014, basePrice * 1.007, basePrice * 1.013],
    // Closed BOS breakout above prior swing highs, now pulling back to tap fresh V-Support
    [basePrice * 1.013, basePrice * 1.016, basePrice * 1.002, basePrice * 1.003],
    [basePrice * 1.003, basePrice * 1.006, basePrice * 1.000, basePrice * 1.002],
  ];
  const now = 1_700_000_000_000;
  return prices.map(([o, h, l, c], i) => ({
    time: now + i * 3_600_000,
    open: o,
    high: h,
    low: l,
    close: c,
    volume: 1200,
    takerBuyVolume: c >= o ? 820 : 420,
    takerSellVolume: c >= o ? 380 : 780,
    delta: c >= o ? 440 : -360,
  }));
}

function buildBullishLtfSeries(basePrice: number): Candle[] {
  const now = 1_700_000_050_000;
  const rows: Array<[number, number, number, number, number]> = [
    [basePrice * 1.008, basePrice * 1.009, basePrice * 1.006, basePrice * 1.007, -20],
    [basePrice * 1.007, basePrice * 1.008, basePrice * 1.0055, basePrice * 1.0065, -35],
    [basePrice * 1.0065, basePrice * 1.0075, basePrice * 1.005, basePrice * 1.006, -40],
    [basePrice * 1.006, basePrice * 1.007, basePrice * 1.0045, basePrice * 1.0055, -50],
    [basePrice * 1.0055, basePrice * 1.0065, basePrice * 1.004, basePrice * 1.005, -45],
    [basePrice * 1.005, basePrice * 1.006, basePrice * 1.0035, basePrice * 1.004, -60],
    [basePrice * 1.004, basePrice * 1.005, basePrice * 1.002, basePrice * 1.003, -80],
    [basePrice * 1.003, basePrice * 1.004, basePrice * 1.001, basePrice * 1.002, -60],
    [basePrice * 1.002, basePrice * 1.003, basePrice * 1.001, basePrice * 1.0015, -40],
    [basePrice * 1.0015, basePrice * 1.002, basePrice * 1.0005, basePrice * 1.001, -30],
    // Sweep wick rejection down into fresh V-Support @ basePrice * 1.000
    [basePrice * 1.001, basePrice * 1.0015, basePrice * 0.9996, basePrice * 1.0008, 120],
    // Strong closed bullish engulfing candle with heavy positive delta
    [basePrice * 1.0008, basePrice * 1.0045, basePrice * 1.0005, basePrice * 1.004, 480],
  ];
  return rows.map(([o, h, l, c, d], i) => ({
    time: now + i * 300_000,
    open: o,
    high: h,
    low: l,
    close: c,
    volume: 900,
    takerBuyVolume: Math.max(100, 450 + d / 2),
    takerSellVolume: Math.max(100, 450 - d / 2),
    delta: d,
  }));
}

function buildConfirmedBullishL3(price: number): OrderFlowL3Snapshot {
  return {
    symbol: 'BTCUSDT',
    exchange: 'BINANCE',
    l1: {
      bestBid: price - 0.5,
      bestAsk: price + 0.5,
      bestBidQty: 25,
      bestAskQty: 8,
      spread: 1,
      spreadBps: 0.16,
      midPrice: price,
      updatedAt: Date.now(),
    },
    l2BidWallPrice: price - 20,
    l2BidWallQty: 95,
    l2AskWallPrice: price + 1500,
    l2AskWallQty: 18,
    l2TotalBidQty: 240,
    l2TotalAskQty: 85,
    addedLimitQty: 90,
    cancelledSpoofQty: 0,
    spoofingDetected: false,
    opposingSpoofSide: 'NONE',
    absorptionDetected: true,
    absorptionSide: 'BUY',
    icebergPrice: price - 10,
    icebergReloadCount: 4,
    queueDepletionSide: 'ASK',
    sweepLevelsCount: 2,
    takerBuyVol: 320,
    takerSellVol: 90,
    takerDelta: 230,
    queueImbalanceScore: 68,
    confirmationState: 'BULLISH_L3_CONFIRMED',
    recentEvents: [],
    updatedAt: Date.now(),
  };
}

function buildStrongBuyTicks(basePrice: number, candleTimeMs: number): TickTradeEvent[] {
  // Produces clear >=300% diagonal Buy footprint imbalances across price levels in the last candle
  const ticks: TickTradeEvent[] = [];
  for (let i = 0; i < 6; i++) {
    ticks.push({
      symbol: 'BTCUSDT',
      exchange: 'BINANCE',
      price: basePrice * 1.001 + i * 25,
      qty: 60,
      side: 'BUY',
      ts: candleTimeMs + 10_000 + i * 1000,
    });
    ticks.push({
      symbol: 'BTCUSDT',
      exchange: 'BINANCE',
      price: basePrice * 1.001 + i * 25,
      qty: 4,
      side: 'SELL',
      ts: candleTimeMs + 10_500 + i * 1000,
    });
  }
  return ticks;
}

test('Institutional MSNR Engine emits STRONG SIGNAL only when 100% of all 4 pillars pass simultaneously', () => {
  const basePrice = 64000;
  const htf = buildBullishHtfSeries(basePrice);
  const ltf = buildBullishLtfSeries(basePrice);
  const lastLtfTime = ltf[ltf.length - 1].time;
  const cleanBook: OrderBookLevel[] = [
    {price: basePrice * 1.002, bidSize: 15, askSize: 0, cumulativeBid: 15, cumulativeAsk: 0, heatIntensity: 0.3, isLiquidityWall: false},
    {price: basePrice * 1.006, bidSize: 0, askSize: 12, cumulativeBid: 0, cumulativeAsk: 12, heatIntensity: 0.25, isLiquidityWall: false},
  ];

  const passResult = evaluateInstitutionalSetup({
    symbol: 'BTCUSDT',
    exchange: 'BINANCE',
    timeframe: '15m',
    candles: ltf,
    multiTimeframe: {'4h': htf, '1h': htf, '15m': ltf, '5m': ltf},
    orderBook: cleanBook,
    recentTicks: buildStrongBuyTicks(basePrice, lastLtfTime),
    l3: buildConfirmedBullishL3(basePrice * 1.004),
    stopLossPercent: 0.5,
    apiKeyValid: true,
    dataAuthentic: true,
  });

  assert.equal(passResult.strongSignal, true);
  assert.equal(passResult.confluenceGate.canEmitSignal, true);
  assert.equal(passResult.confluenceGate.canAutoExecute, true);
  assert.equal(passResult.confluenceGate.rejectionCode, 'NONE');
  assert.equal(passResult.checks.every((c) => c.passed), true);
});

test('Institutional All-or-Nothing Rule suppresses signal if ANY single pillar fails', () => {
  const basePrice = 64000;
  const htf = buildBullishHtfSeries(basePrice);
  const ltf = buildBullishLtfSeries(basePrice);
  const lastLtfTime = ltf[ltf.length - 1].time;
  const cleanBook: OrderBookLevel[] = [
    {price: basePrice * 1.002, bidSize: 15, askSize: 0, cumulativeBid: 15, cumulativeAsk: 0, heatIntensity: 0.3, isLiquidityWall: false},
  ];

  // 1) Opposing Spoofing Wall -> MUST block
  const spoofL3 = {
    ...buildConfirmedBullishL3(basePrice * 1.004),
    spoofingDetected: true,
    opposingSpoofSide: 'ASK' as const,
  };
  const blockedSpoof = evaluateInstitutionalSetup({
    symbol: 'BTCUSDT',
    exchange: 'BINANCE',
    timeframe: '15m',
    candles: ltf,
    multiTimeframe: {'4h': htf, '1h': htf, '15m': ltf, '5m': ltf},
    orderBook: cleanBook,
    recentTicks: buildStrongBuyTicks(basePrice, lastLtfTime),
    l3: spoofL3,
    stopLossPercent: 0.5,
    apiKeyValid: true,
    dataAuthentic: true,
  });
  assert.equal(blockedSpoof.strongSignal, false);
  assert.equal(blockedSpoof.confluenceGate.canEmitSignal, false);
  assert.equal(blockedSpoof.confluenceGate.rejectionCode, 'OPPOSING_SPOOF_WALL');

  // 2) SL outside 0.25% - 1.2% Risk Guard -> MUST block
  const blockedSl = evaluateInstitutionalSetup({
    symbol: 'BTCUSDT',
    exchange: 'BINANCE',
    timeframe: '15m',
    candles: ltf,
    multiTimeframe: {'4h': htf, '1h': htf, '15m': ltf, '5m': ltf},
    orderBook: cleanBook,
    recentTicks: buildStrongBuyTicks(basePrice, lastLtfTime),
    l3: buildConfirmedBullishL3(basePrice * 1.004),
    stopLossPercent: 2.5,
    apiKeyValid: true,
    dataAuthentic: true,
  });
  assert.equal(blockedSl.strongSignal, false);
  assert.equal(blockedSl.confluenceGate.rejectionCode, 'RISK_GUARD_FAILED');

  // 3) Synthetic / unauthentic data -> MUST block completely
  const blockedOffline = evaluateInstitutionalSetup({
    symbol: 'BTCUSDT',
    exchange: 'BINANCE',
    timeframe: '15m',
    candles: ltf,
    multiTimeframe: {'4h': htf, '1h': htf, '15m': ltf, '5m': ltf},
    orderBook: cleanBook,
    l3: buildConfirmedBullishL3(basePrice * 1.004),
    stopLossPercent: 0.5,
    apiKeyValid: true,
    dataAuthentic: false,
  });
  assert.equal(blockedOffline.strongSignal, false);
  assert.equal(blockedOffline.confluenceGate.rejectionCode, 'OFFLINE_NO_DATA');
});
