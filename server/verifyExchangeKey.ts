import crypto from 'node:crypto';
import type {
  ExchangeType,
  ExchangeWalletBalance,
  FirebaseExchangeKeyRecord,
} from '../src/types/trading.ts';
import {
  deleteExchangeKeyFromRtdb,
  encodeUsernameKey,
  putExchangeKeyInRtdb,
} from '../src/services/firebaseRtdb.ts';
import {fetchSignedExchange, type HttpsRequestFn} from './fixieProxy.ts';
import {encryptExchangeKeysServer, maskApiKey} from './vaultCrypto.ts';
import {getServerRtdbUrl} from './webhookEngine.ts';

export type ExchangeVerifyErrorCode =
  | 'MISSING_FIELDS'
  | 'INVALID_CREDENTIALS'
  | 'IP_WHITELIST_MISMATCH'
  | 'FUTURES_PERMISSION_DISABLED'
  | 'IP_OR_PERMISSION_DENIED'
  | 'TIMESTAMP_SKEW'
  | 'PROXY_GEO_BLOCKED'
  | 'PROXY_HANDSHAKE_FAILED'
  | 'EXCHANGE_ERROR';

export interface LiveHandshakeResult {
  ok: boolean;
  exchange: ExchangeType;
  futuresEnabled: boolean;
  proxiedViaFixie: boolean;
  wallet?: ExchangeWalletBalance;
  errorCode?: ExchangeVerifyErrorCode;
  error?: string;
}

export interface VerifyAndSaveKeyResult extends LiveHandshakeResult {
  saved: boolean;
  record?: FirebaseExchangeKeyRecord;
}

/**
 * Classifies Binance USD-M Futures API error codes/messages into clear,
 * human-readable diagnostic messages for the API Vault modal.
 */
export function diagnoseBinanceError(
  httpStatus: number,
  code?: number,
  rawMsg?: string,
): {errorCode: ExchangeVerifyErrorCode; error: string} {
  const msg = String(rawMsg || '').trim();
  const lower = msg.toLowerCase();

  if (code === -2014 || code === -1022 || lower.includes('signature') || lower.includes('api-key format')) {
    return {
      errorCode: 'INVALID_CREDENTIALS',
      error: 'Invalid API Key or Secret — Signature rejected by Binance Futures.',
    };
  }

  if (code === -2015) {
    if (lower.includes('ip') || lower.includes('whitelist')) {
      return {
        errorCode: 'IP_WHITELIST_MISMATCH',
        error: 'IP Whitelist Mismatch — Ensure Fixie Static IPs are added to Binance API restrictions.',
      };
    }
    if (lower.includes('permission') || lower.includes('futures')) {
      return {
        errorCode: 'FUTURES_PERMISSION_DISABLED',
        error: 'Enable Futures permission is unchecked — Enable Futures trading on your Binance API key.',
      };
    }
    return {
      errorCode: 'IP_OR_PERMISSION_DENIED',
      error:
        'IP Whitelist Mismatch or Permission Denied — Ensure Fixie Static IPs are added to Binance and "Enable Futures" is checked.',
    };
  }

  if (code === -1021 || lower.includes('timestamp')) {
    return {
      errorCode: 'TIMESTAMP_SKEW',
      error: 'Timestamp sync mismatch with Binance Futures server. Please try verifying again.',
    };
  }

  if (httpStatus === 403 || httpStatus === 451) {
    return {
      errorCode: 'PROXY_GEO_BLOCKED',
      error: `Exchange rejected outbound IP/region (HTTP ${httpStatus}) — Ensure FIXIE_SOCKS_HOST static proxy is active and whitelisted.`,
    };
  }

  return {
    errorCode: 'EXCHANGE_ERROR',
    error: msg ? `Binance Futures rejected handshake: ${msg}` : `Binance Futures verification failed (HTTP ${httpStatus}).`,
  };
}

/**
 * Classifies MEXC Futures API error codes/messages into clear diagnostics.
 */
