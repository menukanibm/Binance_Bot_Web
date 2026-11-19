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
import {fetchSignedExchange} from './fixieProxy.ts';
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
        fetchSignedExchange(`https://fapi.binance.com/fapi/v2/positionRisk?${qs.toString()}`, {
          headers: {'X-MBX-APIKEY': params.apiKey},
          timeoutMs: 5500,
        }),
        fetchSignedExchange(`https://fapi.binance.com/fapi/v1/openOrders?${qsOrders.toString()}`, {
          headers: {'X-MBX-APIKEY': params.apiKey},
          timeoutMs: 5500,
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

    const res = await fetchSignedExchange(
      'https://contract.mexc.com/api/v1/private/position/open_positions',
      {
        headers: {
          ApiKey: params.apiKey,
          'Request-Time': reqTime,
          Signature: signature,
        },
        timeoutMs: 5500,
      },
    );

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

export async function fetchExchangeWalletBalance(params: {
  exchange: ExchangeType;
  apiKey: string;
  apiSecret: string;
}): Promise<{
  ok: boolean;
  totalWalletBalance: number;
  availableBalance: number;
  unrealizedPnl: number;
  error?: string;
}> {
  try {
    if (params.exchange === 'BINANCE') {
      const ts = Date.now();
      const qs = new URLSearchParams({timestamp: String(ts), recvWindow: '10000'});
      const sig = crypto.createHmac('sha256', params.apiSecret).update(qs.toString()).digest('hex');
      qs.set('signature', sig);

      const res = await fetchSignedExchange(
        `https://fapi.binance.com/fapi/v2/balance?${qs.toString()}`,
        {
          headers: {'X-MBX-APIKEY': params.apiKey},
          timeoutMs: 6000,
        },
      );

      type BinanceBalanceItem = {
        asset?: string;
        balance?: string;
        availableBalance?: string;
        crossUnPnl?: string;
        walletBalance?: string;
        unrealizedProfit?: string;
      };
      type BinanceAccountFallback = {
        totalWalletBalance?: string;
        availableBalance?: string;
        totalUnrealizedProfit?: string;
        assets?: BinanceBalanceItem[];
        msg?: string;
      };

      const rawData = (await res.json().catch(() => ({}))) as
        | BinanceBalanceItem[]
        | BinanceAccountFallback;

      if (!res.ok) {
        const errMsg = !Array.isArray(rawData) ? rawData.msg : undefined;
        return {
          ok: false,
          totalWalletBalance: 0,
          availableBalance: 0,
          unrealizedPnl: 0,
          error: `Binance balance HTTP ${res.status}: ${errMsg || 'Authentication failed'}`,
        };
      }

      if (Array.isArray(rawData)) {
        const usdt = rawData.find((a) => String(a.asset || '').toUpperCase() === 'USDT');
        const totalWalletBalance = Number(
          Number(usdt?.balance ?? usdt?.walletBalance ?? 0).toFixed(2),
        );
        const availableBalance = Number(
          Number(usdt?.availableBalance ?? totalWalletBalance).toFixed(2),
        );
        const unrealizedPnl = Number(
          Number(usdt?.crossUnPnl ?? usdt?.unrealizedProfit ?? 0).toFixed(2),
        );
        return {
          ok: true,
          totalWalletBalance: Number.isFinite(totalWalletBalance) ? totalWalletBalance : 0,
          availableBalance: Number.isFinite(availableBalance) ? availableBalance : 0,
          unrealizedPnl: Number.isFinite(unrealizedPnl) ? unrealizedPnl : 0,
        };
      }

      const usdtAsset = Array.isArray(rawData.assets)
        ? rawData.assets.find((a) => a.asset === 'USDT')
        : undefined;
      const totalWalletBalance = Number(
        Number(usdtAsset?.walletBalance ?? usdtAsset?.balance ?? rawData.totalWalletBalance ?? 0).toFixed(2),
      );
      const availableBalance = Number(
        Number(usdtAsset?.availableBalance ?? rawData.availableBalance ?? totalWalletBalance).toFixed(2),
      );
      const unrealizedPnl = Number(
        Number(
          usdtAsset?.unrealizedProfit ??
            usdtAsset?.crossUnPnl ??
            rawData.totalUnrealizedProfit ??
            0,
        ).toFixed(2),
      );

      return {
        ok: true,
        totalWalletBalance: Number.isFinite(totalWalletBalance) ? totalWalletBalance : 0,
        availableBalance: Number.isFinite(availableBalance) ? availableBalance : 0,
        unrealizedPnl: Number.isFinite(unrealizedPnl) ? unrealizedPnl : 0,
      };
    }

    // MEXC Contract Futures Real USDT Account Assets (routed via Fixie SOCKS5 when configured)
    const reqTime = String(Date.now());
    const signTarget = `${params.apiKey}${reqTime}`;
    const signature = crypto
      .createHmac('sha256', params.apiSecret)
      .update(signTarget)
      .digest('hex');

    const res = await fetchSignedExchange(
      'https://contract.mexc.com/api/v1/private/account/assets',
      {
        headers: {
          ApiKey: params.apiKey,
          'Request-Time': reqTime,
          Signature: signature,
        },
        timeoutMs: 6000,
      },
    );

    const json = (await res.json().catch(() => ({}))) as {
      success?: boolean;
      message?: string;
      data?: Array<{
        currency?: string;
        equity?: number;
        availableBalance?: number;
        unrealized?: number;
      }>;
    };

    if (!res.ok || !json.success || !Array.isArray(json.data)) {
      return {
        ok: false,
        totalWalletBalance: 0,
        availableBalance: 0,
        unrealizedPnl: 0,
        error: `MEXC assets HTTP ${res.status}: ${json.message || 'Authentication failed'}`,
      };
    }

    const usdt = json.data.find((a) => String(a.currency || '').toUpperCase() === 'USDT');
    const totalWalletBalance = Number(Number(usdt?.equity ?? 0).toFixed(2));
    const availableBalance = Number(Number(usdt?.availableBalance ?? 0).toFixed(2));
    const unrealizedPnl = Number(Number(usdt?.unrealized ?? 0).toFixed(2));

    return {
      ok: true,
      totalWalletBalance: Number.isFinite(totalWalletBalance) ? totalWalletBalance : 0,
      availableBalance: Number.isFinite(availableBalance) ? availableBalance : 0,
      unrealizedPnl: Number.isFinite(unrealizedPnl) ? unrealizedPnl : 0,
    };
  } catch (err) {
    return {
      ok: false,
      totalWalletBalance: 0,
      availableBalance: 0,
      unrealizedPnl: 0,
      error: (err as Error).message,
    };
  }
}

export async function syncLiveWalletBalanceForUser(params: {
  username: string;
  exchange: ExchangeType;
  rtdbUrl?: string;
  fetchBalance?: typeof fetchExchangeWalletBalance;
}): Promise<import('../src/types/trading.ts').ExchangeWalletBalance> {
  const rtdbUrl = params.rtdbUrl || getServerRtdbUrl();
  const userKey = encodeUsernameKey(params.username.trim());
  const now = Date.now();

  const keysMap = await fetch(`${rtdbUrl}/users/${userKey}/exchangeKeys.json`, {
    signal: AbortSignal.timeout(4500),
  })
    .then((r) => (r.ok ? (r.json() as Promise<Record<string, FirebaseExchangeKeyRecord> | null>) : null))
    .catch(() => null);

  const rawEntries = keysMap ? Object.values(keysMap).filter(Boolean) : [];
  const matchedKey = rawEntries.find((k) => {
    const ex = (k.exchange || '').toUpperCase();
    const venue = (k.venue || '').toUpperCase();
    const id = (k.id || '').toUpperCase();
    return params.exchange === 'BINANCE'
      ? ex === 'BINANCE' || venue.includes('BINANCE') || id.includes('BINANCE')
      : ex === 'MEXC' || venue.includes('MEXC') || id.includes('MEXC');
  });

  if (!matchedKey || !hasVerifiedExchangeKey([matchedKey], params.exchange)) {
    return {
      ok: true,
      connected: false,
      exchange: params.exchange,
      asset: 'USDT',
      totalWalletBalance: 0,
      availableBalance: 0,
      unrealizedPnl: 0,
      error: `No verified ${params.exchange} Futures API key found in Firebase Vault`,
      syncedAt: now,
    };
  }

  let creds: {apiKey: string; apiSecret: string};
  try {
    creds = decryptExchangeKeysServer(matchedKey.encryptedPayload);
  } catch (err) {
    return {
      ok: false,
      connected: true,
      exchange: params.exchange,
      asset: 'USDT',
      totalWalletBalance: 0,
      availableBalance: 0,
      unrealizedPnl: 0,
      maskedKey: matchedKey.maskedKey,
      error: `Encrypted key unreadable on server (${(err as Error).message}). Please re-save key in API Vault.`,
      syncedAt: now,
    };
  }

  const balanceFn = params.fetchBalance || fetchExchangeWalletBalance;
  const bal = await balanceFn({
    exchange: params.exchange,
    apiKey: creds.apiKey,
    apiSecret: creds.apiSecret,
  });

  if (!bal.ok) {
    return {
      ok: false,
      connected: true,
      exchange: params.exchange,
      asset: 'USDT',
      totalWalletBalance: 0,
      availableBalance: 0,
      unrealizedPnl: 0,
      maskedKey: matchedKey.maskedKey,
      error: bal.error,
      syncedAt: now,
    };
  }

  // Persist real fetched USDT balance to Firebase live nodes (never $10,000 paper default)
  await Promise.all([
    fetch(`${rtdbUrl}/live_signals/${userKey}.json`, {
      method: 'PATCH',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        tradingMode: 'LIVE',
        accountBalance: bal.totalWalletBalance,
        availableMargin: bal.availableBalance,
        updatedAt: now,
      }),
      signal: AbortSignal.timeout(4000),
    }).catch(() => null),
    fetch(`${rtdbUrl}/active_positions/${userKey}.json`, {
      method: 'PATCH',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        accountBalance: bal.totalWalletBalance,
        totalUnrealizedPnl: bal.unrealizedPnl,
        updatedAt: now,
      }),
      signal: AbortSignal.timeout(4000),
    }).catch(() => null),
  ]);

  return {
    ok: true,
    connected: true,
    exchange: params.exchange,
    asset: 'USDT',
    totalWalletBalance: bal.totalWalletBalance,
    availableBalance: bal.availableBalance,
    unrealizedPnl: bal.unrealizedPnl,
    maskedKey: matchedKey.maskedKey,
    syncedAt: now,
  };
}

