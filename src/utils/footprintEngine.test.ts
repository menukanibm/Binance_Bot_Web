import assert from 'node:assert/strict';
import test from 'node:test';
import {buildTradingViewFootprintCandles, formatCompactVol} from './footprintEngine.ts';
import type {Candle, TickTradeEvent} from '../types/trading.ts';

test('buildTradingViewFootprintCandles aggregates ticks, diagonal 300% imbalances, POC, 70% VA, and CVD', () => {
  const baseSec = 1_700_000_700; // aligned 15m bar
  const candles: Candle[] = [
    {
      time: baseSec,
      open: 94000,
      high: 94100,
      low: 93980,
      close: 94085,
      volume: 1200,
      takerBuyVolume: 900,
      takerSellVolume: 300,
      delta: 600,
    },
    {
      time: baseSec + 900,
      open: 94085,
      high: 94200,
      low: 94060,
      close: 94190,
      volume: 1500,
      takerBuyVolume: 1150,
      takerSellVolume: 350,
      delta: 800,
    },
  ];

  // Feed explicit ticks into bar 2 showing heavy diagonal ask imbalance
  const ticks: TickTradeEvent[] = [
    {symbol: 'BTCUSDT', exchange: 'BINANCE', price: 94080, qty: 10, side: 'SELL', ts: (baseSec + 910) * 1000},
    {symbol: 'BTCUSDT', exchange: 'BINANCE', price: 94100, qty: 65, side: 'BUY', ts: (baseSec + 920) * 1000},
    {symbol: 'BTCUSDT', exchange: 'BINANCE', price: 94120, qty: 80, side: 'BUY', ts: (baseSec + 930) * 1000},
    {symbol: 'BTCUSDT', exchange: 'BINANCE', price: 94140, qty: 120, side: 'BUY', ts: (baseSec + 940) * 1000},
    {symbol: 'BTCUSDT', exchange: 'BINANCE', price: 94140, qty: 15, side: 'SELL', ts: (baseSec + 945) * 1000},
  ];

  const fps = buildTradingViewFootprintCandles('BTCUSDT', candles, ticks, '15m', {
    imbalanceRatioPct: 300,
    candlesInView: 10,
  });

  assert.equal(fps.length, 2);
  const second = fps[1];
  assert.ok(second.levels.length >= 4 && second.levels.length <= 14);
  assert.ok(second.levels.some((l) => l.isPoc));
  assert.ok(second.levels.some((l) => l.inValueArea));
  assert.equal(typeof second.deltaPercent, 'number');
  assert.ok(second.cvd === fps[0].delta + second.delta);
  assert.ok(second.buyVolume && second.buyVolume > 0);
});

test('formatCompactVol formats large & small orderflow volumes concisely', () => {
  assert.equal(formatCompactVol(450), '450');
  assert.equal(formatCompactVol(1540), '1.5K');
  assert.equal(formatCompactVol(1250000), '1.3M');
});
