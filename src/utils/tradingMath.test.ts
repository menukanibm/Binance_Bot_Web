import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeMsnrFootprint,
  calculatePositionSizing,
  calculateUnrealizedPnL,
  clampStopLossPercent,
  computeGoldenPocket,
  computeVolumeProfile,
  detectSMCZones,
  generateCandles,
  generateFootprintCandles,
  isStrictBinanceCryptoPerpetual,
} from './tradingMath.ts';

test('clamps stop loss percentage between 0.25% and 1.20%', () => {
  assert.equal(clampStopLossPercent(0.1), 0.25);
  assert.equal(clampStopLossPercent(2.5), 1.2);
  assert.equal(clampStopLossPercent(0.75), 0.75);
});

test('calculates 1:2 R:R position sizing accurately for LONG and SHORT', () => {
  const longCalc = calculatePositionSizing({
    accountBalance: 25000,
    riskPercent: 1,
    stopLossPercent: 0.5,
    entryPrice: 94000,
    side: 'LONG',
    leverage: 20,
  });
  assert.equal(longCalc.riskUsd, 250);
  assert.equal(longCalc.rewardUsd, 500);
  assert.equal(longCalc.positionSizeUsd, 50000);
  assert.equal(longCalc.marginRequiredUsd, 2500);
  assert.equal(Number(longCalc.stopLossPrice.toFixed(2)), 93530);
  assert.equal(Number(longCalc.takeProfitPrice.toFixed(2)), 94940);

  const shortCalc = calculatePositionSizing({
    accountBalance: 10000,
    riskPercent: 2,
    stopLossPercent: 1.0,
    entryPrice: 2500,
    side: 'SHORT',
    leverage: 10,
  });
  assert.equal(shortCalc.riskUsd, 200);
  assert.equal(shortCalc.rewardUsd, 400);
  assert.equal(shortCalc.positionSizeUsd, 20000);
  assert.equal(Number(shortCalc.stopLossPrice.toFixed(2)), 2525);
  assert.equal(Number(shortCalc.takeProfitPrice.toFixed(2)), 2450);
});

test('calculates unrealized PnL and ROE percentage', () => {
  const pnl = calculateUnrealizedPnL(
    {side: 'LONG', entryPrice: 100, sizeUsd: 10000, marginUsd: 1000},
    102,
  );
  assert.equal(pnl.pnlUsd, 200);
  assert.equal(pnl.roePct, 20);
});

test('generates footprint candles, MSNR analysis, and crypto perpetual filter', () => {
  const candles = generateFootprintCandles('BTCUSDT', 16, 0);
  assert.equal(candles.length, 16);
  assert.ok(candles.every((c) => c.levels.length >= 3));

  const smc = detectSMCZones(candles);
  assert.ok(smc.length >= 2);

  const gp = computeGoldenPocket(candles, 2);
  assert.ok(gp.swingHigh > gp.swingLow);
  assert.ok(gp.fib618 > gp.fib650);

  const vp = computeVolumeProfile(candles, 2);
  assert.ok(vp.vahPrice >= vp.pocPrice);
  assert.ok(vp.pocPrice >= vp.valPrice);

  const rawCandles = generateCandles('BTCUSDT', '15m', 24);
  const msnr = analyzeMsnrFootprint('BTCUSDT', 'BINANCE', '15m', rawCandles, 0.5);
  assert.equal(msnr.symbol, 'BTCUSDT');
  assert.ok(msnr.freshLevels.length + msnr.unfreshLevels.length >= 2);
  assert.ok(msnr.riskRewardRatio >= 2.0);
  assert.ok(msnr.structureEvent);
  assert.ok(msnr.footprintTrend);
  assert.ok(typeof msnr.winProbabilityPct === 'number' && msnr.winProbabilityPct >= 0);
  assert.ok((msnr.confluenceGate?.checks?.length ?? 0) >= 8);
  assert.ok(msnr.goldenPocketZone && msnr.goldenPocketZone.fib618 > msnr.goldenPocketZone.fib650);

  assert.equal(isStrictBinanceCryptoPerpetual('BTCUSDT'), true);
  assert.equal(isStrictBinanceCryptoPerpetual('TSLAUSDT'), false);
});