export function diagnoseMexcError(
  httpStatus: number,
  code?: number,
  rawMsg?: string,
): {errorCode: ExchangeVerifyErrorCode; error: string} {
  const msg = String(rawMsg || '').trim();
  const lower = msg.toLowerCase();

  if (lower.includes('ip') || lower.includes('whitelist') || code === 700006) {
    return {
      errorCode: 'IP_WHITELIST_MISMATCH',
      error: 'IP Whitelist Mismatch — Ensure Fixie Static IPs are added to MEXC API restrictions.',
    };
  }

  if (lower.includes('permission') || lower.includes('futures') || lower.includes('contract')) {
    return {
      errorCode: 'FUTURES_PERMISSION_DISABLED',
      error: 'Enable Futures permission is unchecked — Enable Contract/Futures trading on your MEXC API key.',
    };
  }

  if (
    httpStatus === 401 ||
    code === 401 ||
    code === 602 ||
    lower.includes('signature') ||
    lower.includes('apikey') ||
    lower.includes('secret') ||
    lower.includes('invalid')
  ) {
    return {
      errorCode: 'INVALID_CREDENTIALS',
      error: 'Invalid API Key or Secret — Signature rejected by MEXC Futures.',
    };
  }

  if (httpStatus === 403 || httpStatus === 451) {
    return {
      errorCode: 'PROXY_GEO_BLOCKED',
      error: `MEXC rejected outbound IP/region (HTTP ${httpStatus}) — Verify FIXIE_SOCKS_HOST proxy is active and whitelisted.`,
    };
  }

  return {
    errorCode: 'EXCHANGE_ERROR',
    error: msg ? `MEXC Futures rejected handshake: ${msg}` : `MEXC Futures verification failed (HTTP ${httpStatus}).`,
  };
}

/**
 * Performs a live signed exchange account handshake exclusively via `fetchSignedExchange`
 * (which tunnels through `FIXIE_SOCKS_HOST` SocksProxyAgent when configured).
 *
 * Validates:
 * 1. Credential & HMAC-SHA256 signature validity
 * 2. Futures trading permission (`canTrade === true` on Binance `/fapi/v2/account`)
 * 3. Fixie Static IP whitelist acceptance
 * 4. Real live USDT Wallet Balance & Available Margin
 */
