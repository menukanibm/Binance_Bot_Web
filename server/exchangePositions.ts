import crypto from 'node:crypto';
import type {
  ExchangeType,
  FirebaseActivePositionsNode,
  FirebaseExchangeKeyRecord,
  FirebaseLiveSignalsNode,
  Position,
} from '../src/types/trading.ts';
import {encodeUsernameKey} from '../src/services/firebaseRtdb.ts';
import {
  filterBotOnlyPositions,
  hasVerifiedExchangeKey,
  isBotTrackedPosition,
  type ExchangeOpenPositionInput,
} from '../src/utils/executionGuard.ts';
import {decryptExchangeKeysServer} from './vaultCrypto.ts';
import {getServerRtdbUrl} from './webhookEngine.ts';

interface BinancePositionRiskItem {
  symbol: string;
  positionAmt: string;
  entryPrice: string;
  markPrice: string;
  leverage: string;
  isolatedMargin: string;
}

interface BinanceOpenOrderItem {
  symbol: string;
  orderId: number | string;
  clientOrderId: string;
  side: string;
}

interface MexcPositionItem {
  symbol: string;
  holdVol: number;
  positionType: number; // 1 = long, 2 = short
  openAvgPrice: number;
  markPrice?: number;
  leverage: number;
  im: number; // initial margin
  positionId?: number | string;
  externalOid?: string;
}

export async function fetchExchangeOpenPositions(params: {
  exchange: ExchangeType;
  apiKey: string;
  apiSecret: string;
}): Promise<{ok: boolean; positions: ExchangeOpenPositionInput[]; error?: string}> {
  try {
    if (params.exchange === 'BINANCE') {
      const ts = Date.now();
      const qs = new URLSearchParams({timestamp: String(ts)});
      const sig = crypto.createHmac('sha256', params.apiSecret).update(qs.toString()).digest('hex');
      qs.set('signature', sig);

      const qsOrders = new URLSearchParams({timestamp: String(ts)});
      const sigOrders = crypto
        .createHmac('sha256', params.apiSecret)
        .update(qsOrders.toString())
        .digest('hex');
      qsOrders.set('signature', sigOrders);

      const [posRes, ordRes] = await Promise.all([
        fetch(`https://fapi.binance.com/fapi/v2/positionRisk?${qs.toString()}`, {
          headers: {'X-MBX-APIKEY': params.apiKey},
          signal: AbortSignal.timeout(5500),
        }),
        fetch(`https://fapi.binance.com/fapi/v1/openOrders?${qsOrders.toString()}`, {
          headers: {'X-MBX-APIKEY': params.apiKey},
          signal: AbortSignal.timeout(5500),
        }).catch(() => null),
      ]);

      if (!posRes.ok) {
        return {ok: false, positions: [], error: `Binance positionRisk HTTP ${posRes.status}`};
      }

      const rawPositions = (await posRes.json()) as BinancePositionRiskItem[];
      const rawOrders =
        ordRes && ordRes.ok ? ((await ordRes.json()) as BinanceOpenOrderItem[]) : [];

      const mapped: ExchangeOpenPositionInput[] = [];
      for (const p of rawPositions) {
        const amt = Number(p.positionAmt || 0);
        if (Math.abs(amt) <= 0) continue;
        const entryPrice = Number(p.entryPrice || 0);
        const markPrice = Number(p.markPrice || entryPrice);
        const leverage = Math.max(1, Number(p.leverage || 10));
        const sizeUsd = Number((Math.abs(amt) * entryPrice).toFixed(2));
        const marginUsd =
          Number(p.isolatedMargin || 0) > 0
            ? Number(Number(p.isolatedMargin).toFixed(2))
            : Number((sizeUsd / leverage).toFixed(2));

        const matchedOrder = rawOrders.find((o) => o.symbol === p.symbol);
        mapped.push({
          symbol: p.symbol,
          side: amt > 0 ? 'LONG' : 'SHORT',
          exchange: 'BINANCE',
          entryPrice,
          markPrice,
          sizeUsd,
          marginUsd,
          leverage,
          clientOrderId: matchedOrder?.clientOrderId,
          exchangeOrderId: matchedOrder ? String(matchedOrder.orderId) : undefined,
        });
      }
      return {ok: true, positions: mapped};
    }

    // MEXC Contract Futures Open Positions
    const reqTime = String(Date.now());
    const signTarget = `${params.apiKey}${reqTime}`;
    const signature = crypto
      .createHmac('sha256', params.apiSecret)
      .update(signTarget)
      .digest('hex');

    const res = await fetch('https://contract.mexc.com/api/v1/private/position/open_positions', {
      headers: {
        ApiKey: params.apiKey,
        'Request-Time': reqTime,
        Signature: signature,
      },
      signal: AbortSignal.timeout(5500),
    });

    if (!res.ok) {
      return {ok: false, positions: [], error: `MEXC open_positions HTTP ${res.status}`};
    }
    const json = (await res.json()) as {success?: boolean; data?: MexcPositionItem[]};
    if (!json.success || !Array.isArray(json.data)) {
      return {ok: false, positions: [], error: 'Invalid MEXC position payload'};
    }

    const mapped: ExchangeOpenPositionInput[] = json.data
      .filter((p) => Number(p.holdVol || 0) > 0)
      .map((p) => {
        const cleanSymbol = p.symbol.replace('_', '');
        const entry = Number(p.openAvgPrice || 0);
        const mark = Number(p.markPrice || entry);
        const lev = Math.max(1, Number(p.leverage || 10));
        const sizeUsd = Number((Math.abs(p.holdVol) * entry).toFixed(2));
        const marginUsd =
          Number(p.im || 0) > 0 ? Number(p.im.toFixed(2)) : Number((sizeUsd / lev).toFixed(2));
        return {
          symbol: cleanSymbol,
          side: p.positionType === 1 ? 'LONG' : 'SHORT',
          exchange: 'MEXC',
          entryPrice: entry,
          markPrice: mark,
          sizeUsd,
          marginUsd,
          leverage: lev,
          clientOrderId: p.externalOid,
          exchangeOrderId: p.positionId ? String(p.positionId) : undefined,
        };
      });

    return {ok: true, positions: mapped};
  } catch (err) {
    return {ok: false, positions: [], error: (err as Error).message};
  }
}

