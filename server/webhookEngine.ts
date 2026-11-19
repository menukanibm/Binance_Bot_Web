import crypto from 'node:crypto';
import type {
  ExchangeType,
  FirebaseActivePositionsNode,
  FirebaseBotSettingsNode,
  FirebaseExchangeKeyRecord,
  FirebaseLiveSignalsNode,
  FirebaseUserRecord,
  Position,
  TradeSignal,
} from '../src/types/trading.ts';
import {
  DEFAULT_FIREBASE_RTDB_URL,
  encodeUsernameKey,
  normalizeRtdbUrl,
} from '../src/services/firebaseRtdb.ts';
import {isAccountExpired} from '../src/utils/authLogic.ts';
import {
  calculatePositionSizing,
  clampStopLossPercent,
  getPairMeta,
} from '../src/utils/tradingMath.ts';
import {
  buildBotClientOrderId,
  canExecuteTrade,
  hasVerifiedExchangeKey,
  isBotTrackedPosition,
} from '../src/utils/executionGuard.ts';
import {decryptExchangeKeysServer} from './vaultCrypto.ts';

export interface IncomingWebhookPayload {
  source?: string;
  username?: string;
  exchange?: string;
  symbol?: string;
  timeframe?: string;
  side?: string;
  orderType?: 'MARKET' | 'LIMIT';
  entryPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
  riskRewardRatio?: number;
  reasoning?: string;
  secret?: string;
}

export interface ParsedWebhookSignal {
  symbol: string;
  exchange: ExchangeType;
  side: 'LONG' | 'SHORT';
  orderType: 'MARKET' | 'LIMIT';
  timeframe: string;
  entryPrice: number;
  stopLossPercent: number;
  stopLoss: number;
  takeProfit: number;
  riskRewardRatio: number;
  reasoning: string;
  targetUsername?: string;
}

export interface UserExecutionResult {
  username: string;
  exchange: ExchangeType;
  mode: 'PAPER' | 'LIVE';
  status: 'EXECUTED' | 'SKIPPED' | 'EXCHANGE_ERROR';
  orderId?: string;
  reason: string;
  position?: Position;
}

export interface WebhookDispatchResult {
  ok: boolean;
  signal: ParsedWebhookSignal;
  executedCount: number;
  results: UserExecutionResult[];
}

export function getServerRtdbUrl(): string {
  return (
    normalizeRtdbUrl(process.env.FIREBASE_RTDB_URL) ||
    normalizeRtdbUrl(process.env.VITE_FIREBASE_RTDB_URL) ||
    DEFAULT_FIREBASE_RTDB_URL
  );
}

export function parseWebhookSignal(body: IncomingWebhookPayload): ParsedWebhookSignal {
  const symbolRaw = String(body.symbol || 'BTCUSDT')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  const symbol = symbolRaw || 'BTCUSDT';
  const meta = getPairMeta(symbol);

  const sideRaw = String(body.side || 'LONG').toUpperCase().trim();
  const side: 'LONG' | 'SHORT' =
    sideRaw === 'SHORT' || sideRaw === 'SELL' ? 'SHORT' : 'LONG';

  const exchangeRaw = String(body.exchange || 'BINANCE').toUpperCase();
  const exchange: ExchangeType = exchangeRaw.includes('MEXC') ? 'MEXC' : 'BINANCE';

  const orderType: 'MARKET' | 'LIMIT' =
    String(body.orderType || 'MARKET').toUpperCase() === 'LIMIT' ? 'LIMIT' : 'MARKET';

  const entryPrice =
    typeof body.entryPrice === 'number' && body.entryPrice > 0
      ? Number(body.entryPrice.toFixed(meta.decimals))
      : meta.basePrice;

  let rawSlPercent = 0.5;
  if (typeof body.stopLoss === 'number' && body.stopLoss > 0) {
    rawSlPercent = Math.abs(entryPrice - body.stopLoss) / entryPrice * 100;
  }
  const stopLossPercent = clampStopLossPercent(rawSlPercent);
  const slFrac = stopLossPercent / 100;
  const rr = Math.max(2.0, Number(body.riskRewardRatio || 2.0));
  const tpFrac = slFrac * rr;

  const stopLoss = Number(
    (side === 'LONG' ? entryPrice * (1 - slFrac) : entryPrice * (1 + slFrac)).toFixed(
      meta.decimals,
    ),
  );
  const takeProfit = Number(
    (side === 'LONG' ? entryPrice * (1 + tpFrac) : entryPrice * (1 - tpFrac)).toFixed(
      meta.decimals,
    ),
  );

  return {
    symbol,
    exchange,
    side,
    orderType,
    timeframe: String(body.timeframe || '15m'),
    entryPrice,
    stopLossPercent,
    stopLoss,
    takeProfit,
    riskRewardRatio: Number(rr.toFixed(2)),
    reasoning:
      String(body.reasoning || '').trim() ||
      `Auto-Webhook ${side} ${symbol} (${stopLossPercent.toFixed(2)}% SL / 1:${rr.toFixed(1)} R:R)`,
    targetUsername: body.username?.trim() || undefined,
  };
}

