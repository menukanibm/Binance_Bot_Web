import assert from 'node:assert/strict';
import test from 'node:test';
import type {MsnrLevel, OrderFlowL3Snapshot} from '../types/trading.ts';
import {
  evaluateStrictConfluenceGate,
  OrderFlowEngine,
} from './orderFlowEngine.ts';

test('OrderFlowEngine distinguishes real fills from spoofing cancellations using aggTrade cross-reference', () => {
  const engine = new OrderFlowEngine('BTCUSDT', 'BINANCE', 2);
  const t0 = 1_700_000_000_000;

  // Initial L2 depth snapshot with resting bid and ask walls
  engine.ingestDepthDelta({
    isSnapshot: true,
    ts: t0,
    bids: [
      [94000, 12],
      [93990, 80], // Resting bid wall
      [93980, 10],
    ],
    asks: [
      [94010, 12],
      [94020, 95], // Large ask spoof wall
      [94030, 10],
    ],
  });

  // 1) Ask wall @ 94020 drops from 95 -> 5 with ZERO matching buy aggTrades => SPOOF_CANCEL!
  const snapAfterSpoof = engine.ingestDepthDelta({
    isSnapshot: false,
    ts: t0 + 100,
    bids: [],
    asks: [[94020, 5]],
  });

  assert.equal(snapAfterSpoof.spoofingDetected, true);
  assert.equal(snapAfterSpoof.opposingSpoofSide, 'ASK');
  assert.ok(snapAfterSpoof.cancelledSpoofQty >= 85);
  assert.equal(snapAfterSpoof.recentEvents[0]?.type, 'SPOOF_CANCEL');

  // 2) Bid wall @ 93990 drops from 80 -> 0 AFTER 78 BTC of real aggressive SELL aggTrades => REAL FILL, NOT spoof!
  engine.ingestAggTrade({
    symbol: 'BTCUSDT',
    exchange: 'BINANCE',
    price: 93990,
    qty: 78,
    side: 'SELL',
    ts: t0 + 180,
  });
  const snapAfterRealFill = engine.ingestDepthDelta({
    isSnapshot: false,
    ts: t0 + 210,
    bids: [[93990, 0]],
    asks: [],
  });

  // Spoof side must NOT flip to BID because 93990 was genuinely filled by aggTrade
  assert.equal(snapAfterRealFill.opposingSpoofSide, 'ASK');
});

test('OrderFlowEngine detects passive Buy Iceberg absorption & outputs BULLISH_L3_CONFIRMED', () => {
  const engine = new OrderFlowEngine('ETHUSDT', 'BINANCE', 2);
  const t0 = 1_700_000_010_000;

  engine.ingestDepthDelta({
    isSnapshot: true,
    ts: t0,
    bids: [
      [3400, 45],
      [3399, 30],
    ],
    asks: [
      [3401, 15],
      [3402, 12],
    ],
  });

  // Heavy aggressive selling hits $3400, yet resting bid reloads from 45 -> 52 (Passive Buy Iceberg!)
  engine.ingestAggTrade({
    symbol: 'ETHUSDT',
    exchange: 'BINANCE',
    price: 3400,
    qty: 28,
    side: 'SELL',
    ts: t0 + 50,
  });
  engine.ingestDepthDelta({
    isSnapshot: false,
    ts: t0 + 100,
    bids: [[3400, 52]],
    asks: [],
  });

  // Followed by aggressive buyer delta shift sweeping asks
  engine.ingestAggTrade({
    symbol: 'ETHUSDT',
    exchange: 'BINANCE',
    price: 3401,
    qty: 40,
    side: 'BUY',
    ts: t0 + 200,
  });
  engine.ingestAggTrade({
    symbol: 'ETHUSDT',
    exchange: 'BINANCE',
    price: 3402,
    qty: 25,
    side: 'BUY',
    ts: t0 + 220,
  });

  const snap = engine.ingestDepthDelta({
    isSnapshot: false,
    ts: t0 + 250,
    bids: [],
    asks: [
      [3401, 0],
      [3402, 0],
    ],
  });

  assert.equal(snap.absorptionDetected, true);
  assert.equal(snap.absorptionSide, 'BUY');
  assert.equal(snap.icebergPrice, 3400);
  assert.ok(snap.icebergReloadCount >= 1);
  assert.equal(snap.queueDepletionSide, 'ASK');
  assert.equal(snap.sweepLevelsCount, 2);
  assert.equal(snap.confirmationState, 'BULLISH_L3_CONFIRMED');
});