export async function verifyExchangeCredentialsLive(
  params: {
    exchange: ExchangeType;
    apiKey: string;
    apiSecret: string;
  },
  deps?: {httpsRequest?: HttpsRequestFn},
): Promise<LiveHandshakeResult> {
  const apiKey = params.apiKey.trim();
  const apiSecret = params.apiSecret.trim();
  const now = Date.now();

  if (!apiKey || !apiSecret) {
    return {
      ok: false,
      exchange: params.exchange,
      futuresEnabled: false,
      proxiedViaFixie: false,
      errorCode: 'MISSING_FIELDS',
      error: 'Enter both Exchange API Key and API Secret before verifying.',
    };
  }

  try {
    if (params.exchange === 'BINANCE') {
      const qs = new URLSearchParams({
        timestamp: String(now),
        recvWindow: '10000',
      });
      const sig = crypto.createHmac('sha256', apiSecret).update(qs.toString()).digest('hex');
      qs.set('signature', sig);

      const res = await fetchSignedExchange(
        `https://fapi.binance.com/fapi/v2/account?${qs.toString()}`,
        {
          method: 'GET',
          headers: {'X-MBX-APIKEY': apiKey},
          timeoutMs: 8000,
        },
        deps,
      );

      const data = (await res.json().catch(() => ({}))) as {
        canTrade?: boolean;
        totalWalletBalance?: string;
        availableBalance?: string;
        totalUnrealizedProfit?: string;
        assets?: Array<{
          asset?: string;
          walletBalance?: string;
          availableBalance?: string;
          unrealizedProfit?: string;
        }>;
        code?: number;
        msg?: string;
      };

      if (!res.ok) {
        const diag = diagnoseBinanceError(res.status, data.code, data.msg);
        return {
          ok: false,
          exchange: 'BINANCE',
          futuresEnabled: false,
          proxiedViaFixie: res.proxiedViaFixie,
          errorCode: diag.errorCode,
          error: diag.error,
        };
      }

      if (data.canTrade === false) {
        return {
          ok: false,
          exchange: 'BINANCE',
          futuresEnabled: false,
          proxiedViaFixie: res.proxiedViaFixie,
          errorCode: 'FUTURES_PERMISSION_DISABLED',
          error:
            'Enable Futures permission is unchecked — Enable "Enable Futures" in your Binance API key settings.',
        };
      }

      const usdtAsset = Array.isArray(data.assets)
        ? data.assets.find((a) => String(a.asset || '').toUpperCase() === 'USDT')
        : undefined;
      const totalWalletBalance = Number(
        Number(usdtAsset?.walletBalance ?? data.totalWalletBalance ?? 0).toFixed(2),
      );
      const availableBalance = Number(
        Number(usdtAsset?.availableBalance ?? data.availableBalance ?? totalWalletBalance).toFixed(2),
      );
      const unrealizedPnl = Number(
        Number(usdtAsset?.unrealizedProfit ?? data.totalUnrealizedProfit ?? 0).toFixed(2),
      );

      const wallet: ExchangeWalletBalance = {
        ok: true,
        connected: true,
        exchange: 'BINANCE',
        asset: 'USDT',
        totalWalletBalance: Number.isFinite(totalWalletBalance) ? totalWalletBalance : 0,
        availableBalance: Number.isFinite(availableBalance) ? availableBalance : 0,
        unrealizedPnl: Number.isFinite(unrealizedPnl) ? unrealizedPnl : 0,
        maskedKey: maskApiKey(apiKey),
        syncedAt: Date.now(),
      };

      return {
        ok: true,
        exchange: 'BINANCE',
        futuresEnabled: true,
        proxiedViaFixie: res.proxiedViaFixie,
        wallet,
      };
    }

    // MEXC Contract Futures live account assets handshake via Fixie SOCKS5
    const reqTime = String(now);
    const signature = crypto
      .createHmac('sha256', apiSecret)
      .update(`${apiKey}${reqTime}`)
      .digest('hex');

    const res = await fetchSignedExchange(
      'https://contract.mexc.com/api/v1/private/account/assets',
      {
        method: 'GET',
        headers: {
          ApiKey: apiKey,
          'Request-Time': reqTime,
          Signature: signature,
        },
        timeoutMs: 8000,
      },
      deps,
    );

    const json = (await res.json().catch(() => ({}))) as {
      success?: boolean;
      code?: number;
      message?: string;
      data?: Array<{
        currency?: string;
        equity?: number;
        availableBalance?: number;
        unrealized?: number;
      }>;
    };

    if (!res.ok || json.success === false || !Array.isArray(json.data)) {
      const diag = diagnoseMexcError(res.status, json.code, json.message);
      return {
        ok: false,
        exchange: 'MEXC',
        futuresEnabled: false,
        proxiedViaFixie: res.proxiedViaFixie,
        errorCode: diag.errorCode,
        error: diag.error,
      };
    }

    const usdt = json.data.find((a) => String(a.currency || '').toUpperCase() === 'USDT');
    const totalWalletBalance = Number(Number(usdt?.equity ?? 0).toFixed(2));
    const availableBalance = Number(Number(usdt?.availableBalance ?? 0).toFixed(2));
    const unrealizedPnl = Number(Number(usdt?.unrealized ?? 0).toFixed(2));

    const wallet: ExchangeWalletBalance = {
      ok: true,
      connected: true,
      exchange: 'MEXC',
      asset: 'USDT',
      totalWalletBalance: Number.isFinite(totalWalletBalance) ? totalWalletBalance : 0,
      availableBalance: Number.isFinite(availableBalance) ? availableBalance : 0,
      unrealizedPnl: Number.isFinite(unrealizedPnl) ? unrealizedPnl : 0,
      maskedKey: maskApiKey(apiKey),
      syncedAt: Date.now(),
    };

    return {
      ok: true,
      exchange: 'MEXC',
      futuresEnabled: true,
      proxiedViaFixie: res.proxiedViaFixie,
      wallet,
    };
  } catch (err) {
    return {
      ok: false,
      exchange: params.exchange,
      futuresEnabled: false,
      proxiedViaFixie: Boolean(process.env.FIXIE_SOCKS_HOST?.trim()),
      errorCode: 'PROXY_HANDSHAKE_FAILED',
      error: `Proxy / Exchange handshake failed: ${(err as Error).message}`,
    };
  }
}

