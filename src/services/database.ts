import type {
  ApiKeyRecord,
  BotSettings,
  EngineLogEntry,
  ExchangeType,
  FirebaseActivePositionsNode,
  FirebaseBotSettingsNode,
  FirebaseExchangeKeyRecord,
  FirebaseLiveSignalsNode,
  Position,
  SessionState,
  TradeSignal,
  UserAccount,
} from '../types/trading';
import {
  getEffectiveDeviceId,
  getOrCreateDeviceId,
  hashPassword,
  validateActiveSession,
  validateLoginAccess,
} from '../utils/authLogic';
import {encryptApiSecret, maskApiKey} from '../utils/cryptoVault';
import {
  buildBotClientOrderId,
  canExecuteTrade,
  evaluatePositionSlTpHit,
  hasVerifiedExchangeKey,
  isBotTrackedPosition,
} from '../utils/executionGuard';
import {
  deleteExchangeKeyFromRtdb,
  getConfiguredRtdbUrl,
  patchActivePositionsInRtdb,
  patchBotSettingsInRtdb,
  patchLiveSignalsInRtdb,
  patchUserInRtdb,
  putExchangeKeyInRtdb,
  readActivePositionsFromRtdb,
  readAllUsersFromRtdb,
  readBotSettingsFromRtdb,
  readExchangeKeysFromRtdb,
  readLiveSignalsFromRtdb,
  readUserFromRtdb,
  subscribeActivePositionsStream,
  subscribeLiveSignalsStream,
} from './firebaseRtdb';

const USERS_KEY = 'makka_rtdb_users_v3';
const SESSION_KEY = 'makka_rtdb_session_v2';
const SETTINGS_KEY = 'makka_rtdb_settings_v2';
const POSITIONS_KEY = 'makka_rtdb_positions_v2';
const CLOSED_KEY = 'makka_rtdb_closed_v2';
const SIGNALS_KEY = 'makka_rtdb_signals_v2';
const API_KEYS_KEY = 'makka_rtdb_apikeys_v2';
const EQUITY_KEY = 'makka_rtdb_equity_v2';
const LOGS_KEY = 'makka_rtdb_logs_v2';

const CHANNEL_NAME = 'makka_footprint_rtdb_sync_v2';

function modeStorageKey(baseKey: string, mode: 'PAPER' | 'LIVE'): string {
  return mode === 'LIVE' ? `${baseKey}_live` : baseKey;
}

function buildSeedUsers(): UserAccount[] {
  return [
    {
      id: 'usr-menuka-owner',
      username: 'Menuka',
      passwordHash: hashPassword('2006'),
      role: 'admin',
      isActive: true,
      expiryDate: '2027-12-31',
      deviceId: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 'usr-admin-01',
      username: 'makka_admin',
      passwordHash: hashPassword('Makka@Admin2026'),
      role: 'admin',
      isActive: true,
      expiryDate: '2030-12-31',
      deviceId: null,
      createdAt: '2026-01-10T08:00:00.000Z',
    },
  ];
}

export const DEFAULT_BOT_SETTINGS: BotSettings = {
  autoTrading: false,
  activeSymbol: 'BTCUSDT',
  directionPreference: 'BOTH',
  scanIntervalMinutes: 5,
  leverage: 10,
  riskPercentage: 2,
  positionCapitalPercent: 10,
  footprintThreshold: 1,
  tradingMode: 'PAPER',
  timeframeMode: 'AUTO',
  stopLossPercent: 0.5,
  minSlPercent: 0.25,
  maxSlPercent: 1.2,
  minRiskReward: 2.0,
  coinglassApiKey: '',
  binanceApiKey: '',
  binanceApiSecret: '',
  mexcApiKey: '',
  mexcApiSecret: '',
  activeExchange: 'BINANCE',
  maxTotalMarginPct: 50,
  marginMode: 'ISOLATED',
};

const SEED_OPEN_POSITIONS: Position[] = [];

const SEED_CLOSED_POSITIONS: Position[] = [];

const SEED_SIGNALS: TradeSignal[] = [
  {
    id: 'sig-btc-latest',
    symbol: 'BTCUSDT',
    exchange: 'BINANCE',
    side: 'LONG',
    entryPrice: 94060,
    stopLoss: 93589.7,
    takeProfit: 95000.6,
    riskRewardRatio: 2.0,
    slDistancePercent: 0.5,
    engulfingTimeframe: '15m',
    isStopHuntEngulfing: true,
    confluenceScore: 3,
    msnrLevelLabel: '4H V-Support + 1H RBS',
    reasoning: 'Ask imbalance (+342 BTC delta) confirmed 15m bullish engulfing off fresh 4H V-Support.',
    timestamp: Date.now() - 310_000,
    status: 'EXECUTED',
  },
  {
    id: 'sig-avax-latest',
    symbol: 'AVAXUSDT',
    exchange: 'BINANCE',
    side: 'SHORT',
    entryPrice: 38.62,
    stopLoss: 38.89,
    takeProfit: 38.08,
    riskRewardRatio: 2.0,
    slDistancePercent: 0.7,
    engulfingTimeframe: '5m',
    isStopHuntEngulfing: false,
    confluenceScore: 3,
    msnrLevelLabel: '4H A-Resistance + Bearish FVG',
    reasoning: '5m closed bearish engulfing inside 4H Premium zone with clean traffic to $38.08.',
    timestamp: Date.now() - 880_000,
    status: 'EXECUTED',
  },
];

