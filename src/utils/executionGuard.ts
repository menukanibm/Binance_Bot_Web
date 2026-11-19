import type {
  ApiKeyRecord,
  ExchangeType,
  FirebaseExchangeKeyRecord,
  Position,
  TradingMode,
} from '../types/trading.ts';

export const MAKKA_BOT_CLIENT_ID_PREFIX = 'MAKKA_BOT_';

export interface GenericApiKeyEntry {
  id?: string;
  exchange?: ExchangeType;
  venue?: string;
  maskedKey?: string;
  encryptedPayload?: string;
}

export interface ExchangeOpenPositionInput {
  symbol: string;
  side: 'LONG' | 'SHORT';
  exchange: ExchangeType;
  entryPrice: number;
  markPrice: number;
  sizeUsd: number;
  marginUsd: number;
  leverage: number;
  clientOrderId?: string;
  exchangeOrderId?: string;
}

export function buildBotClientOrderId(now = Date.now()): string {
  return `${MAKKA_BOT_CLIENT_ID_PREFIX}${now.toString(36)}`;
}

export function hasVerifiedExchangeKey(
  apiKeys: ReadonlyArray<GenericApiKeyEntry | ApiKeyRecord | FirebaseExchangeKeyRecord>,
  activeExchange?: ExchangeType,
): boolean {
  if (!Array.isArray(apiKeys) || apiKeys.length === 0) return false;
  return apiKeys.some((k) => {
    if (!k) return false;
    const hasSecretMaterial =
      Boolean(k.encryptedPayload && k.encryptedPayload.trim().length > 8) &&
      Boolean(k.maskedKey && k.maskedKey.trim().length >= 4);
    if (!hasSecretMaterial) return false;

    const ex = k.exchange?.toUpperCase() || '';
    const venue = (k.venue || '').toUpperCase();
    const isBinanceOrMexc =
      ex === 'BINANCE' ||
      ex === 'MEXC' ||
      venue.includes('BINANCE') ||
      venue.includes('MEXC');
    if (!isBinanceOrMexc) return false;

    if (!activeExchange) return true;
    return ex === activeExchange || venue.includes(activeExchange);
  });
}

export function canExecuteTrade(params: {
  apiKeys: ReadonlyArray<GenericApiKeyEntry>;
  activeExchange: ExchangeType;
  accountBalance: number;
  tradingMode: TradingMode;
  sizeUsd?: number;
  marginUsd?: number;
}): {allowed: boolean; reason?: string} {
  if (!hasVerifiedExchangeKey(params.apiKeys, params.activeExchange)) {
    return {
      allowed: false,
      reason: `API Key Required to Trade: Connect valid ${params.activeExchange} Futures API credentials in Settings.`,
    };
  }

  if (!Number.isFinite(params.accountBalance) || params.accountBalance <= 0) {
    return {
      allowed: false,
      reason: 'Insufficient Wallet Balance ($0.00). Zero-size phantom positions are blocked.',
    };
  }

  if (
    (typeof params.sizeUsd === 'number' && params.sizeUsd <= 0) ||
    (typeof params.marginUsd === 'number' && params.marginUsd <= 0)
  ) {
    return {
      allowed: false,
      reason: 'Calculated position size is $0.00. Execution blocked.',
    };
  }

  return {allowed: true};
}

export function isBotTrackedPosition(pos: {
  clientOrderId?: string;
  exchangeOrderId?: string;
  trackedByBot?: boolean;
}): boolean {
  if (pos.clientOrderId && pos.clientOrderId.startsWith(MAKKA_BOT_CLIENT_ID_PREFIX)) {
    return true;
  }
  return Boolean(pos.trackedByBot);
}

/**
 * Strict order isolation filter:
 * Keeps ONLY positions whose clientOrderId carries the MAKKA_BOT_ prefix OR whose
 * exchangeOrderId / clientOrderId / symbol+side matches an existing bot-opened record
 * in Firebase /active_positions/{username}.
 * All manual Binance/MEXC app/web trades are completely ignored.
 */