/**
 * Verifies live exchange credentials FIRST via Fixie SOCKS5 proxy.
 * - If verification FAILS: does NOT save broken keys to Firebase RTDB.
 * - If verification SUCCEEDS: encrypts keys with AES-256-GCM, saves to
 *   `/users/{username}/exchangeKeys/{activeExchange}`, enables auto-trade,
 *   and syncs the real live USDT wallet balance into Firebase RTDB.
 */
export async function verifyAndSaveExchangeKey(
  params: {
    username: string;
    venue?: FirebaseExchangeKeyRecord['venue'];
    exchange?: ExchangeType;
    label?: string;
    apiKey: string;
    apiSecret: string;
    rtdbUrl?: string;
  },
  deps?: {httpsRequest?: HttpsRequestFn},
): Promise<VerifyAndSaveKeyResult> {
  const username = params.username.trim();
  const exchange: ExchangeType =
    params.exchange ||
    (String(params.venue || 'Binance Futures')
      .toUpperCase()
      .includes('MEXC')
      ? 'MEXC'
      : 'BINANCE');
  const venue: FirebaseExchangeKeyRecord['venue'] =
    params.venue || (exchange === 'MEXC' ? 'MEXC Futures' : 'Binance Futures');

  if (!username || !params.apiKey.trim() || !params.apiSecret.trim()) {
    return {
      ok: false,
      saved: false,
      exchange,
      futuresEnabled: false,
      proxiedViaFixie: false,
      errorCode: 'MISSING_FIELDS',
      error: 'Username, Exchange API Key, and API Secret are required.',
    };
  }

  // Step 1: Live handshake verification through Fixie SOCKS5 proxy
  const handshake = await verifyExchangeCredentialsLive(
    {
      exchange,
      apiKey: params.apiKey.trim(),
      apiSecret: params.apiSecret.trim(),
    },
    deps,
  );

  if (!handshake.ok || !handshake.wallet) {
    // CRITICAL: Do NOT save broken or unverified keys!
    return {
      ...handshake,
      ok: false,
      saved: false,
    };
  }

  // Step 2: Encrypt verified keys with AES-256-GCM & store in Firebase RTDB
  const rtdbUrl = params.rtdbUrl || getServerRtdbUrl();
  const now = Date.now();
  const record: FirebaseExchangeKeyRecord = {
    id: exchange,
    venue,
    exchange,
    label: String(params.label || venue).trim() || venue,
    maskedKey: maskApiKey(params.apiKey.trim()),
    encryptedPayload: encryptExchangeKeysServer(params.apiKey.trim(), params.apiSecret.trim()),
    autoTradeEnabled: true,
    updatedAt: new Date(now).toISOString(),
  };

  await putExchangeKeyInRtdb(rtdbUrl, username, exchange, record);
  await deleteExchangeKeyFromRtdb(rtdbUrl, username, `key-${exchange.toLowerCase()}`).catch(
    () => null,
  );

  // Step 3: Unlock auto-trade & sync live verified USDT balance into Firebase live nodes
  const userKey = encodeUsernameKey(username);
  await Promise.all([
    fetch(`${rtdbUrl}/bot_settings/${userKey}.json`, {
      method: 'PATCH',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        autoTrade: true,
        activeExchange: exchange,
        tradingMode: 'LIVE',
        updatedAt: now,
      }),
      signal: AbortSignal.timeout(4500),
    }).catch(() => null),
    fetch(`${rtdbUrl}/live_signals/${userKey}.json`, {
      method: 'PATCH',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        tradingMode: 'LIVE',
        accountBalance: handshake.wallet.totalWalletBalance,
        availableMargin: handshake.wallet.availableBalance,
        updatedAt: now,
      }),
      signal: AbortSignal.timeout(4500),
    }).catch(() => null),
    fetch(`${rtdbUrl}/active_positions/${userKey}.json`, {
      method: 'PATCH',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        accountBalance: handshake.wallet.totalWalletBalance,
        totalUnrealizedPnl: handshake.wallet.unrealizedPnl,
        updatedAt: now,
      }),
      signal: AbortSignal.timeout(4500),
    }).catch(() => null),
  ]);

  return {
    ...handshake,
    ok: true,
    saved: true,
    record,
  };
}