/**
 * Purges stale/unexecuted signals, filtered entries, and logs in Firebase RTDB
 * so the terminal boots strictly clean with only live current-session records.
 */
export async function purgeStaleFirebaseRecords(params: {
  username: string;
  sessionStartedAt?: number;
  rtdbUrl?: string;
}): Promise<{ok: boolean; purgedAt: number}> {
  const rtdbUrl = params.rtdbUrl || getServerRtdbUrl();
  const userKey = encodeUsernameKey(params.username.trim());
  const now = Date.now();
  const cutoff = params.sessionStartedAt ?? now;

  // Read live_signals to keep only actively executed trades from current session if any
  const liveNode = await fetch(`${rtdbUrl}/live_signals/${userKey}.json`, {
    signal: AbortSignal.timeout(4000),
  })
    .then((r) => (r.ok ? (r.json() as Promise<Partial<FirebaseLiveSignalsNode> | null>) : null))
    .catch(() => null);

  const retainedSignals = Array.isArray(liveNode?.signals)
    ? liveNode.signals.filter((s) => s.status === 'EXECUTED' && s.timestamp >= cutoff)
    : [];

  await Promise.all([
    fetch(`${rtdbUrl}/signals/${userKey}.json`, {
      method: 'DELETE',
      signal: AbortSignal.timeout(4000),
    }).catch(() => null),
    fetch(`${rtdbUrl}/filtered/${userKey}.json`, {
      method: 'DELETE',
      signal: AbortSignal.timeout(4000),
    }).catch(() => null),
    fetch(`${rtdbUrl}/logs/${userKey}.json`, {
      method: 'DELETE',
      signal: AbortSignal.timeout(4000),
    }).catch(() => null),
    fetch(`${rtdbUrl}/live_signals/${userKey}.json`, {
      method: 'PATCH',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        signals: retainedSignals,
        sessionStartedAt: cutoff,
        updatedAt: now,
      }),
      signal: AbortSignal.timeout(4000),
    }).catch(() => null),
  ]);

  return {ok: true, purgedAt: now};
}