export function filterBotOnlyPositions(
  exchangePositions: ExchangeOpenPositionInput[],
  botRegistry: Position[],
): {
  botPositions: Position[];
  ignoredManualCount: number;
} {
  const registryByOrderId = new Map<string, Position>();
  const registryByClientOrderId = new Map<string, Position>();
  for (const reg of botRegistry) {
    if (!reg || reg.status !== 'OPEN') continue;
    if (!isBotTrackedPosition(reg)) continue;
    if (reg.exchangeOrderId) registryByOrderId.set(reg.exchangeOrderId, reg);
    if (reg.clientOrderId) registryByClientOrderId.set(reg.clientOrderId, reg);
  }

  const botPositions: Position[] = [];
  let ignoredManualCount = 0;

  for (const exPos of exchangePositions) {
    if (!exPos || exPos.sizeUsd <= 0) continue;

    const matchedByClient = exPos.clientOrderId
      ? registryByClientOrderId.get(exPos.clientOrderId)
      : undefined;
    const matchedByOrderId = exPos.exchangeOrderId
      ? registryByOrderId.get(exPos.exchangeOrderId)
      : undefined;
    const hasBotPrefix = Boolean(
      exPos.clientOrderId && exPos.clientOrderId.startsWith(MAKKA_BOT_CLIENT_ID_PREFIX),
    );

    const matched = matchedByClient || matchedByOrderId;
    if (!matched && !hasBotPrefix) {
      ignoredManualCount += 1;
      continue;
    }

    const entry = matched?.entryPrice ?? exPos.entryPrice;
    const size = matched?.sizeUsd ?? exPos.sizeUsd;
    const margin = matched?.marginUsd ?? exPos.marginUsd;
    const diffRatio =
      exPos.side === 'LONG'
        ? (exPos.markPrice - entry) / Math.max(entry, 0.0001)
        : (entry - exPos.markPrice) / Math.max(entry, 0.0001);
    const unrealizedPnl = Number((size * diffRatio).toFixed(2));
    const roePercent = margin > 0 ? Number(((unrealizedPnl / margin) * 100).toFixed(2)) : 0;

    botPositions.push({
      ...(matched || {
        id: `pos-${exPos.clientOrderId || exPos.exchangeOrderId || Date.now().toString(36)}`,
        symbol: exPos.symbol,
        exchange: exPos.exchange,
        side: exPos.side,
        leverage: exPos.leverage,
        entryPrice: entry,
        stopLoss:
          exPos.side === 'LONG'
            ? Number((entry * 0.995).toFixed(4))
            : Number((entry * 1.005).toFixed(4)),
        takeProfit:
          exPos.side === 'LONG'
            ? Number((entry * 1.01).toFixed(4))
            : Number((entry * 0.99).toFixed(4)),
        openedAt: Date.now(),
        source: 'AUTO_MSNR' as const,
      }),
      clientOrderId: exPos.clientOrderId || matched?.clientOrderId,
      exchangeOrderId: exPos.exchangeOrderId || matched?.exchangeOrderId,
      trackedByBot: true,
      markPrice: exPos.markPrice,
      sizeUsd: size,
      marginUsd: margin,
      unrealizedPnl,
      roePercent,
      status: 'OPEN',
    });
  }

  return {botPositions, ignoredManualCount};
}

export function evaluatePositionSlTpHit(
  pos: Position,
  markPrice: number,
): {hit: 'NONE' | 'SL' | 'TP'; realizedPnl: number; closeReason: string} {
  if (!Number.isFinite(markPrice) || markPrice <= 0 || pos.entryPrice <= 0) {
    return {hit: 'NONE', realizedPnl: 0, closeReason: ''};
  }

  const diffRatio =
    pos.side === 'LONG'
      ? (markPrice - pos.entryPrice) / pos.entryPrice
      : (pos.entryPrice - markPrice) / pos.entryPrice;
  const pnlAtMark = Number((pos.sizeUsd * diffRatio).toFixed(2));

  if (pos.side === 'LONG') {
    if (pos.stopLoss > 0 && markPrice <= pos.stopLoss) {
      return {
        hit: 'SL',
        realizedPnl: pnlAtMark,
        closeReason: `Stop Loss Hit @ $${markPrice}`,
      };
    }
    if (pos.takeProfit > 0 && markPrice >= pos.takeProfit) {
      return {
        hit: 'TP',
        realizedPnl: pnlAtMark,
        closeReason: `TP 1:2 R:R Hit @ $${markPrice}`,
      };
    }
  } else {
    if (pos.stopLoss > 0 && markPrice >= pos.stopLoss) {
      return {
        hit: 'SL',
        realizedPnl: pnlAtMark,
        closeReason: `Stop Loss Hit @ $${markPrice}`,
      };
    }
    if (pos.takeProfit > 0 && markPrice <= pos.takeProfit) {
      return {
        hit: 'TP',
        realizedPnl: pnlAtMark,
        closeReason: `TP 1:2 R:R Hit @ $${markPrice}`,
      };
    }
  }

  return {hit: 'NONE', realizedPnl: pnlAtMark, closeReason: ''};
}