export async function syncBotPositionsForUser(params: {
  username: string;
  exchange: ExchangeType;
  rtdbUrl?: string;
  overrideExchangePositions?: ExchangeOpenPositionInput[];
}): Promise<{
  ok: boolean;
  hasVerifiedKey: boolean;
  botPositions: Position[];
  ignoredManualCount: number;
  reason?: string;
}> {
  const rtdbUrl = params.rtdbUrl || getServerRtdbUrl();
  const userKey = encodeUsernameKey(params.username.trim());

  const [keysRes, activePosRes, liveSigRes] = await Promise.all([
    fetch(`${rtdbUrl}/users/${userKey}/exchangeKeys.json`, {
      signal: AbortSignal.timeout(4500),
    }).then((r) => (r.ok ? (r.json() as Promise<Record<string, FirebaseExchangeKeyRecord> | null>) : null)),
    fetch(`${rtdbUrl}/active_positions/${userKey}.json`, {
      signal: AbortSignal.timeout(4500),
    }).then((r) => (r.ok ? (r.json() as Promise<Partial<FirebaseActivePositionsNode> | null>) : null)),
    fetch(`${rtdbUrl}/live_signals/${userKey}.json`, {
      signal: AbortSignal.timeout(4500),
    }).then((r) => (r.ok ? (r.json() as Promise<Partial<FirebaseLiveSignalsNode> | null>) : null)),
  ]);

  const keyEntries = keysRes ? Object.values(keysRes).filter(Boolean) : [];
  const hasKey = hasVerifiedExchangeKey(keyEntries, params.exchange);

  if (!hasKey && !params.overrideExchangePositions) {
    return {
      ok: true,
      hasVerifiedKey: false,
      botPositions: [],
      ignoredManualCount: 0,
      reason: `API Key Required to Trade (${params.exchange})`,
    };
  }

  const botRegistryRaw: Position[] = Array.isArray(activePosRes?.openPositions)
    ? activePosRes.openPositions
    : Array.isArray(liveSigRes?.openPositions)
      ? liveSigRes.openPositions
      : [];

  const botRegistry = botRegistryRaw.filter((p) => isBotTrackedPosition(p));

  let exchangeList: ExchangeOpenPositionInput[] = [];
  if (params.overrideExchangePositions) {
    exchangeList = params.overrideExchangePositions;
  } else {
    const matchedKey = keyEntries.find((k) => k.exchange === params.exchange);
    if (!matchedKey) {
      return {
        ok: true,
        hasVerifiedKey: false,
        botPositions: [],
        ignoredManualCount: 0,
        reason: `No verified ${params.exchange} key found`,
      };
    }

    let creds: {apiKey: string; apiSecret: string};
    try {
      creds = decryptExchangeKeysServer(matchedKey.encryptedPayload);
    } catch (err) {
      return {
        ok: false,
        hasVerifiedKey: false,
        botPositions: [],
        ignoredManualCount: 0,
        reason: `Vault decryption failed: ${(err as Error).message}`,
      };
    }

    const fetchRes = await fetchExchangeOpenPositions({
      exchange: params.exchange,
      apiKey: creds.apiKey,
      apiSecret: creds.apiSecret,
    });

    if (!fetchRes.ok) {
      // Preserve existing strictly-bot-tracked registry on transient exchange API failure
      return {
        ok: true,
        hasVerifiedKey: true,
        botPositions: botRegistry,
        ignoredManualCount: 0,
        reason: fetchRes.error,
      };
    }
    exchangeList = fetchRes.positions;
  }

  const {botPositions, ignoredManualCount} = filterBotOnlyPositions(exchangeList, botRegistry);
  const totalUnrealizedPnl = Number(
    botPositions.reduce((sum, p) => sum + (p.unrealizedPnl || 0), 0).toFixed(2),
  );

  await Promise.all([
    fetch(`${rtdbUrl}/active_positions/${userKey}.json`, {
      method: 'PATCH',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        openPositions: botPositions,
        totalUnrealizedPnl,
        updatedAt: Date.now(),
      }),
      signal: AbortSignal.timeout(4500),
    }).catch(() => null),
    fetch(`${rtdbUrl}/live_signals/${userKey}.json`, {
      method: 'PATCH',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        openPositions: botPositions,
        openPosition:
          botPositions[0]
            ? `${botPositions[0].symbol} ${botPositions[0].side} ${botPositions[0].leverage}x`
            : 'NONE',
        updatedAt: Date.now(),
      }),
      signal: AbortSignal.timeout(4500),
    }).catch(() => null),
  ]);

  return {
    ok: true,
    hasVerifiedKey: hasKey,
    botPositions,
    ignoredManualCount,
  };
}