export async function placeSignedFuturesOrder(params: {
  exchange: ExchangeType;
  symbol: string;
  side: 'LONG' | 'SHORT';
  orderType: 'MARKET' | 'LIMIT';
  quantity: number;
  entryPrice: number;
  leverage: number;
  apiKey: string;
  apiSecret: string;
  clientOrderId: string;
}): Promise<{ok: boolean; orderId?: string; fillPrice?: number; error?: string}> {
  if (params.exchange === 'BINANCE') {
    const timestamp = Date.now();
    const qs = new URLSearchParams({
      symbol: params.symbol,
      side: params.side === 'LONG' ? 'BUY' : 'SELL',
      type: params.orderType,
      quantity: String(Math.max(0.001, Number(params.quantity.toFixed(3)))),
      newClientOrderId: params.clientOrderId,
      timestamp: String(timestamp),
    });
    if (params.orderType === 'LIMIT') {
      qs.set('timeInForce', 'GTC');
      qs.set('price', String(params.entryPrice));
    }
    const signature = crypto
      .createHmac('sha256', params.apiSecret)
      .update(qs.toString())
      .digest('hex');
    qs.set('signature', signature);

    const res = await fetch(`https://fapi.binance.com/fapi/v1/order?${qs.toString()}`, {
      method: 'POST',
      headers: {'X-MBX-APIKEY': params.apiKey},
      signal: AbortSignal.timeout(6500),
    });
    const data = (await res.json().catch(() => ({}))) as {
      orderId?: number | string;
      avgPrice?: string;
      msg?: string;
      code?: number;
    };
    if (!res.ok) {
      return {
        ok: false,
        error: `Binance HTTP ${res.status}: ${data.msg || 'Order rejected'}`,
      };
    }
    return {
      ok: true,
      orderId: String(data.orderId || params.clientOrderId),
      fillPrice: Number(data.avgPrice) > 0 ? Number(data.avgPrice) : params.entryPrice,
    };
  }

  // MEXC Contract Futures Signed Order
  const reqTime = String(Date.now());
  const mexcSymbol = params.symbol.endsWith('USDT')
    ? `${params.symbol.slice(0, -4)}_USDT`
    : params.symbol;
  const payloadObj = {
    symbol: mexcSymbol,
    price: params.entryPrice,
    vol: Math.max(1, Math.round(params.quantity)),
    leverage: params.leverage,
    side: params.side === 'LONG' ? 1 : 3, // 1 = open long, 3 = open short
    type: params.orderType === 'LIMIT' ? 1 : 5, // 1 = limit, 5 = market
    openType: 1, // 1 = ISOLATED
    externalOid: params.clientOrderId,
  };
  const bodyJson = JSON.stringify(payloadObj);
  const signTarget = `${params.apiKey}${reqTime}${bodyJson}`;
  const signature = crypto
    .createHmac('sha256', params.apiSecret)
    .update(signTarget)
    .digest('hex');

  const res = await fetch('https://contract.mexc.com/api/v1/private/order/submit', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ApiKey: params.apiKey,
      'Request-Time': reqTime,
      Signature: signature,
    },
    body: bodyJson,
    signal: AbortSignal.timeout(6500),
  });
  const data = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    data?: string | number;
    message?: string;
  };
  if (!res.ok || data.success === false) {
    return {
      ok: false,
      error: `MEXC HTTP ${res.status}: ${data.message || 'Order rejected'}`,
    };
  }
  return {
    ok: true,
    orderId: String(data.data || params.clientOrderId),
    fillPrice: params.entryPrice,
  };
}