const SEED_LOGS: EngineLogEntry[] = [
  {
    time: '09:42:10',
    message: '[MSNR Engine] BTCUSDT: 4H V-Support tap confirmed via 15m Ask Delta Engulfing (+342 BTC).',
    type: 'trade',
  },
  {
    time: '09:45:03',
    message: '[Engine Sync] Account, /bot_settings & /live_signals telemetry synchronized.',
    type: 'success',
  },
  {
    time: '09:47:28',
    message: '[Rule 5 Filter] DOGEUSDT SHORT skipped: Unfresh 1H OCL roadblock caps net R:R at 1.35.',
    type: 'warn',
  },
];

function readJSON<T>(key: string, fallback: T): T {
  try {
    if (typeof window === 'undefined') return fallback;
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJSON<T>(key: string, value: T): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(key, JSON.stringify(value));
}

type Listener = () => void;

class MakkaDatabaseService {
  private listeners = new Set<Listener>();
  private channel: BroadcastChannel | null = null;
  private rtdbUrl: string;
  private stopStreamFn: (() => void) | null = null;
  private stopActivePosStreamFn: (() => void) | null = null;
  private streamingUsername: string | null = null;
  private isAuthenticating = false;

  constructor() {
    this.ensureSeeded();
    this.rtdbUrl = getConfiguredRtdbUrl();
    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      this.channel = new BroadcastChannel(CHANNEL_NAME);
      this.channel.onmessage = () => this.notifyLocal();
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('storage', () => this.notifyLocal());
    }
  }

  private ensureSeeded(): void {
    if (typeof window === 'undefined') return;
    if (!window.localStorage.getItem(USERS_KEY)) {
      window.localStorage.removeItem('makka_rtdb_users_v2');
      writeJSON(USERS_KEY, buildSeedUsers());
    }
    if (!window.localStorage.getItem(SETTINGS_KEY)) writeJSON(SETTINGS_KEY, DEFAULT_BOT_SETTINGS);
    if (!window.localStorage.getItem(POSITIONS_KEY)) writeJSON(POSITIONS_KEY, SEED_OPEN_POSITIONS);
    if (!window.localStorage.getItem(CLOSED_KEY)) writeJSON(CLOSED_KEY, SEED_CLOSED_POSITIONS);
    if (!window.localStorage.getItem(SIGNALS_KEY)) writeJSON(SIGNALS_KEY, SEED_SIGNALS);
    if (!window.localStorage.getItem(API_KEYS_KEY)) writeJSON(API_KEYS_KEY, []);
    if (!window.localStorage.getItem(EQUITY_KEY)) writeJSON(EQUITY_KEY, 10000.0);
    if (!window.localStorage.getItem(LOGS_KEY)) writeJSON(LOGS_KEY, SEED_LOGS);
  }

  public subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notifyLocal(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  private emitChange(): void {
    this.notifyLocal();
    this.channel?.postMessage({type: 'SYNC', ts: Date.now()});
  }

  private getActiveSyncKey(): string {
    return this.getSession()?.username || 'admin';
  }

  // --- REAL-TIME SYNC ACROSS /users, /bot_settings, /live_signals ---
  public async syncFromRtdb(): Promise<void> {
    const url = getConfiguredRtdbUrl();
    this.rtdbUrl = url;
    const syncUser = this.getActiveSyncKey();

    try {
      const [remoteUsers, remoteSettings, remoteSignals, remoteActivePos] = await Promise.all([
        readAllUsersFromRtdb(url).catch(() => null),
        readBotSettingsFromRtdb(url, syncUser).catch(() => null),
        readLiveSignalsFromRtdb(url, syncUser).catch(() => null),
        readActivePositionsFromRtdb(url, syncUser).catch(() => null),
      ]);

      if (remoteUsers && Object.keys(remoteUsers).length > 0 && !this.isAuthenticating) {
        const localUsers = this.getUsers();
        const mergedMap = new Map<string, UserAccount>();
        for (const u of localUsers) {
          mergedMap.set(u.username.toLowerCase(), u);
        }
        for (const [key, rec] of Object.entries(remoteUsers)) {
          if (!rec || !rec.passwordHash) continue;
          const existing = mergedMap.get(key.toLowerCase());
          mergedMap.set(key.toLowerCase(), {
            id: existing?.id || `usr-rtdb-${key}`,
            username: key,
            passwordHash: rec.passwordHash,
            role:
              rec.role ||
              (key.toLowerCase() === 'menuka' ||
              key.toLowerCase() === 'makka_admin' ||
              key.toLowerCase() === 'admin'
                ? 'admin'
                : 'trader'),
            isActive: rec.isActive !== false,
            expiryDate: rec.expiryDate,
            durationMonths: rec.durationMonths,
            deviceId: rec.deviceId ?? rec.boundedDeviceId ?? null,
            createdAt: rec.createdAt || existing?.createdAt || new Date().toISOString(),
            lastLoginAt: rec.lastLoginAt ?? existing?.lastLoginAt ?? null,
          });
        }
        writeJSON(USERS_KEY, Array.from(mergedMap.values()));
      }

      if (remoteSettings) {
        const currentSettings = this.getBotSettings();
        const nextSettings: BotSettings = {
          ...currentSettings,
          autoTrading:
            typeof remoteSettings.autoTrade === 'boolean'
              ? remoteSettings.autoTrade
              : currentSettings.autoTrading,
          activeSymbol: remoteSettings.symbol || currentSettings.activeSymbol,
          activeExchange: remoteSettings.activeExchange || currentSettings.activeExchange,
          tradingMode: remoteSettings.tradingMode || currentSettings.tradingMode,
          timeframeMode: remoteSettings.timeframeMode || currentSettings.timeframeMode,
          directionPreference:
            remoteSettings.directionPreference || currentSettings.directionPreference,
          leverage: remoteSettings.leverage ?? currentSettings.leverage,
          riskPercentage: remoteSettings.riskPercent ?? currentSettings.riskPercentage,
          stopLossPercent: remoteSettings.stopLoss ?? currentSettings.stopLossPercent,
          marginMode: remoteSettings.marginMode || currentSettings.marginMode,
        };
        writeJSON(SETTINGS_KEY, nextSettings);
      }

      if (remoteSignals) {
        this.applyLiveSignalsSnapshot(remoteSignals);
      }
      if (remoteActivePos) {
        this.applyActivePositionsSnapshot(remoteActivePos);
      }

      this.notifyLocal();
    } catch {
      // Offline resilient cache fallback
    }
  }

  private applyLiveSignalsSnapshot(remoteSignals: Partial<FirebaseLiveSignalsNode>): void {
    const activeMode = this.getBotSettings().tradingMode;
    if (remoteSignals.tradingMode && remoteSignals.tradingMode !== activeMode) {
      return;
    }
    const allowAccountBalance =
      activeMode === 'PAPER' || remoteSignals.tradingMode === 'LIVE';
    if (!allowAccountBalance) return;

    if (Array.isArray(remoteSignals.openPositions)) {
      const botOnly = remoteSignals.openPositions.filter((p) => isBotTrackedPosition(p));
      writeJSON(modeStorageKey(POSITIONS_KEY, activeMode), botOnly);
    }
    if (Array.isArray(remoteSignals.closedPositions)) {
      const botClosed = remoteSignals.closedPositions.filter((p) => isBotTrackedPosition(p));
      writeJSON(modeStorageKey(CLOSED_KEY, activeMode), botClosed);
    }
    if (Array.isArray(remoteSignals.signals)) {
      writeJSON(modeStorageKey(SIGNALS_KEY, activeMode), remoteSignals.signals);
    }
    if (typeof remoteSignals.accountBalance === 'number') {
      writeJSON(modeStorageKey(EQUITY_KEY, activeMode), remoteSignals.accountBalance);
    }
  }

  private applyActivePositionsSnapshot(
    remoteNode: Partial<FirebaseActivePositionsNode>,
  ): void {
    const activeMode = this.getBotSettings().tradingMode;
    if (remoteNode.tradingMode && remoteNode.tradingMode !== activeMode) {
      return;
    }
    if (Array.isArray(remoteNode.openPositions)) {
      const botOnly = remoteNode.openPositions.filter((p) => isBotTrackedPosition(p));
      writeJSON(modeStorageKey(POSITIONS_KEY, activeMode), botOnly);
    }
    if (Array.isArray(remoteNode.closedPositions)) {
      const botClosed = remoteNode.closedPositions.filter((p) => isBotTrackedPosition(p));
      writeJSON(modeStorageKey(CLOSED_KEY, activeMode), botClosed);
    }
    if (
      typeof remoteNode.accountBalance === 'number' &&
      (activeMode === 'PAPER' || remoteNode.tradingMode === 'LIVE')
    ) {
      writeJSON(modeStorageKey(EQUITY_KEY, activeMode), remoteNode.accountBalance);
    }
  }

  public startLiveSignalsStream(username: string): () => void {
    const clean = username.trim();
    if (!clean) return () => {};
    if (this.streamingUsername === clean && this.stopStreamFn) {
      return this.stopStreamFn;
    }
    this.stopLiveSignalsStream();
    const url = getConfiguredRtdbUrl();
    this.streamingUsername = clean;
    this.stopStreamFn = subscribeLiveSignalsStream(url, clean, (incoming) => {
      if (!incoming) return;
      this.applyLiveSignalsSnapshot(incoming);
      this.notifyLocal();
    });
    this.stopActivePosStreamFn = subscribeActivePositionsStream(url, clean, (incoming) => {
      if (!incoming) return;
      this.applyActivePositionsSnapshot(incoming);
      this.notifyLocal();
    });
    return () => {
      this.stopLiveSignalsStream();
    };
  }

  public stopLiveSignalsStream(): void {
    if (this.stopStreamFn) {
      this.stopStreamFn();
      this.stopStreamFn = null;
    }
    if (this.stopActivePosStreamFn) {
      this.stopActivePosStreamFn();
      this.stopActivePosStreamFn = null;
    }
    this.streamingUsername = null;
  }

  private pushBotSettingsToRtdb(): void {
    const url = getConfiguredRtdbUrl();
    const syncUser = this.getActiveSyncKey();
    const s = this.getBotSettings();
    const payload: Partial<FirebaseBotSettingsNode> = {
      autoTrade: s.autoTrading,
      symbol: s.activeSymbol,
      leverage: s.leverage,
      riskPercent: s.riskPercentage,
      stopLoss: s.stopLossPercent,
      activeExchange: s.activeExchange,
      tradingMode: s.tradingMode,
      timeframeMode: s.timeframeMode,
      directionPreference: s.directionPreference,
      marginMode: s.marginMode,
    };
    void patchBotSettingsInRtdb(url, syncUser, payload).catch(() => null);
  }

  private pushLiveSignalsToRtdb(extra?: Partial<FirebaseLiveSignalsNode>): void {
    const url = getConfiguredRtdbUrl();
    const syncUser = this.getActiveSyncKey();
    const s = this.getBotSettings();
    const open = this.getOpenPositions();
    const closed = this.getClosedPositions();
    const signals = this.getSignals();
    const realizedPnl = closed.reduce((sum, p) => sum + (p.realizedPnl ?? 0), 0);
    const firstOpen = open[0];
    const openPositionSummary = firstOpen
      ? `${firstOpen.symbol} ${firstOpen.side} ${firstOpen.leverage}x`
      : 'NONE';

    const payload: Partial<FirebaseLiveSignalsNode> = {
      currentPnL: Number(realizedPnl.toFixed(2)),
      footprintTrend:
        signals[0]?.side === 'LONG'
          ? 'BULLISH_IMBALANCE'
          : signals[0]?.side === 'SHORT'
            ? 'BEARISH_IMBALANCE'
            : 'NEUTRAL',
      openPosition: openPositionSummary,
      tradingMode: s.tradingMode,
      activeSymbol: s.activeSymbol,
      activeExchange: s.activeExchange,
      latestSignal: signals[0] ?? null,
      signals,
      openPositions: open,
      closedPositions: closed,
      accountBalance: this.getEquity(),
      ...extra,
    };
    void patchLiveSignalsInRtdb(url, syncUser, payload).catch(() => null);
    const activePosOpen = payload.openPositions ?? open;
    const totalUnrealizedPnl = activePosOpen.reduce((sum, p) => sum + (p.unrealizedPnl || 0), 0);
    void patchActivePositionsInRtdb(url, syncUser, {
      username: syncUser,
      tradingMode: payload.tradingMode ?? s.tradingMode,
      activeExchange: payload.activeExchange ?? s.activeExchange,
      accountBalance: payload.accountBalance ?? this.getEquity(),
      totalUnrealizedPnl: Number(totalUnrealizedPnl.toFixed(2)),
      realizedPnl: payload.currentPnL ?? Number(realizedPnl.toFixed(2)),
      openPositions: activePosOpen,
      closedPositions: payload.closedPositions ?? closed,
    }).catch(() => null);
  }

  // --- AUTHENTICATION & SINGLE-DEVICE LOCK (/users/{username}.json) ---
  public getUsers(): UserAccount[] {
    return readJSON<UserAccount[]>(USERS_KEY, []);
  }

  public getSession(): SessionState | null {
    return readJSON<SessionState | null>(SESSION_KEY, null);
  }

  public async loginAsync(
    usernameInput: string,
    passwordInput: string,
  ): Promise<{ok: boolean; session?: SessionState; error?: string}> {
    const cleanName = usernameInput.trim();
    const url = getConfiguredRtdbUrl();
    this.isAuthenticating = true;
    try {
      if (url && cleanName) {
        try {
          let canonicalName = cleanName;
          let remoteRecord = await readUserFromRtdb(url, cleanName);
          if (!remoteRecord) {
            const allRemote = await readAllUsersFromRtdb(url).catch(() => null);
            if (allRemote) {
              const found = Object.entries(allRemote).find(
                ([k, v]) => k.toLowerCase() === cleanName.toLowerCase() && v?.passwordHash,
              );
              if (found) {
                canonicalName = found[0];
                remoteRecord = found[1];
              }
            }
          }
          if (remoteRecord && remoteRecord.passwordHash) {
            const users = this.getUsers();
            const idx = users.findIndex((u) => u.username.toLowerCase() === cleanName.toLowerCase());
            const mapped: UserAccount = {
              id: idx >= 0 ? users[idx].id : `usr-rtdb-${canonicalName}`,
              username: canonicalName,
              passwordHash: remoteRecord.passwordHash,
              role:
                remoteRecord.role ||
                (canonicalName.toLowerCase() === 'menuka' ||
                canonicalName.toLowerCase() === 'makka_admin' ||
                canonicalName.toLowerCase() === 'admin'
                  ? 'admin'
                  : 'trader'),
              isActive: remoteRecord.isActive !== false,
              expiryDate: remoteRecord.expiryDate,
              durationMonths: remoteRecord.durationMonths,
              deviceId: remoteRecord.deviceId ?? remoteRecord.boundedDeviceId ?? null,
              createdAt: remoteRecord.createdAt || new Date().toISOString(),
              lastLoginAt: remoteRecord.lastLoginAt ?? null,
            };
            if (idx >= 0) users[idx] = mapped;
            else users.unshift(mapped);
            writeJSON(USERS_KEY, users);
          }
        } catch {
          // Fallback cleanly to synced cache if offline/network error
        }
      }

      const res = this.login(usernameInput, passwordInput);
      if (res.ok && res.session && url) {
        const user = this.getUsers().find((u) => u.id === res.session?.userId);
        if (user) {
          await patchUserInRtdb(url, user.username, {
            deviceId: getEffectiveDeviceId(user),
            lastLoginAt: user.lastLoginAt || new Date().toISOString(),
          }).catch(() => null);
        }
      }
      return res;
    } finally {
      this.isAuthenticating = false;
      if (url && this.getSession()) {
        void this.syncFromRtdb();
      }
    }
  }

  public login(
    usernameInput: string,
    passwordInput: string,
  ): {ok: boolean; session?: SessionState; error?: string} {
    const normalized = usernameInput.trim().toLowerCase();
    const users = this.getUsers();
    const user = users.find((u) => u.username.toLowerCase() === normalized);
    const deviceId = getOrCreateDeviceId();

    const validation = validateLoginAccess(user, passwordInput, deviceId);
    if (!validation.ok || !user) {
      return {ok: false, error: validation.message};
    }

    const boundDeviceId = validation.shouldBindDevice ? deviceId : getEffectiveDeviceId(user);
    const updatedUsers = users.map((u) => {
      if (u.id !== user.id) return u;
      return {
        ...u,
        deviceId: boundDeviceId,
        lastLoginAt: new Date().toISOString(),
      };
    });
    writeJSON(USERS_KEY, updatedUsers);

    const session: SessionState = {
      userId: user.id,
      username: user.username,
      role: user.role,
      deviceId,
      loggedInAt: new Date().toISOString(),
    };
    writeJSON(SESSION_KEY, session);
    this.appendLog(`[Auth] ${user.username} authenticated`, 'success');
    this.emitChange();
    return {ok: true, session};
  }

  public logout(): void {
    // Clear ONLY the active session & SSE stream.
    // Never clear local device fingerprint or Firebase /users/{username}/deviceId so same-device re-login succeeds cleanly.
    this.stopLiveSignalsStream();
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(SESSION_KEY);
    }
    this.emitChange();
  }

  public checkCurrentSessionIntegrity(): {valid: boolean; reason?: string} {
    const session = this.getSession();
    if (!session) return {valid: false};
    const user = this.getUsers().find((u) => u.id === session.userId);
    return validateActiveSession(user, session.deviceId);
  }

  // --- BOT SETTINGS & REAL-TIME /bot_settings + /live_signals ---
  public getBotSettings(): BotSettings {
    return readJSON<BotSettings>(SETTINGS_KEY, DEFAULT_BOT_SETTINGS);
  }

  public updateBotSettings(partial: Partial<BotSettings>): BotSettings {
    const next = {...this.getBotSettings(), ...partial};
    writeJSON(SETTINGS_KEY, next);
    this.pushBotSettingsToRtdb();
    this.emitChange();
    return next;
  }

  public switchExchange(exchange: ExchangeType): BotSettings {
    const next = this.updateBotSettings({activeExchange: exchange});
    this.appendLog(`[Exchange] Data feed & execution routing bound to ${exchange}`, 'success');
    return next;
  }

  public switchTradingMode(mode: 'PAPER' | 'LIVE'): void {
    const reset = getModeResetPayload(mode);
    writeJSON(modeStorageKey(EQUITY_KEY, mode), reset.accountBalance);
    writeJSON(modeStorageKey(POSITIONS_KEY, mode), reset.openPositions);
    writeJSON(modeStorageKey(CLOSED_KEY, mode), reset.closedPositions);
    writeJSON(modeStorageKey(SIGNALS_KEY, mode), reset.signals);

    this.updateBotSettings({tradingMode: mode});
    this.pushLiveSignalsToRtdb({
      tradingMode: mode,
      openPosition: reset.openPosition,
      openPositions: reset.openPositions,
      closedPositions: reset.closedPositions,
      signals: reset.signals,
      currentPnL: reset.currentPnL,
      accountBalance: reset.accountBalance,
    });
    this.appendLog(
      mode === 'PAPER'
        ? '[Mode] Switched to PAPER ($10,000.00). Fresh virtual wallet initialized.'
        : '[Mode] Switched to LIVE TRADING. Paper $10,000 balance & mock trades cleared ($0.00 until live API sync).',
      mode === 'LIVE' ? 'warn' : 'info',
    );
    this.emitChange();
  }

  public getEquity(): number {
    const mode = this.getBotSettings().tradingMode;
    const fallback = mode === 'LIVE' ? 0 : 10000.0;
    return readJSON<number>(modeStorageKey(EQUITY_KEY, mode), fallback);
  }

  public hasVerifiedApiKey(exchange?: ExchangeType): boolean {
    return hasVerifiedExchangeKey(this.getApiKeys(), exchange);
  }

  public getOpenPositions(): Position[] {
    const settings = this.getBotSettings();
    if (!this.hasVerifiedApiKey(settings.activeExchange)) {
      return [];
    }
    const mode = settings.tradingMode;
    const raw = readJSON<Position[]>(modeStorageKey(POSITIONS_KEY, mode), []);
    return raw.filter(
      (p) =>
        isBotTrackedPosition(p) &&
        p.status === 'OPEN' &&
        Number.isFinite(p.sizeUsd) &&
        p.sizeUsd > 0 &&
        Number.isFinite(p.marginUsd) &&
        p.marginUsd > 0,
    );
  }

  public openPosition(pos: Position): {ok: boolean; reason?: string} {
    const mode = this.getBotSettings().tradingMode;
    const guard = canExecuteTrade({
      apiKeys: this.getApiKeys(),
      activeExchange: pos.exchange,
      accountBalance: this.getEquity(),
      tradingMode: mode,
      sizeUsd: pos.sizeUsd,
      marginUsd: pos.marginUsd,
    });
    if (!guard.allowed) {
      this.appendLog(`[Gatekeeper Blocked] ${guard.reason || 'Trade blocked.'}`, 'warn');
      return {ok: false, reason: guard.reason};
    }

    const current = this.getOpenPositions();
    if (current.length >= 3) {
      return {ok: false, reason: 'Maximum 3 concurrent open positions reached.'};
    }

    const trackedPos: Position = {
      ...pos,
      clientOrderId: pos.clientOrderId || buildBotClientOrderId(),
      exchangeOrderId: pos.exchangeOrderId || pos.id,
      trackedByBot: true,
    };
    const next = [trackedPos, ...current];
    writeJSON(modeStorageKey(POSITIONS_KEY, mode), next);
    this.appendLog(
      `[Execution] Opened ${trackedPos.side} ${trackedPos.symbol} (${trackedPos.clientOrderId}) @ $${trackedPos.entryPrice} ($${trackedPos.sizeUsd.toLocaleString()} notional, ${trackedPos.leverage}x)`,
      'trade',
    );
    this.pushLiveSignalsToRtdb({
      tradingMode: mode,
      openPositions: next,
      openPosition: `${trackedPos.symbol} ${trackedPos.side} ${trackedPos.leverage}x`,
    });
    this.emitChange();
    return {ok: true};
  }

  public checkSlTpAutoClose(symbol: string, markPrice: number): Position[] {
    if (!Number.isFinite(markPrice) || markPrice <= 0) return [];
    const open = this.getOpenPositions();
    const closedTriggered: Position[] = [];
    for (const pos of open) {
      if (pos.symbol !== symbol) continue;
      const hit = evaluatePositionSlTpHit(pos, markPrice);
      if (hit.hit !== 'NONE') {
        this.closePosition(pos.id, markPrice, hit.realizedPnl, hit.closeReason);
        closedTriggered.push(pos);
      }
    }
    return closedTriggered;
  }

  public async syncBotPositionsFromExchange(
    username: string,
    exchange: ExchangeType,
  ): Promise<{ok: boolean; ignoredManualCount: number}> {
    if (!username.trim() || !this.hasVerifiedApiKey(exchange)) {
      return {ok: true, ignoredManualCount: 0};
    }
    try {
      const res = await fetch('/api/exchange/sync-positions', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({username: username.trim(), exchange}),
      });
      if (!res.ok) return {ok: false, ignoredManualCount: 0};
      const json = (await res.json()) as {
        ok?: boolean;
        botPositions?: Position[];
        ignoredManualCount?: number;
      };
      if (json.ok && Array.isArray(json.botPositions)) {
        const mode = this.getBotSettings().tradingMode;
        writeJSON(
          modeStorageKey(POSITIONS_KEY, mode),
          json.botPositions.filter((p) => isBotTrackedPosition(p)),
        );
        this.emitChange();
        return {ok: true, ignoredManualCount: json.ignoredManualCount ?? 0};
      }
      return {ok: false, ignoredManualCount: 0};
    } catch {
      return {ok: false, ignoredManualCount: 0};
    }
  }

  public closePosition(
    positionId: string,
    exitPrice: number,
    realizedPnlUsd: number,
    reason = 'Manual close from UI',
  ): void {
    const mode = this.getBotSettings().tradingMode;
    const current = this.getOpenPositions();
    const target = current.find((p) => p.id === positionId);
    if (!target) return;

    const remaining = current.filter((p) => p.id !== positionId);
    writeJSON(modeStorageKey(POSITIONS_KEY, mode), remaining);

    const closedList = this.getClosedPositions();
    const closed: Position = {
      ...target,
      markPrice: exitPrice,
      exitPrice,
      unrealizedPnl: 0,
      realizedPnl: Number(realizedPnlUsd.toFixed(2)),
      roePercent: target.marginUsd > 0 ? Number(((realizedPnlUsd / target.marginUsd) * 100).toFixed(2)) : 0,
      status: 'CLOSED',
      closedAt: Date.now(),
      closeReason: reason,
      trackedByBot: true,
    };
    const nextClosed = [closed, ...closedList].slice(0, 30);
    writeJSON(modeStorageKey(CLOSED_KEY, mode), nextClosed);

    const nextEquity = Math.max(0, Number((this.getEquity() + realizedPnlUsd).toFixed(2)));
    writeJSON(modeStorageKey(EQUITY_KEY, mode), nextEquity);

    this.appendLog(
      `[Position Closed] ${target.symbol} ${target.side} exited @ $${exitPrice} (${realizedPnlUsd >= 0 ? '+' : ''}$${realizedPnlUsd.toFixed(2)})`,
      realizedPnlUsd >= 0 ? 'success' : 'warn',
    );
    this.pushLiveSignalsToRtdb({
      tradingMode: mode,
      openPositions: remaining,
      closedPositions: nextClosed,
      accountBalance: nextEquity,
    });
    this.emitChange();
  }

  public getClosedPositions(): Position[] {
    const mode = this.getBotSettings().tradingMode;
    const raw = readJSON<Position[]>(modeStorageKey(CLOSED_KEY, mode), []);
    return raw.filter((p) => isBotTrackedPosition(p) || p.source === 'AUTO_MSNR' || p.source === 'MANUAL_SNIPER');
  }

  public getSignals(): TradeSignal[] {
    const mode = this.getBotSettings().tradingMode;
    const fallback = mode === 'LIVE' ? [] : SEED_SIGNALS;
    return readJSON<TradeSignal[]>(modeStorageKey(SIGNALS_KEY, mode), fallback);
  }

  public addSignal(sig: TradeSignal): void {
    const mode = this.getBotSettings().tradingMode;
    const current = this.getSignals();
    if (current.some((s) => s.id === sig.id)) return;
    const next = [sig, ...current].slice(0, 25);
    writeJSON(modeStorageKey(SIGNALS_KEY, mode), next);
    this.pushLiveSignalsToRtdb({
      tradingMode: mode,
      signals: next,
      latestSignal: sig,
      footprintTrend: sig.side === 'LONG' ? 'BULLISH_IMBALANCE' : 'BEARISH_IMBALANCE',
    });
    this.emitChange();
  }

  public cleanupData(mode: 'UNEXECUTED_SIGNALS' | 'LOGS_ONLY' | 'ALL_HISTORY'): void {
    const tradingMode = this.getBotSettings().tradingMode;
    if (mode === 'UNEXECUTED_SIGNALS') {
      const nextSignals = this.getSignals().filter((s) => s.status === 'EXECUTED');
      writeJSON(modeStorageKey(SIGNALS_KEY, tradingMode), nextSignals);
      this.pushLiveSignalsToRtdb({tradingMode, signals: nextSignals});
    } else if (mode === 'LOGS_ONLY') {
      writeJSON(LOGS_KEY, []);
    } else if (mode === 'ALL_HISTORY') {
      writeJSON(modeStorageKey(CLOSED_KEY, tradingMode), []);
      writeJSON(modeStorageKey(SIGNALS_KEY, tradingMode), []);
      writeJSON(LOGS_KEY, []);
      this.pushLiveSignalsToRtdb({tradingMode, closedPositions: [], signals: []});
    }
    this.emitChange();
  }

  // --- LOGS & API VAULT ---
  public getLogs(): EngineLogEntry[] {
    return readJSON<EngineLogEntry[]>(LOGS_KEY, SEED_LOGS);
  }

  public appendLog(message: string, type: EngineLogEntry['type'] = 'info'): void {
    const time = new Date().toLocaleTimeString('en-GB', {hour12: false});
    const current = this.getLogs();
    writeJSON(LOGS_KEY, [{time, message, type}, ...current].slice(0, 80));
  }

  public getApiKeys(): ApiKeyRecord[] {
    return readJSON<ApiKeyRecord[]>(API_KEYS_KEY, []);
  }

  public async syncExchangeKeysFromRtdb(username: string): Promise<ApiKeyRecord[]> {
    const clean = username.trim();
    if (!clean) return this.getApiKeys();
    const url = getConfiguredRtdbUrl();
    try {
      let keysMap = await readExchangeKeysFromRtdb(url, clean).catch(() => null);
      if (!keysMap && typeof window !== 'undefined') {
        const apiRes = await fetch(`/api/vault/keys?username=${encodeURIComponent(clean)}`).catch(
          () => null,
        );
        if (apiRes && apiRes.ok) {
          const json = (await apiRes.json()) as {keys?: FirebaseExchangeKeyRecord[]};
          if (Array.isArray(json.keys)) {
            const mapped: ApiKeyRecord[] = json.keys.map((k) => ({
              id: k.id,
              venue: k.venue,
              label: k.label,
              maskedKey: k.maskedKey,
              encryptedPayload: k.encryptedPayload,
              updatedAt: k.updatedAt,
            }));
            writeJSON(API_KEYS_KEY, mapped);
            this.notifyLocal();
            return mapped;
          }
        }
      }
      const list: ApiKeyRecord[] = keysMap
        ? Object.values(keysMap)
            .filter(Boolean)
            .map((k) => ({
              id: k.id,
              venue: k.venue,
              label: k.label,
              maskedKey: k.maskedKey,
              encryptedPayload: k.encryptedPayload,
              updatedAt: k.updatedAt,
            }))
        : [];
      writeJSON(API_KEYS_KEY, list);
      this.notifyLocal();
      return list;
    } catch {
      return this.getApiKeys();
    }
  }

  public async saveExchangeKeyViaBackend(params: {
    username: string;
    venue: ApiKeyRecord['venue'];
    label: string;
    apiKey: string;
    apiSecret: string;
  }): Promise<{ok: boolean; record?: ApiKeyRecord; error?: string}> {
    const username = params.username.trim();
    if (!username) return {ok: false, error: 'Missing active user session.'};

    const apiKey = params.apiKey.trim();
    const apiSecret = params.apiSecret.trim();
    if (!apiKey || !apiSecret) {
      return {ok: false, error: 'Enter both API Key and Secret before encrypting.'};
    }

    const exchange: ExchangeType = params.venue.toUpperCase().includes('MEXC') ? 'MEXC' : 'BINANCE';
    try {
      const res = await fetch('/api/vault/keys', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          username,
          venue: params.venue,
          label: params.label,
          apiKey,
          apiSecret,
        }),
      });
      if (res.ok) {
        const json = (await res.json()) as {ok: boolean; record?: FirebaseExchangeKeyRecord; error?: string};
        if (json.ok && json.record) {
          const localRec: ApiKeyRecord = {
            id: json.record.id,
            venue: json.record.venue,
            label: json.record.label,
            maskedKey: json.record.maskedKey,
            encryptedPayload: json.record.encryptedPayload,
            updatedAt: json.record.updatedAt,
          };
          this.saveApiKey(localRec);
          this.updateBotSettings({autoTrading: true, activeExchange: exchange});
          return {ok: true, record: localRec};
        }
      }
    } catch {
      // Fallback to direct RTDB write below if Express server unavailable
    }

    try {
      const deviceId = getOrCreateDeviceId();
      const encryptedPayload = await encryptApiSecret(apiKey, apiSecret, deviceId);
      const id = `key-${exchange.toLowerCase()}`;
      const record: FirebaseExchangeKeyRecord = {
        id,
        venue: params.venue,
        exchange,
        label: params.label.trim() || params.venue,
        maskedKey: maskApiKey(apiKey),
        encryptedPayload,
        autoTradeEnabled: true,
        updatedAt: new Date().toISOString(),
      };
      await putExchangeKeyInRtdb(getConfiguredRtdbUrl(), username, id, record);
      const localRec: ApiKeyRecord = {
        id: record.id,
        venue: record.venue,
        label: record.label,
        maskedKey: record.maskedKey,
        encryptedPayload: record.encryptedPayload,
        updatedAt: record.updatedAt,
      };
      this.saveApiKey(localRec);
      this.updateBotSettings({autoTrading: true, activeExchange: exchange});
      return {ok: true, record: localRec};
    } catch (err) {
      return {ok: false, error: (err as Error).message};
    }
  }

  public async removeExchangeKeyViaBackend(username: string, id: string): Promise<void> {
    this.removeApiKey(id);
    const clean = username.trim();
    if (!clean) return;
    try {
      await fetch(`/api/vault/keys/${encodeURIComponent(id)}?username=${encodeURIComponent(clean)}`, {
        method: 'DELETE',
      }).catch(() => null);
      await deleteExchangeKeyFromRtdb(getConfiguredRtdbUrl(), clean, id).catch(() => null);
    } catch {
      // Ignored
    }
  }

  public saveApiKey(record: ApiKeyRecord): void {
    const current = this.getApiKeys();
    const next = [record, ...current.filter((k) => k.id !== record.id && k.venue !== record.venue)];
    writeJSON(API_KEYS_KEY, next);
    this.appendLog(`[Vault] Encrypted ${record.venue} API credentials stored in Firebase RTDB.`, 'success');
    this.emitChange();
  }

  public removeApiKey(id: string): void {
    const next = this.getApiKeys().filter((k) => k.id !== id);
    writeJSON(API_KEYS_KEY, next);
    this.emitChange();
  }
}

export function getModeResetPayload(mode: 'PAPER' | 'LIVE'): {
  accountBalance: number;
  currentPnL: number;
  openPosition: string;
  openPositions: Position[];
  closedPositions: Position[];
  signals: TradeSignal[];
} {
  return {
    accountBalance: mode === 'PAPER' ? 10000.0 : 0,
    currentPnL: 0,
    openPosition: 'NONE',
    openPositions: [],
    closedPositions: [],
    signals: [],
  };
}

export const db = new MakkaDatabaseService();
