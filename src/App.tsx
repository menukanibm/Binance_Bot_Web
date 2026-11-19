import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  Activity,
  Layers,
  Radio,
  Search,
  ShieldAlert,
  ShieldCheck,
  Terminal,
  Trash2,
  Webhook,
} from 'lucide-react';
import {CandleChart} from './components/CandleChart';
import {CleanupModal, type CleanupMode} from './components/CleanupModal';
import {DiagnosticModal} from './components/DiagnosticModal';
import {
  ExchangeSelectionScreen,
  type ExchangeConnectionPayload,
} from './components/ExchangeSelectionScreen';
import {IneligibleSignalsList} from './components/IneligibleSignalsList';
import {LoginScreen} from './components/LoginScreen';
import {MarketScannerList} from './components/MarketScannerList';
import {MetricsCards} from './components/MetricsCards';
import {MsnrEntryPanel} from './components/MsnrEntryPanel';
import {Navbar} from './components/Navbar';
import {OfflineIndicator} from './components/OfflineIndicator';
import {OrderFlowL3Panel} from './components/OrderFlowL3Panel';
import {PositionsTable} from './components/PositionsTable';
import {SettingsModal} from './components/SettingsModal';
import {SignalsFeed} from './components/SignalsFeed';
import {WebhookIntegration} from './components/WebhookIntegration';
import {db} from './services/database';
import type {
  BotStatus,
  Candle,
  CcxtPairInfo,
  DecisionLogEntry,
  ExchangeConnectionTelemetry,
  ExchangeType,
  ExchangeWalletBalance,
  FootprintSignalAnalysis,
  IneligibleSignal,
  MarketStreamSnapshot,
  OrderBookLevel,
  Position,
  TickTradeEvent,
} from './types/trading';
import {
  buildBotClientOrderId,
  canExecuteTrade,
  hasVerifiedExchangeKey,
} from './utils/executionGuard';
import {getExchangeThemeAttr, getExchangeThemeMeta} from './utils/exchangeTheme';
import {
  analyzeMsnrFootprint,
  calculatePositionSizing,
  getPairMeta,
  registerDynamicPairs,
} from './utils/tradingMath';

type TabKey =
  | 'TERMINAL'
  | 'SIGNALS'
  | 'SKIPPED'
  | 'POSITIONS'
  | 'SCANNER'
  | 'WEBHOOK'
  | 'LOGS';

// Silent background engine timeframe anchor (multi-timeframe HTF/LTF runs autonomously server-side)
const ENGINE_INTERNAL_INTERVAL = '15m';