export interface WebhookEngineDeps {
  rtdbUrl?: string;
  executeOrder?: typeof placeSignedFuturesOrder;
}

export async function handleWebhookDispatch(
  body: IncomingWebhookPayload,
  deps?: WebhookEngineDeps,
): Promise<WebhookDispatchResult> {
  const signal = parseWebhookSignal(body);
  const rtdbUrl = deps?.rtdbUrl || getServerRtdbUrl();
  const orderExecutor = deps?.executeOrder || placeSignedFuturesOrder;

  const [usersRes, settingsRes, liveSignalsRes] = await Promise.all([
    fetch(`${rtdbUrl}/users.json`, {signal: AbortSignal.timeout(5000)}).then((r) =>
      r.ok ? (r.json() as Promise<Record<string, FirebaseUserRecord & {exchangeKeys?: Record<string, FirebaseExchangeKeyRecord>}> | null>) : null,
    ),
    fetch(`${rtdbUrl}/bot_settings.json`, {signal: AbortSignal.timeout(5000)}).then((r) =>
      r.ok ? (r.json() as Promise<Record<string, Partial<FirebaseBotSettingsNode>> | null>) : null,
    ),
    fetch(`${rtdbUrl}/live_signals.json`, {signal: AbortSignal.timeout(5000)}).then((r) =>
      r.ok ? (r.json() as Promise<Record<string, Partial<FirebaseLiveSignalsNode>> | null>) : null,
    ),
  ]);

  const usersMap = usersRes || {};
  const settingsMap = settingsRes || {};
  const liveSignalsMap = liveSignalsRes || {};

  const results: UserExecutionResult[] = [];
  let executedCount = 0;

  for (const [username, userRec] of Object.entries(usersMap)) {
    if (!userRec) continue;
    if (
      signal.targetUsername &&
      username.toLowerCase() !== signal.targetUsername.toLowerCase()
    ) {
      continue;
    }

    const keysMap = userRec.exchangeKeys || {};
    const keyEntries = Object.values(keysMap);
    if (keyEntries.length === 0) continue;

    if (userRec.isActive === false) {
      results.push({
        username,
        exchange: signal.exchange,
        mode: 'LIVE',
        status: 'SKIPPED',
        reason: 'Account suspended',
      });
      continue;
    }

    if (isAccountExpired(userRec.expiryDate)) {
      results.push({
        username,
        exchange: signal.exchange,
        mode: 'LIVE',
        status: 'SKIPPED',
        reason: 'Account expired',
      });
      continue;
    }

    const userSettings = settingsMap[username] || {};
    const targetExchange: ExchangeType = userSettings.activeExchange || signal.exchange;
    const tradingMode: 'PAPER' | 'LIVE' = userSettings.tradingMode === 'LIVE' ? 'LIVE' : 'PAPER';

    if (userSettings.autoTrade === false) {
      results.push({
        username,
        exchange: targetExchange,
        mode: tradingMode,
        status: 'SKIPPED',
        reason: 'Auto-Trade toggled OFF in user settings',
      });
      continue;
    }

    if (!hasVerifiedExchangeKey(keyEntries, targetExchange)) {
      results.push({
        username,
        exchange: targetExchange,
        mode: tradingMode,
        status: 'SKIPPED',
        reason: `API Key Required to Trade: No verified ${targetExchange} key configured`,
      });
      continue;
    }

    const matchedKey =
      keyEntries.find((k) => k.exchange === targetExchange) || keyEntries[0];

    let creds: {apiKey: string; apiSecret: string};
    try {
      creds = decryptExchangeKeysServer(matchedKey.encryptedPayload);
    } catch (err) {
      results.push({
        username,
        exchange: targetExchange,
        mode: tradingMode,
        status: 'SKIPPED',
        reason: `Vault decryption failed: ${(err as Error).message}`,
      });
      continue;
    }

    const userLiveNode = liveSignalsMap[username] || {};
    const rawOpen: Position[] = Array.isArray(userLiveNode.openPositions)
      ? userLiveNode.openPositions
      : [];
    const currentOpen = rawOpen.filter((p) => isBotTrackedPosition(p));

    if (currentOpen.length >= 3) {
      results.push({
        username,
        exchange: targetExchange,
        mode: tradingMode,
        status: 'SKIPPED',
        reason: 'Max 3 concurrent open positions reached',
      });
      continue;
    }

    if (currentOpen.some((p) => p.symbol === signal.symbol)) {
      results.push({
        username,
        exchange: targetExchange,
        mode: tradingMode,
        status: 'SKIPPED',
        reason: `Active ${signal.symbol} position already open`,
      });
      continue;
    }

    const leverage = Math.max(1, userSettings.leverage ?? 10);
    const riskPercent = Math.min(5, Math.max(0.25, userSettings.riskPercent ?? 1));
    const slPercent = clampStopLossPercent(userSettings.stopLoss ?? signal.stopLossPercent);
    const balance =
      typeof userLiveNode.accountBalance === 'number'
        ? userLiveNode.accountBalance
        : tradingMode === 'PAPER'
          ? 10000
          : 0;

    const sizing = calculatePositionSizing({
      accountBalance: balance,
      riskPercent,
      stopLossPercent: slPercent,
      entryPrice: signal.entryPrice,
      side: signal.side,
      leverage,
    });

    const guardCheck = canExecuteTrade({
      apiKeys: keyEntries,
      activeExchange: targetExchange,
      accountBalance: balance,
      tradingMode,
      sizeUsd: sizing.positionSizeUsd,
      marginUsd: sizing.marginRequiredUsd,
    });
    if (!guardCheck.allowed) {
      results.push({
        username,
        exchange: targetExchange,
        mode: tradingMode,
        status: 'SKIPPED',
        reason: guardCheck.reason || 'Execution blocked by trade gatekeeper',
      });
      continue;
    }

    const clientOrderId = buildBotClientOrderId();
    let orderId = clientOrderId;
    let fillPrice = signal.entryPrice;

    if (tradingMode === 'LIVE') {
      const exRes = await orderExecutor({
        exchange: targetExchange,
        symbol: signal.symbol,
        side: signal.side,
        orderType: signal.orderType,
        quantity: sizing.quantityUnits,
        entryPrice: signal.entryPrice,
        leverage,
        apiKey: creds.apiKey,
        apiSecret: creds.apiSecret,
        clientOrderId,
      });

      if (!exRes.ok) {
        results.push({
          username,
          exchange: targetExchange,
          mode: 'LIVE',
          status: 'EXCHANGE_ERROR',
          reason: exRes.error || 'Exchange rejected live order',
        });
        continue;
      }
      orderId = exRes.orderId || clientOrderId;
      fillPrice = exRes.fillPrice || signal.entryPrice;
    }

    const meta = getPairMeta(signal.symbol);
    const newPosition: Position = {
      id: `pos-${orderId}`,
      symbol: signal.symbol,
      exchange: targetExchange,
      side: signal.side,
      leverage,
      entryPrice: fillPrice,
      markPrice: fillPrice,
      sizeUsd: sizing.positionSizeUsd,
      marginUsd: sizing.marginRequiredUsd,
      stopLoss: Number(sizing.stopLossPrice.toFixed(meta.decimals)),
      takeProfit: Number(sizing.takeProfitPrice.toFixed(meta.decimals)),
      unrealizedPnl: 0,
      roePercent: 0,
      status: 'OPEN',
      openedAt: Date.now(),
      source: 'AUTO_MSNR',
      clientOrderId,
      exchangeOrderId: orderId,
      trackedByBot: true,
    };

    const newSignal: TradeSignal = {
      id: `sig-${orderId}`,
      symbol: signal.symbol,
      exchange: targetExchange,
      side: signal.side,
      entryPrice: fillPrice,
      stopLoss: newPosition.stopLoss,
      takeProfit: newPosition.takeProfit,
      riskRewardRatio: signal.riskRewardRatio,
      slDistancePercent: slPercent,
      engulfingTimeframe: signal.timeframe === '5m' ? '5m' : '15m',
      isStopHuntEngulfing: true,
      confluenceScore: 3,
      msnrLevelLabel: `AUTO WEBHOOK ${signal.side}`,
      reasoning: signal.reasoning,
      timestamp: Date.now(),
      status: 'EXECUTED',
    };

    const nextOpen = [newPosition, ...currentOpen];
    const currentSignals = Array.isArray(userLiveNode.signals) ? userLiveNode.signals : [];
    const nextSignals = [newSignal, ...currentSignals].slice(0, 25);

    const resolvedBalance =
      typeof userLiveNode.accountBalance === 'number'
        ? userLiveNode.accountBalance
        : tradingMode === 'PAPER'
          ? 10000
          : 0;

    const livePatch: Partial<FirebaseLiveSignalsNode> = {
      tradingMode,
      activeSymbol: signal.symbol,
      activeExchange: targetExchange,
      footprintTrend: signal.side === 'LONG' ? 'BULLISH_IMBALANCE' : 'BEARISH_IMBALANCE',
      openPosition: `${newPosition.symbol} ${newPosition.side} ${newPosition.leverage}x`,
      openPositions: nextOpen,
      latestSignal: newSignal,
      signals: nextSignals,
      accountBalance: resolvedBalance,
      updatedAt: Date.now(),
    };

    const totalUnrealizedPnl = Number(
      nextOpen.reduce((sum, p) => sum + (p.unrealizedPnl || 0), 0).toFixed(2),
    );
    const closedList = Array.isArray(userLiveNode.closedPositions)
      ? userLiveNode.closedPositions
      : [];
    const realizedPnl = Number(
      closedList.reduce((sum, p) => sum + (p.realizedPnl ?? 0), 0).toFixed(2),
    );

    const activePosPatch: FirebaseActivePositionsNode = {
      username,
      tradingMode,
      activeExchange: targetExchange,
      accountBalance: resolvedBalance,
      totalUnrealizedPnl,
      realizedPnl,
      openPositions: nextOpen,
      closedPositions: closedList,
      lastExecutionReason: `Auto-executed ${signal.side} ${signal.symbol} @ $${fillPrice}`,
      updatedAt: Date.now(),
    };

    const userKey = encodeUsernameKey(username);
    await Promise.all([
      fetch(`${rtdbUrl}/live_signals/${userKey}.json`, {
        method: 'PATCH',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(livePatch),
        signal: AbortSignal.timeout(5000),
      }),
      fetch(`${rtdbUrl}/active_positions/${userKey}.json`, {
        method: 'PATCH',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(activePosPatch),
        signal: AbortSignal.timeout(5000),
      }),
    ]);

    executedCount += 1;
    results.push({
      username,
      exchange: targetExchange,
      mode: tradingMode,
      status: 'EXECUTED',
      orderId,
      reason: `Auto-executed ${signal.side} ${signal.symbol} (${slPercent.toFixed(2)}% SL / 1:${signal.riskRewardRatio} R:R)`,
      position: newPosition,
    });
  }

  return {
    ok: true,
    signal,
    executedCount,
    results,
  };
}
