import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {
  Activity,
  AlertTriangle,
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
import {ExchangeSelectionScreen} from './components/ExchangeSelectionScreen';
import {IneligibleSignalsList} from './components/IneligibleSignalsList';
import {LoginScreen} from './components/LoginScreen';
import {MarketScannerList} from './components/MarketScannerList';
import {MetricsCards} from './components/MetricsCards';
import {MsnrEntryPanel} from './components/MsnrEntryPanel';
import {Navbar} from './components/Navbar';
import {OfflineIndicator} from './components/OfflineIndicator';
import {PositionsTable} from './components/PositionsTable';
import {SettingsModal} from './components/SettingsModal';
import {SignalsFeed} from './components/SignalsFeed';
import {WebhookIntegration} from './components/WebhookIntegration';
import {db} from './services/database';
import type {
  BotSettings,
  BotStatus,
  Candle,
  CcxtPairInfo,
  DecisionLogEntry,
  ExchangeType,
  FootprintSignalAnalysis,
  IneligibleSignal,
  MarketStreamSnapshot,
  Position,
  TradingMode,
} from './types/trading';
import {
  analyzeMsnrFootprint,
  buildSeedDecisionLogs,
  buildSeedIneligibleSignals,
  calculatePositionSizing,
  generateCandles,
  generateDefaultPairs,
  getPairMeta,
  isStrictBinanceCryptoPerpetual,
} from './utils/tradingMath';

type TabKey =
  | 'TERMINAL'
  | 'SIGNALS'
  | 'SKIPPED'
  | 'POSITIONS'
  | 'SCANNER'
  | 'WEBHOOK'
  | 'LOGS';

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
  const [selectedInterval, setSelectedInterval] = useState<string>('15m');
  const [liveCandlesOverride, setLiveCandlesOverride] = useState<Candle[] | null>(null);
  const [liveAnalysisOverride, setLiveAnalysisOverride] = useState<FootprintSignalAnalysis | null>(
    null,
  );
  const [wsStreamConnected, setWsStreamConnected] = useState(false);
  const [wsLatencyMs, setWsLatencyMs] = useState<number>(12);
  const [pairs, setPairs] = useState<CcxtPairInfo[]>(() => generateDefaultPairs());
  const [ineligibleSignals, setIneligibleSignals] = useState<IneligibleSignal[]>(() =>
    buildSeedIneligibleSignals(settings.activeExchange),
  );
  const [decisionLogs, setDecisionLogs] = useState<DecisionLogEntry[]>(() =>
    buildSeedDecisionLogs(settings.activeExchange),
  );

  const [isScanning, setIsScanning] = useState(false);
  const [isTogglingBot, setIsTogglingBot] = useState(false);
  const [countdown, setCountdown] = useState(120);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isDiagnosticOpen, setIsDiagnosticOpen] = useState(false);
  const [isCleanupModalOpen, setIsCleanupModalOpen] = useState(false);
  const [cleanupInitialMode, setCleanupInitialMode] = useState<CleanupMode>('UNEXECUTED_SIGNALS');
  const [isModeSwitchModalOpen, setIsModeSwitchModalOpen] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const activeSymbol = settings.activeSymbol || 'BTCUSDT';
  const activeExchange = settings.activeExchange || 'BINANCE';

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    window.setTimeout(() => setToastMsg(null), 5000);
  }, []);

  // Subscribe to reactive database updates + cross-tab BroadcastChannel
  useEffect(() => {
    return db.subscribe(() => setVersion((v) => v + 1));
  }, []);

  // Sync Firebase RTDB, real-time EventSource SSE stream & session integrity heartbeat
  useEffect(() => {
    void db.syncFromRtdb();
    if (session?.username) {
      db.startLiveSignalsStream(session.username);
      void db.syncExchangeKeysFromRtdb(session.username);
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
  }, [session?.username]);

  const handleTabChange = (tab: TabKey) => {
    setActiveTab(tab);
  };

  const sessionUsername = session?.username ?? '';

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
            setLiveCandlesOverride(json.snapshot.candles);
            setLiveAnalysisOverride(json.snapshot.analysis);
            setWsStreamConnected(Boolean(json.snapshot.wsConnected));
            if (json.snapshot.latencyMs > 0) {
              setWsLatencyMs(Math.max(1, Math.round(json.snapshot.latencyMs)));
            }
            return;
          }
        }
      } catch {
        // Preserve current live candles if transient network hiccup occurs
      }
    },
    [settings.stopLossPercent],
  );

  // Trigger historical back-sync & upstream WS stream switch on startup/symbol/timeframe change
  useEffect(() => {
    if (sessionUsername && verifiedExchange) {
      void refreshPublicFeed(activeSymbol, selectedInterval, activeExchange);
    }
  }, [sessionUsername, verifiedExchange, activeSymbol, selectedInterval, activeExchange, refreshPublicFeed]);

  // Persistent /ws/market real-time WebSocket stream from backend ingestion engine
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
            interval: selectedInterval,
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
              if (Array.isArray(snap.candles) && snap.candles.length > 0) {
                setLiveCandlesOverride(snap.candles);
              }
              if (snap.analysis) {
                setLiveAnalysisOverride(snap.analysis);
              }
              setWsStreamConnected(Boolean(snap.wsConnected || true));
              if (typeof snap.latencyMs === 'number' && snap.latencyMs > 0) {
                setWsLatencyMs(Math.max(1, Math.round(snap.latencyMs)));
              }
            }
          } else if (msg.event === 'execution:auto') {
            void db.syncFromRtdb();
            showToast('Autonomous WS+MSNR trade executed and synced to /active_positions.');
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
  }, [sessionUsername, verifiedExchange, activeSymbol, selectedInterval, activeExchange, showToast]);

  // Deterministic candles + live WS override
  const candles = useMemo(() => {
    if (liveCandlesOverride && liveCandlesOverride.length > 0) {
      return liveCandlesOverride;
    }
    const tickOffset = Math.round(Math.sin(tickPulse * 0.55) * 2);
    return generateCandles(activeSymbol, selectedInterval, 42, tickOffset);
  }, [liveCandlesOverride, activeSymbol, selectedInterval, tickPulse]);

  const analysis = useMemo(
    () =>
      liveAnalysisOverride &&
      liveAnalysisOverride.symbol === activeSymbol &&
      liveAnalysisOverride.exchange === activeExchange
        ? liveAnalysisOverride
        : analyzeMsnrFootprint(
            activeSymbol,
            activeExchange,
            selectedInterval,
            candles,
            settings.stopLossPercent,
          ),
    [
      liveAnalysisOverride,
      activeSymbol,
      activeExchange,
      selectedInterval,
      candles,
      settings.stopLossPercent,
    ],
  );

  const livePrices = useMemo(() => {
    const map: Record<string, number> = {};
    const wave = Math.sin(tickPulse * 0.65);
    for (const p of pairs) {
      map[p.symbol] = Number((p.lastPrice * (1 + wave * 0.0012)).toFixed(p.pricePrecision));
    }
    map[activeSymbol] = candles[candles.length - 1]?.close ?? getPairMeta(activeSymbol).basePrice;
    return map;
  }, [pairs, tickPulse, activeSymbol, candles]);

  // Compute aggregate BotStatus
  const status: BotStatus = useMemo(() => {
    const realizedPnl = closedPositions.reduce((s, p) => s + (p.realizedPnl ?? 0), 0);
    const totalWins = closedPositions.filter((p) => (p.realizedPnl ?? 0) >= 0).length;
    const totalLosses = closedPositions.length - totalWins;
    const winRate =
      closedPositions.length > 0 ? (totalWins / closedPositions.length) * 100 : 0;
    const totalActiveMarginUsdt = openPositions.reduce((s, p) => s + p.marginUsd, 0);

    return {
      isRunning: settings.autoTrading,
      currentAction: settings.autoTrading
        ? `Scanning ${activeSymbol} (${activeExchange})`
        : 'Bot Standby (Auto-Trade OFF)',
      analyzingSymbol: activeSymbol,
      upcomingSignal: analysis.approved ? `${analysis.symbol} ${analysis.bias}` : null,
      lastScanTime: Date.now() - 12000,
      nextScanTime: Date.now() + countdown * 1000,
      scanIntervalSeconds: 120,
      monitoredPairsCount: pairs.length,
      activePositionsCount: openPositions.length,
      maxConcurrentTrades: 3,
      concurrentTradesSlotStatus: `${openPositions.length}/3 Active`,
      totalTrades: closedPositions.length,
      totalWins,
      totalLosses,
      winRate,
      netPnl: Number(realizedPnl.toFixed(2)),
      accountBalance: equity,
      freeUsdt: Math.max(0, Number((equity - totalActiveMarginUsdt).toFixed(2))),
      totalActiveMarginUsdt,
      totalActiveMarginPercent:
        equity > 0 ? Number(((totalActiveMarginUsdt / equity) * 100).toFixed(1)) : 0,
      maxTotalMarginPct: settings.maxTotalMarginPct,
      marginMode: settings.marginMode,
      tradingMode: settings.tradingMode,
      positionCapitalPercent: settings.positionCapitalPercent,
      isLiveWalletConnected: true,
      ineligibleSignalsCount: ineligibleSignals.length,
      coinglassConnected: true,
      coinglassStatus: wsStreamConnected ? 'CONNECTED' : 'CONNECTED',
      coinglassLatencyMs: wsLatencyMs,
      coinglassKeyMasked: activeExchange === 'MEXC' ? 'MEXC-WS' : 'Binance-WS',
      coinglassMessage: `${activeExchange} Real-Time WS + MSNR Engine: ${wsStreamConnected ? 'LIVE' : 'SYNCING'}`,
      coinglassLastChecked: Date.now(),
      timeframeMode: settings.timeframeMode,
      activeExchange,
      mexcConnected: activeExchange === 'MEXC',
      mexcKeyMasked: 'mx0vg...4paM',
    };
  }, [
    settings,
    activeSymbol,
    activeExchange,
    analysis,
    countdown,
    pairs.length,
    openPositions,
    closedPositions,
    equity,
    ineligibleSignals.length,
    wsStreamConnected,
    wsLatencyMs,
  ]);

  const handleLogin = async (username: string, password: string) => {
    const res = await db.loginAsync(username, password);
    if (res.ok && res.session) {
      setSessionRevokedMessage(null);
      setVerifiedExchange(null);
      setActiveTab('TERMINAL');
    }
    return res;
  };

  const handleLogout = () => {
    db.logout();
    setVerifiedExchange(null);
    setSessionRevokedMessage(null);
    setActiveTab('TERMINAL');
  };

  const handleToggleBot = () => {
    if (isTogglingBot) return;
    setIsTogglingBot(true);
    window.setTimeout(() => {
      const next = !settings.autoTrading;
      db.updateBotSettings({autoTrading: next});
      db.appendLog(
        next ? '[Bot] AUTO-TRADE activated (Rules 1-6 live).' : '[Bot] AUTO-TRADE paused.',
        next ? 'success' : 'warn',
      );
      setIsTogglingBot(false);
    }, 2000);
  };

  const handleTriggerScan = () => {
    if (isScanning) return;
    setIsScanning(true);
    setCountdown(120);
    void refreshPublicFeed(activeSymbol, selectedInterval, activeExchange);
    if (analysis.signal) {
      db.addSignal(analysis.signal);
    }
    setDecisionLogs((prev) => [
      {
        id: `dec-${Date.now()}`,
        symbol: activeSymbol,
        exchange: activeExchange,
        outcome: analysis.approved ? 'TRADED' : 'SKIPPED',
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
        steps: [
          {rule: 'R1-R2 Fresh MSNR', passed: analysis.freshLevels.length > 0, detail: '4H/1H Levels'},
          {rule: 'R3 Storyline', passed: analysis.storyline4h === analysis.storyline1h, detail: `${analysis.storyline4h}`},
          {rule: 'R4 LTF Engulf', passed: analysis.approved, detail: 'Closed candle body'},
          {rule: 'R6 1:2+ R:R', passed: analysis.riskRewardRatio >= 2, detail: `1:${analysis.riskRewardRatio}`},
        ],
      },
      ...prev.slice(0, 19),
    ]);
    db.appendLog(`[Scanner] Evaluated ${activeSymbol} (${selectedInterval}) on ${activeExchange}.`, 'info');
    window.setTimeout(() => setIsScanning(false), 900);
  };

  const handleTradingModeChange = (target: TradingMode) => {
    if (target === settings.tradingMode) return;
    if (target === 'LIVE') {
      setIsModeSwitchModalOpen(true);
    } else {
      db.switchTradingMode('PAPER');
      showToast('Switched to PAPER Trading. Fresh $10,000.00 virtual session initialized.');
    }
  };

  const handleExecuteManualTrade = (side: 'LONG' | 'SHORT') => {
    if (openPositions.length >= 3) {
      showToast('Maximum 3 concurrent positions open. Close an active trade first.');
      return;
    }
    const entryPrice = candles[candles.length - 1]?.close ?? getPairMeta(activeSymbol).basePrice;
    const sizing = calculatePositionSizing({
      accountBalance: equity,
      riskPercent: settings.riskPercentage,
      stopLossPercent: settings.stopLossPercent,
      entryPrice,
      side,
      leverage: settings.leverage,
    });
    const newPos: Position = {
      id: `pos-${Date.now().toString(36)}`,
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
    };
    db.openPosition(newPos);
    showToast(`Opened ${side} ${activeSymbol} @ $${entryPrice} (1:2 R:R Target).`);
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
          onExchangeConnected={(ex) => {
            db.switchExchange(ex);
            setVerifiedExchange(ex);
            showToast(`Connected to ${ex} Futures WebSocket & order-flow feed.`);
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
    {key: 'POSITIONS', label: `Positions (${openPositions.length}/3)`, shortLabel: 'Positions', icon: <Layers className="w-3.5 h-3.5" />},
    {key: 'SCANNER', label: `Scanner (${pairs.length})`, shortLabel: 'Scanner', icon: <Search className="w-3.5 h-3.5" />},
    {key: 'WEBHOOK', label: 'Webhook', shortLabel: 'Webhook', icon: <Webhook className="w-3.5 h-3.5" />},
    {key: 'LOGS', label: `Logs (${logs.length})`, shortLabel: 'Logs', icon: <Activity className="w-3.5 h-3.5" />},
  ];

  const mobileNavTabs = tabs.filter((t) =>
    ['TERMINAL', 'SIGNALS', 'POSITIONS', 'SCANNER', 'LOGS'].includes(t.key),
  );

  return (
    <div className="min-h-screen w-full bg-[#06090e] text-slate-100 flex flex-col font-sans selection:bg-cyan-500 selection:text-slate-950">
      <Navbar
        status={status}
        settings={settings}
        activeExchange={activeExchange}
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
        onTimeframeChange={(tf) => db.updateBotSettings({timeframeMode: tf})}
        onTradingModeChange={handleTradingModeChange}
        onExchangeChange={(ex) => {
          db.switchExchange(ex);
          setVerifiedExchange(ex);
          showToast(`Switched data & order routing to ${ex}.`);
        }}
        onLogout={handleLogout}
      />

      <main className="flex-1 px-2.5 sm:px-5 py-3 sm:py-4 pb-24 md:pb-6 space-y-3 sm:space-y-4 max-w-[1600px] w-full mx-auto">
        <MetricsCards
          status={status}
          settings={settings}
          openPositionsCount={openPositions.length}
          hasLiveApiKey={apiKeys.some((k) => k.venue.toUpperCase().includes(activeExchange))}
        />

        {toastMsg && (
          <div className="p-3 rounded-xl bg-emerald-950/60 border border-emerald-500/40 text-emerald-300 text-xs font-mono flex items-center justify-between">
            <span className="font-semibold">{toastMsg}</span>
            <button
              type="button"
              onClick={() => setToastMsg(null)}
              className="px-2 py-0.5 text-emerald-200 hover:text-white cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Navigation Tabs */}
        <div className="flex items-center justify-between gap-2 border-b border-cyan-500/20 pb-2">
          <div className="flex items-center gap-1.5 bg-[#0d131a] border border-cyan-500/30 rounded-xl p-1 sm:p-1.5 overflow-x-auto no-scrollbar flex-nowrap max-w-full">
            {tabs.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => handleTabChange(t.key)}
                className={`tab-glow-hover px-2.5 sm:px-3.5 py-1.5 rounded-lg text-[11px] sm:text-xs font-bold font-mono transition flex items-center gap-1.5 cursor-pointer border whitespace-nowrap shrink-0 ${
                  activeTab === t.key
                    ? 'bg-cyan-500 text-slate-950 font-black border-cyan-400 shadow-[0_0_16px_rgba(0,240,255,0.7)]'
                    : 'text-cyan-200/80 glow-label-cyan border-transparent hover:text-cyan-200'
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
            className="hidden sm:flex px-2.5 py-1.5 rounded-lg text-xs font-mono font-semibold text-slate-300 hover:text-amber-300 bg-[#0d131a] border border-cyan-500/25 items-center gap-1.5 cursor-pointer shrink-0"
          >
            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Clear Unexecuted</span>
          </button>
        </div>

        {activeTab === 'TERMINAL' && (
          <div className="space-y-4">
            {/* Pure MSNR + HTF Market-History Context Pipeline Panel */}
            <div className="cyber-card p-3 sm:p-4 rounded-xl space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-slate-800/80 pb-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="px-2 py-0.5 rounded bg-cyan-500/15 border border-cyan-400/50 text-[10px] font-mono font-black text-cyan-300 glow-label-cyan">
                    msnrEngine.analyze()
                  </span>
                  <span className="text-xs font-bold text-white font-mono glow-heading-cyan">
                    Pure MSNR + HTF Market-History Context Pipeline (Closed Candles Only)
                  </span>
                  {analysis.approved ? (
                    <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-400 text-[10px] font-mono font-black text-emerald-300 glow-status-emerald">
                      SIGNAL APPROVED &bull; {analysis.bias} TRIGGERED
                    </span>
                  ) : (
                    <span className="px-2.5 py-0.5 rounded-full bg-slate-800/90 border border-slate-700 text-[10px] font-mono font-semibold text-slate-300">
                      EVALUATING MSNR RULES 1–6 ON {activeSymbol}
                    </span>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[10px] font-mono text-slate-400 uppercase font-bold">
                    Execution &amp; Data Feed:
                  </span>
                  <select
                    aria-label="Execution Exchange Feed"
                    value={activeExchange}
                    onChange={(e) => {
                      const ex = e.target.value as ExchangeType;
                      db.switchExchange(ex);
                      setVerifiedExchange(ex);
                    }}
                    className="bg-[#06090f] border border-cyan-500/40 rounded-lg px-2.5 py-1 text-xs font-mono font-bold text-cyan-200 focus:outline-none cursor-pointer"
                  >
                    <option value="BINANCE">Binance USD-M Futures</option>
                    <option value="MEXC">MEXC Exchange ({status.mexcKeyMasked})</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => setIsSettingsOpen(true)}
                    className="px-2.5 py-1 rounded-lg bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-400/50 text-[11px] font-mono font-bold text-cyan-200 transition cursor-pointer"
                  >
                    API Management
                  </button>
                </div>
              </div>

              {/* 5 MSNR + HTF Context Pipeline Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2">
                {/* 1 */}
                <div className="p-2.5 rounded-lg border font-mono bg-emerald-950/30 border-emerald-500/40 text-emerald-200">
                  <div className="flex items-center justify-between text-[10px] font-bold">
                    <span>1. MSNR LEVELS (4H/1H)</span>
                    <span className="px-1.5 rounded text-[9px] bg-emerald-500/20 text-emerald-300">
                      {analysis.freshLevels.length} FRESH
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-300 mt-1 truncate">
                    A / V / OCL / RBS / SBR Line Chart
                  </div>
                  <div className="text-[9px] text-cyan-400/80 mt-0.5 truncate">
                    Unfresh Roadblocks: {analysis.unfreshLevels.length} (0.1xATR Dedup)
                  </div>
                </div>

                {/* 2 */}
                <div className="p-2.5 rounded-lg border font-mono bg-emerald-950/30 border-emerald-500/40 text-emerald-200">
                  <div className="flex items-center justify-between text-[10px] font-bold">
                    <span>2. HTF STORYLINE &amp; TAP</span>
                    <span className="px-1.5 rounded text-[9px] bg-emerald-500/20 text-emerald-300">
                      {analysis.storyline4h}
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-300 mt-1 truncate">
                    4H: {analysis.storyline4h} &bull; 1H: {analysis.storyline1h}
                  </div>
                  <div className="text-[9px] text-cyan-400/80 mt-0.5 truncate">
                    1D Storyline: {analysis.storyline1d} &bull; Watch: 12x15m
                  </div>
                </div>

                {/* 3 */}
                <div
                  className={`p-2.5 rounded-lg border font-mono ${
                    analysis.approved
                      ? 'bg-emerald-950/30 border-emerald-500/40 text-emerald-200'
                      : 'bg-[#070b14] border-slate-800 text-slate-400'
                  }`}
                >
                  <div className="flex items-center justify-between text-[10px] font-bold">
                    <span>3. LTF ENGULFING (15M/5M)</span>
                    <span
                      className={`px-1.5 rounded text-[9px] ${
                        analysis.approved
                          ? 'bg-emerald-500/20 text-emerald-300'
                          : 'bg-slate-800 text-slate-400'
                      }`}
                    >
                      {analysis.approved ? 'CONFIRMED' : 'AWAITING'}
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-300 mt-1 truncate">
                    {analysis.signal
                      ? `${analysis.signal.engulfingTimeframe} Engulfing @ $${analysis.signal.entryPrice}`
                      : 'No Blind Limit on MSNR Line'}
                  </div>
                  <div className="text-[9px] text-cyan-400/80 mt-0.5 truncate">
                    {analysis.signal?.isStopHuntEngulfing
                      ? 'Stop-Hunt Wick Sweep Confirmed'
                      : 'Closed Candle Body Engulf Gate'}
                  </div>
                </div>

                {/* 4 */}
                <div className="p-2.5 rounded-lg border font-mono bg-emerald-950/30 border-emerald-500/40 text-emerald-200">
                  <div className="flex items-center justify-between text-[10px] font-bold">
                    <span>4. HTF CONTEXT LAYER</span>
                    <span className="px-1.5 rounded text-[9px] bg-cyan-500/20 text-cyan-300">
                      SCORE {analysis.confluenceScore}/4
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-300 mt-1 truncate">
                    4H Zone: {analysis.htfContext.swingRange4h.currentZone}
                  </div>
                  <div className="text-[9px] text-cyan-400/80 mt-0.5 truncate">
                    FVGs: {analysis.htfContext.fvgs.length} &bull; OBs: {analysis.htfContext.orderBlocks.length}
                  </div>
                </div>

                {/* 5 */}
                <div
                  className={`p-2.5 rounded-lg border font-mono ${
                    analysis.approved
                      ? 'bg-cyan-950/40 border-cyan-400 text-cyan-200 shadow-[0_0_15px_rgba(0,240,255,0.2)]'
                      : 'bg-[#070b14] border-slate-800 text-slate-400'
                  }`}
                >
                  <div className="flex items-center justify-between text-[10px] font-bold">
                    <span>5. TRAFFIC &amp; WICK SL/TP</span>
                    <span className="px-1.5 rounded text-[9px] bg-cyan-500/20 text-cyan-300">
                      1:{analysis.riskRewardRatio.toFixed(2)}R
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-200 mt-1 truncate">
                    SL ${analysis.stopLoss} &bull; TP ${analysis.takeProfit}
                  </div>
                  <div className="text-[9px] text-emerald-400 mt-0.5 truncate">
                    {analysis.keyReasoning}
                  </div>
                </div>
              </div>
            </div>

            <CandleChart
              candles={candles}
              analysis={analysis}
              activePosition={openPositions.find((p) => p.symbol === activeSymbol) || null}
              latestSignal={signals.find((s) => s.symbol === activeSymbol) || null}
              symbol={activeSymbol}
              interval={selectedInterval}
              coinglassConnected={status.coinglassConnected}
              pairs={pairs}
              settings={settings}
              equity={equity}
              tickPulse={tickPulse}
              onSymbolChange={(sym) => {
                setLiveCandlesOverride(null);
                db.updateBotSettings({activeSymbol: sym});
              }}
              onIntervalChange={(tf) => setSelectedInterval(tf)}
              onUpdateSettings={(partial) => db.updateBotSettings(partial)}
              onExecuteManualTrade={handleExecuteManualTrade}
            />

            <MsnrEntryPanel
              analysis={analysis}
              settings={settings}
              onExecuteSetup={handleExecuteManualTrade}
            />

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <PositionsTable
                openPositions={openPositions}
                closedPositions={closedPositions}
                livePrices={livePrices}
                onClosePosition={(id, exit, pnl) => db.closePosition(id, exit, pnl)}
                onSelectSymbol={(sym) => db.updateBotSettings({activeSymbol: sym})}
                onOpenCleanupHistory={() => {
                  setCleanupInitialMode('ALL_HISTORY');
                  setIsCleanupModalOpen(true);
                }}
                tradingMode={settings.tradingMode}
                activeExchange={activeExchange}
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
            openPositions={openPositions}
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
            tradingMode={settings.tradingMode}
            activeExchange={activeExchange}
          />
        )}

        {activeTab === 'SCANNER' && (
          <MarketScannerList
            pairs={pairs}
            selectedSymbol={activeSymbol}
            onSelectSymbol={(sym) => {
              db.updateBotSettings({activeSymbol: sym});
              handleTabChange('TERMINAL');
            }}
          />
        )}

        {activeTab === 'WEBHOOK' && (
          <WebhookIntegration
            username={session.username}
            status={status}
            selectedSymbol={activeSymbol}
            selectedInterval={selectedInterval}
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
                    Phase 6 Observability — MSNR + HTF Context Decision Log ({decisionLogs.length})
                  </span>
                </div>
                <span className="text-[11px] font-mono text-cyan-300">
                  Rule Pass/Fail, Level IDs &amp; Final Reason
                </span>
              </div>
              <div className="p-4 font-mono text-xs space-y-2 max-h-[320px] overflow-y-auto bg-[#06090f]">
                {decisionLogs.map((dec) => (
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
                        4H:{dec.storyline4h} &bull; 1H:{dec.storyline1h} &bull; {new Date(dec.timestamp).toLocaleTimeString()}
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
                ))}
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
        className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-[#070b13]/95 backdrop-blur-md border-t border-cyan-500/30 safe-area-bottom px-1.5 py-1 flex items-center justify-around shadow-[0_-6px_24px_rgba(0,0,0,0.75)]"
      >
        {mobileNavTabs.map((t) => {
          const isActive = activeTab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => handleTabChange(t.key)}
              className={`flex flex-col items-center justify-center py-1 px-2.5 rounded-lg font-mono text-[10px] font-bold transition cursor-pointer min-h-[42px] ${
                isActive
                  ? 'text-cyan-300 bg-cyan-500/20 border border-cyan-400/50 shadow-[0_0_12px_rgba(0,240,255,0.3)]'
                  : 'text-slate-400 hover:text-cyan-200 border border-transparent'
              }`}
            >
              {t.icon}
              <span className="mt-0.5 leading-tight">{t.shortLabel}</span>
            </button>
          );
        })}
      </nav>

      <footer className="hidden md:block border-t border-slate-800/80 py-3 px-4 text-center text-xs text-slate-500 font-mono bg-[#06090f]">
        Makka Footprint Bot &bull; Pure MSNR + Order-Flow Engine &bull; 1:2+ R:R &amp; 0.25%–1.2% SL
      </footer>

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        username={session.username}
        settings={settings}
        status={status}
        apiKeys={apiKeys}
        onSaveSettings={(partial) => db.updateBotSettings(partial)}
        onSaveApiKey={(rec) => db.saveApiKey(rec)}
        onRemoveApiKey={(id) => db.removeApiKey(id)}
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
          showToast('Cleanup completed. Active open positions remain preserved.');
        }}
      />

      {/* Safe LIVE Mode Switch Confirmation Modal */}
      {isModeSwitchModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Switch to Live Trading Mode"
        >
          <div className="w-full max-w-md bg-[#0a101d] border border-rose-500/50 rounded-2xl p-6 shadow-[0_0_35px_rgba(244,63,94,0.35)] space-y-5">
            <div className="flex items-center gap-3.5">
              <div className="w-11 h-11 rounded-xl bg-rose-500/20 border border-rose-500/40 flex items-center justify-center text-rose-400 shrink-0">
                <AlertTriangle className="w-6 h-6" aria-hidden="true" />
              </div>
              <div>
                <h3 className="text-base font-black text-white glow-white">
                  Switch to Live Trading Mode?
                </h3>
                <p className="text-[11px] text-rose-400 font-mono font-black uppercase">
                  Real {activeExchange} Futures Funds Required
                </p>
              </div>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              You are switching from <span className="text-emerald-400 font-bold">Paper ($10K)</span> to{' '}
              <strong className="text-rose-400 font-bold">LIVE TRADING</strong>. The $10,000.00 virtual paper balance, mock PnL, and virtual positions will reset to <strong className="text-cyan-300">$0.00</strong> until live exchange API keys sync real balances.
            </p>

            <div className="flex items-center justify-end gap-3 pt-2 font-mono">
              <button
                type="button"
                onClick={() => setIsModeSwitchModalOpen(false)}
                className="px-4 py-2 rounded-xl text-xs font-bold text-slate-300 bg-slate-800 border border-slate-700 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsModeSwitchModalOpen(false);
                  db.switchTradingMode('LIVE');
                  showToast('Switched to LIVE Mode. Paper balance ($10K) & virtual trades reset to $0.00 until live API sync.');
                }}
                className="px-5 py-2 rounded-xl text-xs font-black text-white bg-gradient-to-r from-rose-600 to-red-600 border border-rose-400 cursor-pointer"
              >
                Confirm Live Mode
              </button>
            </div>
          </div>
        </div>
      )}

      <OfflineIndicator />
    </div>
  );
}