test('Strict Confluence Gatekeeper enforces non-negotiable MSNR + L3 AND-Gate (zero fake signals)', () => {
  const freshMsnrLevels: MsnrLevel[] = [
    {id: 'btc-4h-v', type: 'V', timeframe: '4h', price: 94000, fresh: true},
  ];

  const confirmedBullishL3: OrderFlowL3Snapshot = {
    symbol: 'BTCUSDT',
    exchange: 'BINANCE',
    l1: {
      bestBid: 94010,
      bestAsk: 94012,
      bestBidQty: 22,
      bestAskQty: 8,
      spread: 2,
      spreadBps: 0.21,
      midPrice: 94011,
      updatedAt: Date.now(),
    },
    l2BidWallPrice: 94000,
    l2BidWallQty: 85,
    l2AskWallPrice: 94120,
    l2AskWallQty: 25,
    l2TotalBidQty: 220,
    l2TotalAskQty: 95,
    addedLimitQty: 80,
    cancelledSpoofQty: 0,
    spoofingDetected: false,
    opposingSpoofSide: 'NONE',
    absorptionDetected: true,
    absorptionSide: 'BUY',
    icebergPrice: 94000,
    icebergReloadCount: 3,
    queueDepletionSide: 'ASK',
    sweepLevelsCount: 2,
    takerBuyVol: 140,
    takerSellVol: 60,
    takerDelta: 80,
    queueImbalanceScore: 62,
    confirmationState: 'BULLISH_L3_CONFIRMED',
    recentEvents: [],
    updatedAt: Date.now(),
  };

  const neutralL3: OrderFlowL3Snapshot = {
    ...confirmedBullishL3,
    absorptionDetected: false,
    absorptionSide: 'NONE',
    takerDelta: -5,
    queueImbalanceScore: 4,
    confirmationState: 'NEUTRAL',
  };

  // Case 1: MSNR valid, L3 NOT confirmed -> MUST block with "Waiting for L3 Confirmation"
  const msnrOnly = evaluateStrictConfluenceGate({
    bias: 'LONG',
    storyline4h: 'BULLISH',
    storyline1h: 'BULLISH',
    freshLevels: freshMsnrLevels,
    currentPrice: 94050,
    riskRewardRatio: 2.2,
    cleanTraffic: true,
    ltfReactionConfirmed: true,
    l3: neutralL3,
    apiKeyValid: true,
  });
  assert.equal(msnrOnly.msnrValid, true);
  assert.equal(msnrOnly.l3Confirmed, false);
  assert.equal(msnrOnly.canEmitSignal, false);
  assert.equal(msnrOnly.canAutoExecute, false);
  assert.equal(msnrOnly.rejectionCode, 'WAITING_FOR_L3');
  assert.equal(msnrOnly.rejectionLabel, 'Waiting for L3 Confirmation');

  // Case 2: L3 confirmed spike, NO valid MSNR zone -> MUST block with "No Valid MSNR Zone"
  const l3Only = evaluateStrictConfluenceGate({
    bias: 'LONG',
    storyline4h: 'BEARISH', // Storyline conflicts
    storyline1h: 'BEARISH',
    freshLevels: [],
    currentPrice: 94050,
    riskRewardRatio: 2.2,
    cleanTraffic: true,
    ltfReactionConfirmed: false,
    l3: confirmedBullishL3,
    apiKeyValid: true,
  });
  assert.equal(l3Only.msnrValid, false);
  assert.equal(l3Only.l3Confirmed, true);
  assert.equal(l3Only.canEmitSignal, false);
  assert.equal(l3Only.canAutoExecute, false);
  assert.equal(l3Only.rejectionCode, 'NO_VALID_MSNR');
  assert.equal(l3Only.rejectionLabel, 'No Valid MSNR Zone');

  // Case 3: Both MSNR + L3 valid, API key missing -> Signal visible, Auto-Execute BLOCKED
  const noApiKey = evaluateStrictConfluenceGate({
    bias: 'LONG',
    storyline4h: 'BULLISH',
    storyline1h: 'BULLISH',
    freshLevels: freshMsnrLevels,
    currentPrice: 94050,
    riskRewardRatio: 2.2,
    cleanTraffic: true,
    ltfReactionConfirmed: true,
    l3: confirmedBullishL3,
    apiKeyValid: false,
  });
  assert.equal(noApiKey.canEmitSignal, true);
  assert.equal(noApiKey.canAutoExecute, false);
  assert.equal(noApiKey.rejectionCode, 'API_KEY_REQUIRED');

  // Case 4: MSNR + L3 + API Key ALL true -> Emit Signal + Autonomous Execution Allowed!
  const allPass = evaluateStrictConfluenceGate({
    bias: 'LONG',
    storyline4h: 'BULLISH',
    storyline1h: 'BULLISH',
    freshLevels: freshMsnrLevels,
    currentPrice: 94050,
    riskRewardRatio: 2.2,
    cleanTraffic: true,
    ltfReactionConfirmed: true,
    l3: confirmedBullishL3,
    apiKeyValid: true,
  });
  assert.equal(allPass.msnrValid, true);
  assert.equal(allPass.l3Confirmed, true);
  assert.equal(allPass.canEmitSignal, true);
  assert.equal(allPass.canAutoExecute, true);
  assert.equal(allPass.rejectionCode, 'NONE');
});