export default function App() {
  const [, setVersion] = useState(0);
  const [tickPulse, setTickPulse] = useState(0);
  const [sessionRevokedMessage, setSessionRevokedMessage] = useState<string | null>(null);

  const session = db.getSession();
  const settings = db.getBotSettings();
  const openPositions = db.getOpenPositions();
  const closedPositions = db.getClosedPositions();
  const signals = db.getSignals();
  const apiKeys = db.getApiKeys();
  const equity = db.getEquity();
  const logs = db.getLogs();

  const [verifiedExchange, setVerifiedExchange] = useState<ExchangeType | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>('TERMINAL');
  // Strictly visual-only chart timeframe selector (never alters background bot engine or WS stream)
  const [chartInterval, setChartInterval] = useState<string>('15m');
  const [visualChartCandles, setVisualChartCandles] = useState<Candle[]>([]);
  const [liveCandlesOverride, setLiveCandlesOverride] = useState<Candle[]>([]);
  const [liveOrderBookOverride, setLiveOrderBookOverride] = useState<OrderBookLevel[]>([]);
  const [liveTicksOverride, setLiveTicksOverride] = useState<TickTradeEvent[]>([]);
  const [liveAnalysisOverride, setLiveAnalysisOverride] = useState<FootprintSignalAnalysis | null>(
    null,
  );
  const [liveWallet, setLiveWallet] = useState<ExchangeWalletBalance | null>(() =>
    db.getLiveWalletState(),
  );
  const [isSyncingWallet, setIsSyncingWallet] = useState(false);

  const [wsStreamConnected, setWsStreamConnected] = useState(false);
  const [wsLatencyMs, setWsLatencyMs] = useState<number>(12);
  const [exchangeTelemetry, setExchangeTelemetry] = useState<ExchangeConnectionTelemetry | null>(
    null,
  );
  // STRICT EMPTY-STATE BOOT: zero hardcoded/default pairs, filtered setups, or logs
  const [pairs, setPairs] = useState<CcxtPairInfo[]>([]);
  const [ineligibleSignals, setIneligibleSignals] = useState<IneligibleSignal[]>([]);
  const [decisionLogs, setDecisionLogs] = useState<DecisionLogEntry[]>([]);

  const [isScanning, setIsScanning] = useState(false);
  const [isTogglingBot, setIsTogglingBot] = useState(false);
  const [countdown, setCountdown] = useState(120);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isDiagnosticOpen, setIsDiagnosticOpen] = useState(false);
  const [isCleanupModalOpen, setIsCleanupModalOpen] = useState(false);
  const [cleanupInitialMode, setCleanupInitialMode] = useState<CleanupMode>('UNEXECUTED_SIGNALS');
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const cleanedSessionRef = useRef<string | null>(null);

  const activeSymbol = settings.activeSymbol || 'BTCUSDT';
  const activeExchange = verifiedExchange || settings.activeExchange || 'BINANCE';
  const exchangeThemeAttr = getExchangeThemeAttr(activeExchange);
  const exchangeThemeMeta = getExchangeThemeMeta(activeExchange);

  // Sync root document data-exchange attribute for full CSS theme variable inheritance
  useEffect(() => {
    document.documentElement.setAttribute('data-exchange', exchangeThemeAttr);
  }, [exchangeThemeAttr]);

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    window.setTimeout(() => setToastMsg(null), 5000);
  }, []);

  // Subscribe to reactive database updates + cross-tab BroadcastChannel
  useEffect(() => {
    return db.subscribe(() => {
      setLiveWallet(db.getLiveWalletState());
      setVersion((v) => v + 1);
    });
  }, []);

  const sessionUsername = session?.username ?? '';

  const refreshLiveWallet = useCallback(
    async (username: string, exchange: ExchangeType) => {
      if (!username.trim()) return;
      setIsSyncingWallet(true);
      try {
        await db.syncExchangeKeysFromRtdb(username);
        const wallet = await db.syncLiveWalletFromBackend(username, exchange);
        setLiveWallet(wallet);
      } finally {
        setIsSyncingWallet(false);
      }
    },
    [],
  );

  // Sync Firebase RTDB, real-time EventSource SSE stream, exchangeKeys, & live wallet balance
  useEffect(() => {
    void db.syncFromRtdb();
    if (session?.username) {
      db.startLiveSignalsStream(session.username);
      void db.syncExchangeKeysFromRtdb(session.username).then((keys) => {
        if (hasVerifiedExchangeKey(keys, activeExchange)) {
          void refreshLiveWallet(session.username, activeExchange);
        }
      });
    } else {
      db.stopLiveSignalsStream();
    }
    const timer = window.setInterval(() => {
      setTickPulse((p) => p + 1);
      setCountdown((prev) => (prev <= 1 ? 120 : prev - 1));
      if (db.getSession()) {
        const integrity = db.checkCurrentSessionIntegrity();
        if (!integrity.valid) {
          db.logout();
          db.stopLiveSignalsStream();
          setVerifiedExchange(null);
          setSessionRevokedMessage(integrity.reason || 'Session terminated by Makka Admin.');
          setActiveTab('TERMINAL');
        }
      }
      void db.syncFromRtdb();
    }, 2500);
    return () => {
      window.clearInterval(timer);
      db.stopLiveSignalsStream();
    };
  }, [session?.username, activeExchange, refreshLiveWallet]);

  // Run one-time session Firebase cleanup & live wallet sync once exchange is verified
  useEffect(() => {
    if (!sessionUsername || !verifiedExchange) return;
    const key = `${sessionUsername}:${verifiedExchange}:${db.getSessionStartedAt()}`;
    if (cleanedSessionRef.current !== key) {
      cleanedSessionRef.current = key;
      void db.purgeStaleSessionData(sessionUsername, db.getSessionStartedAt());
      void refreshLiveWallet(sessionUsername, verifiedExchange);
    }
  }, [sessionUsername, verifiedExchange, refreshLiveWallet]);

  const handleTabChange = (tab: TabKey) => {
    setActiveTab(tab);
  };

  const hasVerifiedApiKey = useMemo(
    () =>
      hasVerifiedExchangeKey(apiKeys, activeExchange) ||
      Boolean(liveWallet?.connected && liveWallet.exchange === activeExchange),
    [apiKeys, activeExchange, liveWallet],
  );

  const handleWalletSynced = useCallback(
    (wallet: ExchangeWalletBalance) => {
      setLiveWallet(wallet);
      if (wallet.connected && wallet.ok) {
        showToast(
          `Live ${wallet.exchange} Wallet Synced: $${wallet.totalWalletBalance.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})} USDT`,
        );
      }
    },
    [showToast],
  );
  const displayOpenPositions = useMemo(
    () => (hasVerifiedApiKey ? openPositions : []),
    [hasVerifiedApiKey, openPositions],
  );

  const applyMarketSnapshot = useCallback(
    (snap: MarketStreamSnapshot) => {
      if (Array.isArray(snap.candles)) {
        setLiveCandlesOverride(snap.candles);
      }
      if (Array.isArray(snap.orderBook)) {
        setLiveOrderBookOverride(snap.orderBook);
      }
      if (Array.isArray(snap.recentTicks)) {
        setLiveTicksOverride(snap.recentTicks);
      }
      if (snap.analysis) {
        setLiveAnalysisOverride(snap.analysis);
      }
      setWsStreamConnected(Boolean(snap.wsConnected || snap.source !== 'OFFLINE_NO_DATA'));
      if (typeof snap.latencyMs === 'number' && snap.latencyMs > 0) {
        setWsLatencyMs(Math.max(1, Math.round(snap.latencyMs)));
      }
    },
    [],
  );

  const refreshPublicFeed = useCallback(
    async (sym: string, tf: string, ex: ExchangeType) => {
      try {
        const res = await fetch('/api/market/subscribe', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({
            symbol: sym,
            interval: tf,
            exchange: ex,
            stopLossPercent: settings.stopLossPercent,
          }),
        });
        if (res.ok) {
          const json = (await res.json()) as {ok?: boolean; snapshot?: MarketStreamSnapshot};
          if (json.ok && json.snapshot) {
            applyMarketSnapshot(json.snapshot);
            return;
          }
        }
      } catch {
        // Preserve current live candles if transient network hiccup occurs
      }
    },
    [settings.stopLossPercent, applyMarketSnapshot],
  );

  // Trigger background engine historical back-sync & upstream WS stream on startup/symbol/exchange change ONLY
  useEffect(() => {
    if (sessionUsername && verifiedExchange) {
      void refreshPublicFeed(activeSymbol, ENGINE_INTERNAL_INTERVAL, activeExchange);
    }
  }, [sessionUsername, verifiedExchange, activeSymbol, activeExchange, refreshPublicFeed]);

  // Strictly visual-only chart OHLCV fetch when user changes the chart viewing timeframe
  useEffect(() => {
    if (!sessionUsername || !verifiedExchange) {
      setVisualChartCandles([]);
      return;
    }
    let cancelled = false;
    const params = new URLSearchParams({
      exchange: activeExchange,
      symbol: activeSymbol,
      interval: chartInterval,
      limit: '200',
    });
    void fetch(`/api/market/chart?${params.toString()}`)
      .then(async (res) => {
        if (!res.ok || cancelled) return;
        const json = (await res.json()) as {ok?: boolean; candles?: Candle[]};
        if (!cancelled && json.ok && Array.isArray(json.candles) && json.candles.length > 0) {
          setVisualChartCandles(json.candles);
        }
      })
      .catch(() => null);

    return () => {
      cancelled = true;
    };
  }, [sessionUsername, verifiedExchange, activeSymbol, activeExchange, chartInterval]);

  // Persistent /ws/market real-time WebSocket stream from backend ingestion engine (decoupled from chartInterval)
  useEffect(() => {
    if (!sessionUsername || !verifiedExchange || typeof window === 'undefined') {
      setWsStreamConnected(false);
      return;
    }

    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${proto}//${window.location.host}/ws/market`;
    let socket: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let closed = false;

    const connect = () => {
      if (closed) return;
      try {
        socket = new WebSocket(wsUrl);
      } catch {
        return;
      }

      socket.onopen = () => {
        setWsStreamConnected(true);
        socket?.send(
          JSON.stringify({
            action: 'subscribe',
            symbol: activeSymbol,
            interval: ENGINE_INTERNAL_INTERVAL,
            exchange: activeExchange,
          }),
        );
      };

      socket.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data as string) as {
            event?: string;
            data?: unknown;
          };
          if (msg.event === 'market:snapshot' && msg.data) {
            const snap = msg.data as MarketStreamSnapshot;
            if (snap.symbol === activeSymbol && snap.exchange === activeExchange) {
              applyMarketSnapshot(snap);
              if (typeof snap.lastPrice === 'number' && snap.lastPrice > 0) {
                const autoClosed = db.checkSlTpAutoClose(activeSymbol, snap.lastPrice);
                if (autoClosed.length > 0) {
                  showToast(`${autoClosed[0].symbol} closed via SL/TP trigger @ $${snap.lastPrice}`);
                }
              }
            }
          } else if (msg.event === 'signal:filtered' && msg.data) {
            const flt = msg.data as IneligibleSignal;
            setIneligibleSignals((prev) => {
              if (prev.some((x) => x.id === flt.id)) return prev;
              return [flt, ...prev].slice(0, 35);
            });
          } else if (msg.event === 'execution:auto') {
            void db.syncFromRtdb();
            if (sessionUsername) {
              void refreshLiveWallet(sessionUsername, activeExchange);
            }
            showToast('Autonomous MSNR+L3 trade executed and synced to /active_positions.');
          }
        } catch {
          // Ignore malformed WS frames
        }
      };

      socket.onclose = () => {
        setWsStreamConnected(false);
        if (!closed) {
          reconnectTimer = window.setTimeout(connect, 4000);
        }
      };
    };

    connect();

    return () => {
      closed = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      try {
        socket?.close();
      } catch {
        // Ignore
      }
    };
  }, [
    sessionUsername,
    verifiedExchange,
    activeSymbol,
    activeExchange,
    showToast,
    applyMarketSnapshot,
    refreshLiveWallet,
  ]);

  // 100% Real Exchange Candles Only (Zero Synthetic Fallback)
  const candles = liveCandlesOverride;

  // Visual chart candles decoupled from background engine, with live last-price tick pulse on latest bar
  const chartDisplayCandles = useMemo(() => {
    const base = visualChartCandles.length > 0 ? visualChartCandles : liveCandlesOverride;
    if (base.length === 0) return base;
    const liveLastPrice = liveCandlesOverride[liveCandlesOverride.length - 1]?.close;
    if (!liveLastPrice || liveLastPrice <= 0) return base;
    const latest = base[base.length - 1];
    if (latest.close === liveLastPrice) return base;
    const next = base.slice();
    next[next.length - 1] = {
      ...latest,
      close: liveLastPrice,
      high: Math.max(latest.high, liveLastPrice),
      low: Math.min(latest.low, liveLastPrice),
    };
    return next;
  }, [visualChartCandles, liveCandlesOverride]);

  const analysis = useMemo(() => {
    const base =
      liveAnalysisOverride &&
      liveAnalysisOverride.symbol === activeSymbol &&
      liveAnalysisOverride.exchange === activeExchange
        ? liveAnalysisOverride
        : analyzeMsnrFootprint(
            activeSymbol,
            activeExchange,
            ENGINE_INTERNAL_INTERVAL,
            candles,
            settings.stopLossPercent,
            {
              apiKeyValid: hasVerifiedApiKey,
              orderBook: liveOrderBookOverride,
              recentTicks: liveTicksOverride,
              dataAuthentic: candles.length >= 10,
            },
          );

    if (base.confluenceGate) {
      return {
        ...base,
        confluenceGate: {
          ...base.confluenceGate,
          apiKeyValid: hasVerifiedApiKey,
          canAutoExecute: base.confluenceGate.canEmitSignal && hasVerifiedApiKey,
        },
      };
    }
    return base;
  }, [
    liveAnalysisOverride,
    activeSymbol,
    activeExchange,
    candles,
    liveOrderBookOverride,
    liveTicksOverride,
    settings.stopLossPercent,
    hasVerifiedApiKey,
  ]);

  const livePrices = useMemo(() => {
    const map: Record<string, number> = {};
    for (const p of pairs) {
      map[p.symbol] = p.lastPrice;
    }
    const latestClose = candles[candles.length - 1]?.close;
    if (latestClose && latestClose > 0) {
      map[activeSymbol] = latestClose;
    }
    return map;
  }, [pairs, activeSymbol, candles]);

  // Compute aggregate BotStatus
  const status: BotStatus = useMemo(() => {
    const realizedPnl = closedPositions.reduce((s, p) => s + (p.realizedPnl ?? 0), 0);
    const totalWins = closedPositions.filter((p) => (p.realizedPnl ?? 0) >= 0).length;
    const totalLosses = closedPositions.length - totalWins;
    const winRate =
      closedPositions.length > 0 ? (totalWins / closedPositions.length) * 100 : 0;
    const totalActiveMarginUsdt = displayOpenPositions.reduce((s, p) => s + p.marginUsd, 0);
    const walletConnected = hasVerifiedApiKey && Boolean(liveWallet?.connected && liveWallet?.ok);
    const balance = walletConnected ? liveWallet!.totalWalletBalance : 0;
    const freeUsdt = walletConnected
      ? liveWallet!.availableBalance
      : Math.max(0, Number((balance - totalActiveMarginUsdt).toFixed(2)));

    return {
      isRunning: hasVerifiedApiKey && settings.autoTrading,
      currentAction: !hasVerifiedApiKey
        ? `API Key Required (${activeExchange})`
        : settings.autoTrading
          ? `Scanning ${activeSymbol} (${activeExchange})`
          : 'Bot Standby (Auto-Trade OFF)',
      analyzingSymbol: activeSymbol,
      upcomingSignal: analysis.strongSignal ? `${analysis.symbol} ${analysis.bias}` : null,
      lastScanTime: Date.now() - 12000,
      nextScanTime: Date.now() + countdown * 1000,
      scanIntervalSeconds: 120,
      monitoredPairsCount: pairs.length,
      activePositionsCount: displayOpenPositions.length,
      maxConcurrentTrades: 3,
      concurrentTradesSlotStatus: `${displayOpenPositions.length}/3 Active`,
      totalTrades: closedPositions.length,
      totalWins,
      totalLosses,
      winRate,
      netPnl: Number(realizedPnl.toFixed(2)),
      accountBalance: balance,
      freeUsdt,
      totalActiveMarginUsdt,
      totalActiveMarginPercent:
        balance > 0 ? Number(((totalActiveMarginUsdt / balance) * 100).toFixed(1)) : 0,
      maxTotalMarginPct: settings.maxTotalMarginPct,
      marginMode: settings.marginMode,
      tradingMode: 'LIVE',
      positionCapitalPercent: settings.positionCapitalPercent,
      isLiveWalletConnected: walletConnected,
      ineligibleSignalsCount: ineligibleSignals.length,
      coinglassConnected: wsStreamConnected,
      coinglassStatus: wsStreamConnected ? 'CONNECTED' : 'DISCONNECTED',
      coinglassLatencyMs: wsLatencyMs,
      coinglassKeyMasked: activeExchange === 'MEXC' ? 'MEXC-WS' : 'Binance-WS',
      coinglassMessage: `${activeExchange} Real-Time WS + MSNR Engine: ${wsStreamConnected ? 'LIVE' : 'SYNCING'}`,
      coinglassLastChecked: Date.now(),
      timeframeMode: settings.timeframeMode,
      activeExchange,
      mexcConnected: activeExchange === 'MEXC',
      mexcKeyMasked: '',
    };
  }, [
    settings,
    activeSymbol,
    activeExchange,
    analysis,
    countdown,
    pairs.length,
    displayOpenPositions,
    closedPositions,
    hasVerifiedApiKey,
    liveWallet,
    ineligibleSignals.length,
    wsStreamConnected,
    wsLatencyMs,
  ]);

  const handleLogin = async (username: string, password: string) => {
    const res = await db.loginAsync(username, password);
    if (res.ok && res.session) {
      setSessionRevokedMessage(null);
      setVerifiedExchange(null);
      setIneligibleSignals([]);
      setDecisionLogs([]);
      setPairs([]);
      setVisualChartCandles([]);
      setLiveCandlesOverride([]);
      setLiveOrderBookOverride([]);
      setLiveTicksOverride([]);
      setLiveAnalysisOverride(null);
      cleanedSessionRef.current = null;
      setActiveTab('TERMINAL');
    }
    return res;
  };

  const handleLogout = () => {
    db.logout();
    setVerifiedExchange(null);
    setLiveWallet(null);
    setIneligibleSignals([]);
    setDecisionLogs([]);
    setPairs([]);
    setVisualChartCandles([]);
    setSessionRevokedMessage(null);
    cleanedSessionRef.current = null;
    setActiveTab('TERMINAL');
  };

  const handleToggleBot = () => {
    if (!hasVerifiedApiKey) {
      showToast(`Auto-Trade locked: Save your ${exchangeThemeMeta.venueName} key in API & Settings first.`);
      return;
    }
    if (isTogglingBot) return;
    setIsTogglingBot(true);
    window.setTimeout(() => {
      const next = !settings.autoTrading;
      db.updateBotSettings({autoTrading: next});
      db.appendLog(
        next ? '[Bot] AUTO-TRADE activated (Institutional 4-Pillar Gate live).' : '[Bot] AUTO-TRADE paused.',
        next ? 'success' : 'warn',
      );
      setIsTogglingBot(false);
    }, 800);
  };

  const handleLockOnSymbol = useCallback(
    (sym: string, switchToTerminal = false) => {
      const clean = sym.toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (!clean) return;
      setVisualChartCandles([]);
      setLiveCandlesOverride([]);
      setLiveOrderBookOverride([]);
      setLiveTicksOverride([]);
      setLiveAnalysisOverride(null);
      db.updateBotSettings({activeSymbol: clean});
      if (switchToTerminal) {
        setActiveTab('TERMINAL');
      }
      void fetch('/api/market/lockon', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          exchange: activeExchange,
          symbol: clean,
          interval: ENGINE_INTERNAL_INTERVAL,
        }),
      })
        .then(async (res) => {
          if (!res.ok) return;
          const json = (await res.json()) as {
            ok?: boolean;
            stage2Symbols?: string[];
            snapshot?: MarketStreamSnapshot;
          };
          if (json.ok) {
            if (Array.isArray(json.stage2Symbols)) {
              const s2 = new Set(json.stage2Symbols);
              setExchangeTelemetry((prev) =>
                prev ? {...prev, stage2Symbols: json.stage2Symbols!} : prev,
              );
              setPairs((prev) =>
                prev.map((p) => ({
                  ...p,
                  scanStage: s2.has(p.symbol) ? 'STAGE_2_LOCKON' : 'STAGE_1_DISCOVERY',
                })),
              );
            }
            if (json.snapshot) {
              applyMarketSnapshot(json.snapshot);
            }
          }
        })
        .catch(() => null);
    },
    [activeExchange, applyMarketSnapshot],
  );

  const handleTriggerScan = () => {
    if (isScanning) return;
    setIsScanning(true);
    setCountdown(120);
    void refreshPublicFeed(activeSymbol, ENGINE_INTERNAL_INTERVAL, activeExchange);
    void fetch(`/api/market/scanner?exchange=${encodeURIComponent(activeExchange)}`)
      .then(async (res) => {
        if (!res.ok) return;
        const json = (await res.json()) as {
          ok?: boolean;
          telemetry?: ExchangeConnectionTelemetry;
          pairs?: CcxtPairInfo[];
        };
        if (json.ok && Array.isArray(json.pairs) && json.pairs.length > 0) {
          registerDynamicPairs(json.pairs);
          setPairs(json.pairs);
          if (json.telemetry) setExchangeTelemetry(json.telemetry);
        }
      })
      .catch(() => null);

    if (sessionUsername && hasVerifiedApiKey) {
      void db.syncBotPositionsFromExchange(sessionUsername, activeExchange);
      void refreshLiveWallet(sessionUsername, activeExchange);
    }

    // STRICT INSTITUTIONAL ALL-OR-NOTHING GATEKEEPER
    if (
      analysis.dataAuthentic &&
      analysis.strongSignal &&
      analysis.approved &&
      analysis.confluenceGate?.canEmitSignal &&
      analysis.signal
    ) {
      db.addSignal(analysis.signal);
    } else if (analysis.confluenceGate) {
      const gate = analysis.confluenceGate;
      const failedCheck = gate.checks?.find((c) => !c.passed);
      setIneligibleSignals((prev) => [
        {
          id: `scan-flt-${activeSymbol}-${Date.now()}`,
          symbol: activeSymbol,
          exchange: activeExchange,
          side: analysis.bias,
          failedRule: gate.rejectionLabel,
          reason: failedCheck
            ? `${activeSymbol} @ $${analysis.currentPrice}: Failed ${failedCheck.label} — ${failedCheck.detail}`
            : `${activeSymbol} @ $${analysis.currentPrice}: ${analysis.keyReasoning}`,
          riskRewardRatio: analysis.riskRewardRatio,
          slDistancePercent: analysis.slDistancePercent,
          timestamp: Date.now(),
        },
        ...prev.slice(0, 34),
      ]);
    }

    setDecisionLogs((prev) => [
      {
        id: `dec-${Date.now()}`,
        symbol: activeSymbol,
        exchange: activeExchange,
        outcome: analysis.strongSignal ? 'TRADED' : 'SKIPPED',
        levelId: analysis.freshLevels[0]?.id,
        levelTimeframe: analysis.freshLevels[0]?.timeframe,
        levelType: analysis.freshLevels[0]?.type,
        levelPrice: analysis.freshLevels[0]?.price,
        storyline4h: analysis.storyline4h,
        storyline1h: analysis.storyline1h,
        storyline1d: analysis.storyline1d,
        confluenceScore: analysis.confluenceScore,
        timestamp: Date.now(),
        finalReason: analysis.keyReasoning,
        steps: (analysis.confluenceGate?.checks || []).map((c) => ({
          rule: c.label,
          passed: c.passed,
          detail: c.detail,
        })),
      },
      ...prev.slice(0, 19),
    ]);
    db.appendLog(
      `[Scanner] Evaluated ${pairs.length} pairs · ${activeSymbol} @ $${analysis.currentPrice}: ${analysis.strongSignal ? 'STRONG SIGNAL CONFIRMED' : analysis.confluenceGate?.rejectionLabel || 'HOLD'}.`,
      analysis.strongSignal ? 'success' : 'info',
    );
    window.setTimeout(() => setIsScanning(false), 750);
  };

  const handleExecuteManualTrade = (side: 'LONG' | 'SHORT') => {
    const entryPrice = candles[candles.length - 1]?.close ?? analysis.currentPrice;
    if (!entryPrice || entryPrice <= 0) {
      showToast('Awaiting authentic live market price from exchange.');
      return;
    }
    const sizing = calculatePositionSizing({
      accountBalance: equity,
      riskPercent: settings.riskPercentage,
      stopLossPercent: settings.stopLossPercent,
      entryPrice,
      side,
      leverage: settings.leverage,
    });
    const guard = canExecuteTrade({
      apiKeys,
      activeExchange,
      accountBalance: equity,
      tradingMode: 'LIVE',
      sizeUsd: sizing.positionSizeUsd,
      marginUsd: sizing.marginRequiredUsd,
    });
    if (!guard.allowed) {
      showToast(guard.reason || 'Connect API key in API & Settings to trade.');
      return;
    }
    if (displayOpenPositions.length >= 3) {
      showToast('Maximum 3 concurrent positions open. Close an active trade first.');
      return;
    }
    const clientOrderId = buildBotClientOrderId();
    const newPos: Position = {
      id: `pos-${clientOrderId}`,
      symbol: activeSymbol,
      exchange: activeExchange,
      side,
      leverage: settings.leverage,
      entryPrice,
      markPrice: entryPrice,
      sizeUsd: sizing.positionSizeUsd,
      marginUsd: sizing.marginRequiredUsd,
      stopLoss: Number(sizing.stopLossPrice.toFixed(getPairMeta(activeSymbol).decimals)),
      takeProfit: Number(sizing.takeProfitPrice.toFixed(getPairMeta(activeSymbol).decimals)),
      unrealizedPnl: 0,
      roePercent: 0,
      status: 'OPEN',
      openedAt: Date.now(),
      source: 'MANUAL_SNIPER',
      clientOrderId,
      exchangeOrderId: clientOrderId,
      trackedByBot: true,
    };
    const res = db.openPosition(newPos);
    if (!res.ok) {
      showToast(res.reason || 'Execution blocked.');
      return;
    }
    showToast(`Opened ${side} ${activeSymbol} (${clientOrderId}) @ $${entryPrice} (1:2 R:R).`);
  };

  if (!session) {
    return (
      <>
        <LoginScreen
          onLogin={handleLogin}
          sessionRevokedMessage={sessionRevokedMessage}
        />
        <OfflineIndicator />
      </>
    );
  }

  if (!verifiedExchange) {
    return (
      <>
        <ExchangeSelectionScreen
          username={session.username}
          activeSymbol={activeSymbol}
          onExchangeConnected={(ex, payload?: ExchangeConnectionPayload) => {
            db.switchExchange(ex);
            db.resetSessionLiveStores();
            setIneligibleSignals([]);
            setDecisionLogs([]);
            setVerifiedExchange(ex);
            if (payload?.telemetry) {
              setExchangeTelemetry(payload.telemetry);
              setWsLatencyMs(payload.telemetry.latencyMs);
            }
            if (Array.isArray(payload?.pairs) && payload.pairs.length > 0) {
              registerDynamicPairs(payload.pairs);
              setPairs(payload.pairs);
            }
            if (payload?.snapshot) {
              applyMarketSnapshot(payload.snapshot);
            }
            // Immediately sync stored API keys & real live wallet balance from exchange
            void refreshLiveWallet(session.username, ex).then(() => {
              if (db.hasVerifiedApiKey(ex)) {
                void db.syncBotPositionsFromExchange(session.username, ex);
              }
            });
            const loadedCount = payload?.telemetry?.contractsCount || payload?.pairs?.length || 0;
            showToast(
              `Connection Successful: ${loadedCount} live ${ex} USDT-M perpetual contracts loaded.`,
            );
          }}
          onLogout={handleLogout}
        />
        <OfflineIndicator />
      </>
    );
  }

  const tabs: {key: TabKey; label: string; shortLabel: string; icon: React.ReactNode}[] = [
    {key: 'TERMINAL', label: 'Sniper Terminal', shortLabel: 'Terminal', icon: <Terminal className="w-3.5 h-3.5" />},
    {key: 'SIGNALS', label: `Signals (${signals.length})`, shortLabel: 'Signals', icon: <Radio className="w-3.5 h-3.5" />},
    {key: 'SKIPPED', label: `Filtered (${ineligibleSignals.length})`, shortLabel: 'Filtered', icon: <ShieldAlert className="w-3.5 h-3.5" />},
    {key: 'POSITIONS', label: `Positions (${displayOpenPositions.length}/3)`, shortLabel: 'Positions', icon: <Layers className="w-3.5 h-3.5" />},
    {key: 'SCANNER', label: `Scanner (${pairs.length})`, shortLabel: 'Scanner', icon: <Search className="w-3.5 h-3.5" />},
    {key: 'WEBHOOK', label: 'Webhook', shortLabel: 'Webhook', icon: <Webhook className="w-3.5 h-3.5" />},
    {key: 'LOGS', label: `Logs (${logs.length})`, shortLabel: 'Logs', icon: <Activity className="w-3.5 h-3.5" />},
  ];

  const mobileNavTabs = tabs.filter((t) =>
    ['TERMINAL', 'SIGNALS', 'POSITIONS', 'SCANNER', 'LOGS'].includes(t.key),
  );

  return (
    <div
      data-exchange={exchangeThemeAttr}
      className="ex-app-shell min-h-screen w-full flex flex-col font-sans"
    >
      <Navbar
        status={status}
        settings={settings}
        activeExchange={activeExchange}
        hasVerifiedApiKey={hasVerifiedApiKey}
        isLiveWalletConnected={Boolean(liveWallet?.connected)}
        countdown={countdown}
        isScanning={isScanning}
        isToggling={isTogglingBot}
        currentUser={session.username}
        onToggleBot={handleToggleBot}
        onTriggerScan={handleTriggerScan}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onOpenDiagnostic={() => setIsDiagnosticOpen(true)}
        onOpenCleanup={() => {
          setCleanupInitialMode('UNEXECUTED_SIGNALS');
          setIsCleanupModalOpen(true);
        }}
        onLogout={handleLogout}
      />

      <main className="flex-1 px-2.5 sm:px-5 py-3 sm:py-4 pb-24 md:pb-6 space-y-3 sm:space-y-4 max-w-[1600px] w-full mx-auto">
        <MetricsCards
          status={status}
          settings={settings}
          openPositionsCount={displayOpenPositions.length}
          hasLiveApiKey={hasVerifiedApiKey}
          liveWallet={liveWallet}
          isSyncingWallet={isSyncingWallet}
          onRefreshWallet={() => void refreshLiveWallet(session.username, activeExchange)}
        />

        {toastMsg && (
          <div className="p-3 rounded-xl bg-[rgba(var(--ex-long-rgb),0.12)] border border-[rgba(var(--ex-long-rgb),0.4)] text-[var(--ex-long)] text-xs font-mono flex items-center justify-between">
            <span className="font-semibold">{toastMsg}</span>
            <button
              type="button"
              onClick={() => setToastMsg(null)}
              className="px-2 py-0.5 text-[var(--ex-text)] hover:opacity-80 cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Navigation Tabs */}
        <div className="flex items-center justify-between gap-2 border-b border-[var(--ex-border)] pb-2">
          <div className="flex items-center gap-1.5 bg-[var(--ex-surface)] border border-[var(--ex-border)] rounded-xl p-1 sm:p-1.5 overflow-x-auto no-scrollbar flex-nowrap max-w-full">
            {tabs.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => handleTabChange(t.key)}
                className={`tab-glow-hover px-2.5 sm:px-3.5 py-1.5 rounded-lg text-[11px] sm:text-xs font-bold font-mono transition flex items-center gap-1.5 cursor-pointer border whitespace-nowrap shrink-0 ${
                  activeTab === t.key
                    ? 'ex-tab-active font-black'
                    : 'text-[var(--ex-muted)] border-transparent hover:text-[var(--ex-text)]'
                }`}
              >
                {t.icon}
                <span>{t.label}</span>
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => {
              setCleanupInitialMode('UNEXECUTED_SIGNALS');
              setIsCleanupModalOpen(true);
            }}
            className="hidden sm:flex px-2.5 py-1.5 rounded-lg text-xs font-mono font-semibold text-[var(--ex-muted)] hover:text-amber-400 bg-[var(--ex-surface)] border border-[var(--ex-border)] items-center gap-1.5 cursor-pointer shrink-0 transition"
          >
            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Clear Unexecuted</span>
          </button>
        </div>

        {activeTab === 'TERMINAL' && (
          <div className="space-y-4">
            {/* Pure MSNR + HTF Market-History Context Pipeline Panel */}
            <div className="cyber-card p-3 sm:p-4 rounded-xl space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-[var(--ex-border)] pb-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-bold text-[var(--ex-text)] font-mono">
                    Institutional MSNR + Order-Flow Engine (Real Exchange Data Only)
                  </span>
                  <span aria-hidden="true" className="text-[var(--ex-muted)]">&middot;</span>
                  {analysis.strongSignal ? (
                    <span className="text-[11px] font-mono font-bold text-[var(--ex-long)]">
                      STRONG SIGNAL ({analysis.bias})
                    </span>
                  ) : (
                    <span className="text-[11px] font-mono font-semibold text-[var(--ex-muted)]">
                      {analysis.confluenceGate?.rejectionLabel || `Scanning ${activeSymbol}`}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2 text-[11px] font-mono text-[var(--ex-muted)]">
                  <span>Locked Venue:</span>
                  <span className="font-bold text-[var(--ex-accent)]">
                    {exchangeThemeMeta.venueName}
                  </span>
                </div>
              </div>

              {/* 5 MSNR + HTF Context Pipeline Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2">
                {/* 1 */}
                <div className="ex-surface-inset p-2.5 rounded-lg font-mono">
                  <div className="flex items-center justify-between text-[10px] font-bold text-[var(--ex-text)]">
                    <span>1. MSNR KEY LEVELS</span>
                    <span className="text-[10px] font-bold text-[var(--ex-long)]">
                      {analysis.freshLevels.length} FRESH
                    </span>
                  </div>
                  <div className="text-[10px] text-[var(--ex-muted)] mt-1 truncate">
                    A / V / OCL / RBS / SBR Key Zones
                  </div>
                  <div className="text-[9px] text-[var(--ex-accent)] mt-0.5 truncate">
                    Unfresh Roadblocks: {analysis.unfreshLevels.length}
                  </div>
                </div>

                {/* 2 */}
                <div className="ex-surface-inset p-2.5 rounded-lg font-mono">
                  <div className="flex items-center justify-between text-[10px] font-bold text-[var(--ex-text)]">
                    <span>2. HTF STORYLINE &amp; TAP</span>
                    <span className="text-[10px] font-bold text-[var(--ex-long)]">
                      {analysis.storyline4h}
                    </span>
                  </div>
                  <div className="text-[10px] text-[var(--ex-muted)] mt-1 truncate">
                    Structural Bias: {analysis.storyline4h} &middot; {analysis.storyline1h}
                  </div>
                  <div className="text-[9px] text-[var(--ex-accent)] mt-0.5 truncate">
                    Macro Bias: {analysis.storyline1d}
                  </div>
                </div>

                {/* 3 */}
                <div
                  className={`p-2.5 rounded-lg border font-mono ${
                    analysis.confluenceGate?.msnrDetails.ltfReactionConfirmed
                      ? 'bg-[rgba(var(--ex-long-rgb),0.08)] border-[rgba(var(--ex-long-rgb),0.4)] text-[var(--ex-text)]'
                      : 'ex-surface-inset text-[var(--ex-muted)]'
                  }`}
                >
                  <div className="flex items-center justify-between text-[10px] font-bold">
                    <span className="text-[var(--ex-text)]">3. LTF REACTION TRIGGER</span>
                    <span
                      className={`text-[10px] font-bold ${
                        analysis.confluenceGate?.msnrDetails.ltfReactionConfirmed
                          ? 'text-[var(--ex-long)]'
                          : 'text-[var(--ex-muted)]'
                      }`}
                    >
                      {analysis.confluenceGate?.msnrDetails.ltfReactionConfirmed
                        ? 'CONFIRMED'
                        : 'AWAITING'}
                    </span>
                  </div>
                  <div className="text-[10px] text-[var(--ex-muted)] mt-1 truncate">
                    {analysis.signal
                      ? `Confirmed Engulfing @ $${analysis.signal.entryPrice}`
                      : 'Wick Sweep + Closed Engulfing Gate'}
                  </div>
                  <div className="text-[9px] text-[var(--ex-accent)] mt-0.5 truncate">
                    No Blind Limit on MSNR Line
                  </div>
                </div>

                {/* 4 */}
                <div className="ex-surface-inset p-2.5 rounded-lg font-mono">
                  <div className="flex items-center justify-between text-[10px] font-bold text-[var(--ex-text)]">
                    <span>4. ORDER-FLOW &amp; L3</span>
                    <span className="text-[10px] font-bold text-[var(--ex-accent)]">
                      SCORE {analysis.confluenceScore}/4
                    </span>
                  </div>
                  <div className="text-[10px] text-[var(--ex-muted)] mt-1 truncate">
                    Zone: {analysis.htfContext.swingRange4h.currentZone}
                  </div>
                  <div className="text-[9px] text-[var(--ex-accent)] mt-0.5 truncate">
                    300% Imb + Iceberg + Anti-Spoof
                  </div>
                </div>

                {/* 5 */}
                <div
                  className={`p-2.5 rounded-lg border font-mono ${
                    analysis.strongSignal
                      ? 'bg-[rgba(var(--ex-accent-rgb),0.1)] border-[rgba(var(--ex-accent-rgb),0.5)] text-[var(--ex-text)]'
                      : 'ex-surface-inset text-[var(--ex-muted)]'
                  }`}
                >
                  <div className="flex items-center justify-between text-[10px] font-bold">
                    <span className="text-[var(--ex-text)]">5. TRAFFIC &amp; SL/TP GUARD</span>
                    <span className="text-[10px] font-bold text-[var(--ex-accent)]">
                      1:{analysis.riskRewardRatio.toFixed(2)}R
                    </span>
                  </div>
                  <div className="text-[10px] text-[var(--ex-text)] mt-1 truncate tabular-nums">
                    SL ${analysis.stopLoss} &middot; TP ${analysis.takeProfit}
                  </div>
                  <div className="text-[9px] text-[var(--ex-long)] mt-0.5 truncate">
                    {analysis.keyReasoning}
                  </div>
                </div>
              </div>
            </div>

            <CandleChart
              candles={chartDisplayCandles}
              recentTicks={liveTicksOverride}
              liveOrderBook={liveOrderBookOverride}
              analysis={analysis}
              activePosition={displayOpenPositions.find((p) => p.symbol === activeSymbol) || null}
              latestSignal={signals.find((s) => s.symbol === activeSymbol) || null}
              symbol={activeSymbol}
              interval={chartInterval}
              coinglassConnected={status.coinglassConnected}
              pairs={pairs}
              settings={settings}
              equity={equity}
              hasVerifiedApiKey={hasVerifiedApiKey}
              tickPulse={tickPulse}
              onSymbolChange={(sym) => handleLockOnSymbol(sym, false)}
              onIntervalChange={(tf) => setChartInterval(tf)}
              onUpdateSettings={(partial) => db.updateBotSettings(partial)}
              onExecuteManualTrade={handleExecuteManualTrade}
            />

            {analysis.l3Snapshot && analysis.confluenceGate && (
              <OrderFlowL3Panel
                symbol={activeSymbol}
                l3={analysis.l3Snapshot}
                gate={analysis.confluenceGate}
                hasVerifiedApiKey={hasVerifiedApiKey}
                stage2Symbols={exchangeTelemetry?.stage2Symbols || [activeSymbol]}
              />
            )}

            <MsnrEntryPanel
              analysis={analysis}
              settings={settings}
              hasVerifiedApiKey={hasVerifiedApiKey}
              equity={equity}
              onExecuteSetup={handleExecuteManualTrade}
            />

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <PositionsTable
                openPositions={displayOpenPositions}
                closedPositions={closedPositions}
                livePrices={livePrices}
                onClosePosition={(id, exit, pnl) => db.closePosition(id, exit, pnl)}
                onSelectSymbol={(sym) => db.updateBotSettings({activeSymbol: sym})}
                onOpenCleanupHistory={() => {
                  setCleanupInitialMode('ALL_HISTORY');
                  setIsCleanupModalOpen(true);
                }}
                tradingMode="LIVE"
                activeExchange={activeExchange}
                hasVerifiedApiKey={hasVerifiedApiKey}
              />
              <SignalsFeed
                signals={signals}
                status={status}
                onSelectSymbol={(sym) => db.updateBotSettings({activeSymbol: sym})}
                onOpenCleanupSignals={() => {
                  setCleanupInitialMode('UNEXECUTED_SIGNALS');
                  setIsCleanupModalOpen(true);
                }}
              />
            </div>
          </div>
        )}

        {activeTab === 'SIGNALS' && (
          <SignalsFeed
            signals={signals}
            status={status}
            onSelectSymbol={(sym) => {
              db.updateBotSettings({activeSymbol: sym});
              handleTabChange('TERMINAL');
            }}
            onOpenCleanupSignals={() => {
              setCleanupInitialMode('UNEXECUTED_SIGNALS');
              setIsCleanupModalOpen(true);
            }}
          />
        )}

        {activeTab === 'SKIPPED' && (
          <IneligibleSignalsList
            ineligibleSignals={ineligibleSignals}
            onSelectSymbol={(sym) => {
              db.updateBotSettings({activeSymbol: sym});
              handleTabChange('TERMINAL');
            }}
          />
        )}

        {activeTab === 'POSITIONS' && (
          <PositionsTable
            openPositions={displayOpenPositions}
            closedPositions={closedPositions}
            livePrices={livePrices}
            onClosePosition={(id, exit, pnl) => db.closePosition(id, exit, pnl)}
            onSelectSymbol={(sym) => {
              db.updateBotSettings({activeSymbol: sym});
              handleTabChange('TERMINAL');
            }}
            onOpenCleanupHistory={() => {
              setCleanupInitialMode('ALL_HISTORY');
              setIsCleanupModalOpen(true);
            }}
            tradingMode="LIVE"
            activeExchange={activeExchange}
            hasVerifiedApiKey={hasVerifiedApiKey}
          />
        )}

        {activeTab === 'SCANNER' && (
          <MarketScannerList
            pairs={pairs}
            selectedSymbol={activeSymbol}
            activeExchange={activeExchange}
            telemetry={exchangeTelemetry}
            onSelectSymbol={(sym) => handleLockOnSymbol(sym, true)}
          />
        )}

        {activeTab === 'WEBHOOK' && (
          <WebhookIntegration
            username={session.username}
            status={status}
            selectedSymbol={activeSymbol}
            analysis={analysis}
          />
        )}

        {activeTab === 'LOGS' && (
          <div className="space-y-4">
            <div className="cyber-card rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-cyan-500/20 bg-[#06090e]/85 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-cyan-400" aria-hidden="true" />
                  <span className="font-bold text-white text-xs uppercase tracking-wider font-mono glow-heading-cyan">
                    Institutional MSNR + Order-Flow Decision Log ({decisionLogs.length})
                  </span>
                </div>
                <span className="text-[11px] font-mono text-cyan-300">
                  9-Point Quantitative Check Audit Trail
                </span>
              </div>
              <div className="p-4 font-mono text-xs space-y-2 max-h-[320px] overflow-y-auto bg-[#06090f]">
                {decisionLogs.length === 0 ? (
                  <div className="text-slate-500">
                    No live scan evaluations recorded yet. Trigger a scan or await incoming exchange ticks.
                  </div>
                ) : (
                  decisionLogs.map((dec) => (
                    <div
                      key={dec.id}
                      className="p-2.5 rounded-lg bg-[#0a101d] border border-slate-800 space-y-1.5"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              dec.outcome === 'TRADED'
                                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                                : 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                            }`}
                          >
                            {dec.outcome}
                          </span>
                          <span className="font-bold text-white">{dec.symbol}</span>
                          <span className="text-[10px] text-slate-400">({dec.exchange})</span>
                        </div>
                        <span className="text-[10px] text-slate-400">
                          Bias: {dec.storyline4h} &bull; {new Date(dec.timestamp).toLocaleTimeString()}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-200">{dec.finalReason}</div>
                      <div className="flex flex-wrap gap-1">
                        {dec.steps.map((st, idx) => (
                          <span
                            key={idx}
                            className={`text-[9px] px-1.5 py-0.5 rounded border ${
                              st.passed
                                ? 'bg-emerald-950/40 border-emerald-500/30 text-emerald-300'
                                : 'bg-rose-950/50 border-rose-500/40 text-rose-300 font-bold'
                            }`}
                          >
                            {st.rule}: {st.passed ? 'PASS' : 'FAIL'}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="cyber-card rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-cyan-500/20 bg-[#06090e]/85 flex items-center gap-2">
                <Activity className="w-4 h-4 text-cyan-400" aria-hidden="true" />
                <span className="font-bold text-white text-xs uppercase tracking-wider font-mono glow-heading-cyan">
                  Makka MSNR Bot — Engine Activity Stream
                </span>
              </div>
              <div className="p-4 font-mono text-xs space-y-1.5 max-h-[320px] overflow-y-auto bg-[#06090e]">
                {logs.length === 0 ? (
                  <div className="text-slate-500">No engine logs recorded.</div>
                ) : (
                  logs.map((log, i) => (
                    <div key={i} className="flex items-start gap-2.5">
                      <span className="text-slate-500 select-none">[{log.time}]</span>
                      <span
                        className={
                          log.type === 'trade'
                            ? 'text-cyan-400 font-bold'
                            : log.type === 'success'
                              ? 'text-emerald-400'
                              : log.type === 'warn'
                                ? 'text-rose-400'
                                : 'text-slate-300'
                        }
                      >
                        {log.message}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Mobile Bottom Navigation Bar (iOS & Android PWA) */}
      <nav
        aria-label="Mobile Navigation"
        className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-[var(--ex-surface)]/95 backdrop-blur-md border-t border-[var(--ex-border)] safe-area-bottom px-1.5 py-1 flex items-center justify-around shadow-[0_-6px_24px_rgba(0,0,0,0.65)]"
      >
        {mobileNavTabs.map((t) => {
          const isActive = activeTab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => handleTabChange(t.key)}
              className={`flex flex-col items-center justify-center py-1 px-2.5 rounded-lg font-mono text-[10px] font-bold transition cursor-pointer min-h-[42px] border ${
                isActive
                  ? 'ex-accent-pill'
                  : 'text-[var(--ex-muted)] hover:text-[var(--ex-text)] border-transparent'
              }`}
            >
              {t.icon}
              <span className="mt-0.5 leading-tight">{t.shortLabel}</span>
            </button>
          );
        })}
      </nav>

      <footer className="hidden md:block border-t border-[var(--ex-border)] py-3 px-4 text-center text-xs text-[var(--ex-muted)] font-mono bg-[var(--ex-surface-inset)]">
        Makka Footprint Bot &middot; {exchangeThemeMeta.venueName} &middot; Institutional MSNR + Order-Flow Engine
      </footer>

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        username={session.username}
        activeExchange={activeExchange}
        settings={settings}
        status={status}
        apiKeys={apiKeys}
        onSaveSettings={(partial) => db.updateBotSettings(partial)}
        onSaveApiKey={(rec) => db.saveApiKey(rec)}
        onRemoveApiKey={(id) => {
          db.removeApiKey(id);
          setLiveWallet(db.getLiveWalletState());
        }}
        onWalletSynced={handleWalletSynced}
        onOpenDiagnostic={() => {
          setIsSettingsOpen(false);
          setIsDiagnosticOpen(true);
        }}
      />

      <DiagnosticModal
        isOpen={isDiagnosticOpen}
        onClose={() => setIsDiagnosticOpen(false)}
        initialSymbol={activeSymbol}
        activeExchange={activeExchange}
      />

      <CleanupModal
        isOpen={isCleanupModalOpen}
        onClose={() => setIsCleanupModalOpen(false)}
        initialMode={cleanupInitialMode}
        openPositionsCount={openPositions.length}
        closedPositionsCount={closedPositions.length}
        signalsCount={signals.length}
        logsCount={logs.length}
        onConfirmCleanup={(mode) => {
          db.cleanupData(mode);
          if (mode === 'ALL_HISTORY' || mode === 'UNEXECUTED_SIGNALS') {
            setIneligibleSignals([]);
            setDecisionLogs([]);
          }
          showToast('Cleanup completed. Active open positions remain preserved.');
        }}
      />

      <OfflineIndicator />
    </div>
  );
}
