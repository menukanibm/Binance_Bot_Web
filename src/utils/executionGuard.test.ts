import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildBotClientOrderId,
  canExecuteTrade,
  evaluatePositionSlTpHit,
  filterBotOnlyPositions,
  hasVerifiedExchangeKey,
  MAKKA_BOT_CLIENT_ID_PREFIX,
} from './executionGuard.ts';
import type {Position} from '../types/trading.ts';

test('hasVerifiedExchangeKey validates exchange-matched encrypted key presence', () => {
  assert.equal(hasVerifiedExchangeKey([], 'BINANCE'), false);

  const binanceKey = {
    id: 'key-binance',
    exchange: 'BINANCE' as const,
    venue: 'Binance Futures',
    maskedKey: 'bnbL••••CDEF',
    encryptedPayload: 'AES-256-GCM.abc1234567890',
  };
  assert.equal(hasVerifiedExchangeKey([binanceKey], 'BINANCE'), true);
  assert.equal(hasVerifiedExchangeKey([binanceKey], 'MEXC'), false);
});

test('canExecuteTrade blocks execution when API key is missing or balance/size is $0', () => {
  const validKey = {
    id: 'key-binance',
    exchange: 'BINANCE' as const,
    venue: 'Binance Futures',
    maskedKey: 'bnbL••••CDEF',
    encryptedPayload: 'AES-256-GCM.abc1234567890',
  };

  const noKey = canExecuteTrade({
    apiKeys: [],
    activeExchange: 'BINANCE',
    accountBalance: 10000,
    tradingMode: 'PAPER',
    sizeUsd: 2000,
    marginUsd: 200,
  });
  assert.equal(noKey.allowed, false);
  assert.match(noKey.reason || '', /API Key Required/i);

  const zeroBalance = canExecuteTrade({
    apiKeys: [validKey],
    activeExchange: 'BINANCE',
    accountBalance: 0,
    tradingMode: 'LIVE',
    sizeUsd: 2000,
    marginUsd: 200,
  });
  assert.equal(zeroBalance.allowed, false);
  assert.match(zeroBalance.reason || '', /\$0\.00/);

  const zeroSize = canExecuteTrade({
    apiKeys: [validKey],
    activeExchange: 'BINANCE',
    accountBalance: 5000,
    tradingMode: 'LIVE',
    sizeUsd: 0,
    marginUsd: 0,
  });
  assert.equal(zeroSize.allowed, false);

  const ok = canExecuteTrade({
    apiKeys: [validKey],
    activeExchange: 'BINANCE',
    accountBalance: 5000,
    tradingMode: 'LIVE',
    sizeUsd: 2000,
    marginUsd: 200,
  });
  assert.equal(ok.allowed, true);
});

test('filterBotOnlyPositions strictly ignores manual exchange trades and retains MAKKA_BOT_ orders', () => {
  const botClientId = buildBotClientOrderId(1_700_000_000_000);
  assert.ok(botClientId.startsWith(MAKKA_BOT_CLIENT_ID_PREFIX));

  const botRegistry: Position[] = [
    {
      id: 'pos-bot-1',
      symbol: 'BTCUSDT',
      exchange: 'BINANCE',
      side: 'LONG',
      leverage: 10,
      entryPrice: 94000,
      markPrice: 94000,
      sizeUsd: 20000,
      marginUsd: 2000,
      stopLoss: 93530,
      takeProfit: 94940,
      unrealizedPnl: 0,
      roePercent: 0,
      status: 'OPEN',
      openedAt: 1_700_000_000_000,
      source: 'AUTO_MSNR',
      clientOrderId: botClientId,
      exchangeOrderId: 'EX-101',
      trackedByBot: true,
    },
  ];

  const exchangeLivePositions = [
    {
      // Bot-opened BTCUSDT
      symbol: 'BTCUSDT',
      side: 'LONG' as const,
      exchange: 'BINANCE' as const,
      entryPrice: 94000,
      markPrice: 94500,
      sizeUsd: 20000,
      marginUsd: 2000,
      leverage: 10,
      clientOrderId: botClientId,
      exchangeOrderId: 'EX-101',
    },
    {
      // Manual trade opened directly on Binance mobile app (NO MAKKA_BOT_ prefix, not in registry)
      symbol: 'SOLUSDT',
      side: 'SHORT' as const,
      exchange: 'BINANCE' as const,
      entryPrice: 210,
      markPrice: 208,
      sizeUsd: 15000,
      marginUsd: 1500,
      leverage: 10,
      clientOrderId: 'ios_manual_app_9988',
      exchangeOrderId: 'EX-MANUAL-777',
    },
  ];

  const filtered = filterBotOnlyPositions(exchangeLivePositions, botRegistry);
  assert.equal(filtered.ignoredManualCount, 1);
  assert.equal(filtered.botPositions.length, 1);
  assert.equal(filtered.botPositions[0].symbol, 'BTCUSDT');
  assert.equal(filtered.botPositions[0].clientOrderId, botClientId);
  assert.ok(filtered.botPositions[0].unrealizedPnl > 100);
});

test('evaluatePositionSlTpHit detects LONG and SHORT SL and TP hits accurately', () => {
  const longPos: Position = {
    id: 'pos-1',
    symbol: 'BTCUSDT',
    exchange: 'BINANCE',
    side: 'LONG',
    leverage: 10,
    entryPrice: 94000,
    markPrice: 94000,
    sizeUsd: 10000,
    marginUsd: 1000,
    stopLoss: 93530,
    takeProfit: 94940,
    unrealizedPnl: 0,
    roePercent: 0,
    status: 'OPEN',
    openedAt: Date.now(),
    source: 'AUTO_MSNR',
    trackedByBot: true,
  };

  assert.equal(evaluatePositionSlTpHit(longPos, 94100).hit, 'NONE');
  const slHit = evaluatePositionSlTpHit(longPos, 93500);
  assert.equal(slHit.hit, 'SL');
  assert.ok(slHit.realizedPnl < 0);

  const tpHit = evaluatePositionSlTpHit(longPos, 95000);
  assert.equal(tpHit.hit, 'TP');
  assert.ok(tpHit.realizedPnl > 100);
});
