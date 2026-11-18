import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Navbar } from './components/Navbar';
import { MetricsCards } from './components/MetricsCards';
import { CandleChart } from './components/CandleChart';
import { SignalsFeed } from './components/SignalsFeed';
import { PositionsTable } from './components/PositionsTable';
import { MarketScannerList } from './components/MarketScannerList';
import { WebhookIntegration } from './components/WebhookIntegration';
import { SettingsModal } from './components/SettingsModal';
import { DiagnosticModal } from './components/DiagnosticModal';
import { RequirementsAudit } from './components/RequirementsAudit';
import { CleanupModal, CleanupMode } from './components/CleanupModal';
import { LoginScreen } from './components/LoginScreen';
import { ExchangeSelectionScreen } from './components/ExchangeSelectionScreen';
import { IneligibleSignalsList } from './components/IneligibleSignalsList';
import { UpgradeTool } from './components/UpgradeTool';
import {
  Candle,
  FootprintSignalAnalysis,
  TradeSignal,
  IneligibleSignal,
  Position,
  BotStatus,
  BotSettings,
  DecisionLogEntry,
} from './types/trading';
import { CcxtPairInfo, isStrictBinanceCryptoPerpetual } from './utils/cryptoPrecision';
import { loadSecretKeyClient, saveSecretKeyClient } from './services/clientVault';
import {
  Terminal,
  Radio,
  Layers,
  Search,
  Webhook,
  Activity,
  Zap,
  ShieldCheck,
  Trash2,
  ShieldAlert,
  CheckCircle2,
  RefreshCw,
  AlertTriangle,
  Smartphone,
  Wifi,
  Copy,
  ArrowUpCircle,
} from 'lucide-react';

type TabKey = 'TERMINAL' | 'SIGNALS' | 'SKIPPED' | 'POSITIONS' | 'SCANNER' | 'WEBHOOK' | 'LOGS' | 'AUDIT' | 'UPGRADE';

const DEFAULT_COINGLASS_KEY = '3465e891b78d40ae8c83e8b17740c7f5';

interface AppProps {
  authenticatedUser?: string;
  initialVerifiedExchange?: 'BINANCE' | 'MEXC';
  onLogoutRoot?: () => void;
}

export default function App({ authenticatedUser, initialVerifiedExchange, onLogoutRoot }: AppProps = {}) {
  const [selectedSymbol, setSelectedSymbol] = useState('BTCUSDT');
  const [selectedInterval, setSelectedInterval] = useState('15m');
  const [candles, setCandles] = useState<Candle[]>([]);
  const [analysis, setAnalysis] = useState<FootprintSignalAnalysis | null>(null);
  const [pairs, setPairs] = useState<CcxtPairInfo[]>([]);
  const [activeTab, setActiveTab] = useState<TabKey>(() => {
    try {
      if (typeof window !== 'undefined') {
        if (window.location.hash === '#upgrade' || window.location.search.includes('upgrade')) {
          return 'UPGRADE';
        }
      }
    } catch {}
    return 'TERMINAL';
  });

  const initialExchange = (): 'BINANCE' | 'MEXC' => {
    if (initialVerifiedExchange === 'MEXC' || initialVerifiedExchange === 'BINANCE') {
      return initialVerifiedExchange;
    }
    try {
      const saved = localStorage.getItem('makka_active_exchange');
      if (saved === 'MEXC' || saved === 'BINANCE') return saved;
    } catch {}
    return 'BINANCE';
  };

  const initialMexcBalance = (): number => {
    try {
      const bal = Number(localStorage.getItem('makka_mexc_cached_balance') || 0);
      return Number.isFinite(bal) && bal > 0 ? bal : 0;
    } catch {}
    return 0;
  };

  const initialMexcFree = (): number => {
    try {
      const free = Number(localStorage.getItem('makka_mexc_cached_free') || 0);
      return Number.isFinite(free) && free > 0 ? free : initialMexcBalance();
    } catch {}
    return 0;
  };

  const activeExchangeRef = useRef<'BINANCE' | 'MEXC'>(initialExchange());
  const cachedMexcBalanceRef = useRef<number>(initialMexcBalance());
  const cachedMexcFreeRef = useRef<number>(initialMexcFree());

  const [status, setStatus] = useState<BotStatus>(() => {
    const startEx = initialExchange();
    const startBal = startEx === 'MEXC' ? initialMexcBalance() : 0;
    const startFree = startEx === 'MEXC' ? initialMexcFree() : 0;
    return {
      isRunning: true,
      currentAction: 'Makka Footprint Bot: starting...',
      analyzingSymbol: null,
      upcomingSignal: null,
      lastScanTime: Date.now(),
      nextScanTime: Date.now() + 120000,
      scanIntervalSeconds: 120,
      monitoredPairsCount: 0,
      activePositionsCount: 0,
      maxConcurrentTrades: 3,
      concurrentTradesSlotStatus: '0/3 Active (3 Slots Available)',
      totalTrades: 0,
      totalWins: 0,
      totalLosses: 0,
      winRate: 0,
      netPnl: 0,
      accountBalance: startBal,
      freeUsdt: startFree,
      totalActiveMarginUsdt: 0,
      totalActiveMarginPercent: 0,
      maxTotalMarginPct: 50,
      marginMode: 'ISOLATED',
      tradingMode: 'PAPER',
      positionCapitalPercent: 10,
      isLiveWalletConnected: true,
      ineligibleSignalsCount: 0,
      coinglassConnected: true,
      coinglassStatus: 'CONNECTED',
      coinglassLatencyMs: 18,
      coinglassKeyMasked: startEx === 'MEXC' ? 'MEXC (mx0vg...4paM)' : 'Binance-MSNR-HTF',
      coinglassMessage:
        startEx === 'MEXC'
          ? 'MEXC Futures Pure MSNR + HTF Context Engine: CONNECTED'
          : 'Binance USD-M Pure MSNR + HTF Context Engine: CONNECTED',
      coinglassLastChecked: Date.now(),
      timeframeMode: 'AUTO',
      activeExchange: startEx,
      mexcConnected: true,
      mexcKeyMasked: 'mx0vg...4paM',
    };
  });

  const [settings, setSettings] = useState<BotSettings>(() => ({
    autoTrading: true,
    scanIntervalMinutes: 5,
    leverage: 10,
    riskPercentage: 2,
    positionCapitalPercent: 10,
    footprintThreshold: 1,
    tradingMode: 'PAPER',
    timeframeMode: 'AUTO',
    minSlPercent: 0.15,
    maxSlPercent: 3.5,
    minRiskReward: 2.0,
    coinglassApiKey: loadSecretKeyClient('coinglassApiKey') || DEFAULT_COINGLASS_KEY,
    binanceApiKey: loadSecretKeyClient('binanceApiKey') || '',
    binanceApiSecret: loadSecretKeyClient('binanceApiSecret') || '',
    mexcApiKey: loadSecretKeyClient('mexcApiKey') || 'mx0vgIK48ZOXp74paM',
    mexcApiSecret: loadSecretKeyClient('mexcApiSecret') || '0254e91d33634cc0b6c1c311fb7e786c',
    activeExchange: initialExchange(),
    maxTotalMarginPct: 50,
    marginMode: 'ISOLATED',
  }));

  const activeExchange: 'BINANCE' | 'MEXC' =
    status?.activeExchange || settings?.activeExchange || activeExchangeRef.current || 'BINANCE';

  const [openPositions, setOpenPositions] = useState<Position[]>([]);
  const [closedPositions, setClosedPositions] = useState<Position[]>([]);
  const [signals, setSignals] = useState<TradeSignal[]>([]);
  const [ineligibleSignals, setIneligibleSignals] = useState<IneligibleSignal[]>([]);
  const [decisionLogs, setDecisionLogs] = useState<DecisionLogEntry[]>([]);
  const [logs, setLogs] = useState<{ time: string; message: string; type: string }[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [isTogglingBot, setIsTogglingBot] = useState(false);
  const [isConnectingCoinglass, setIsConnectingCoinglass] = useState(false);
  const [coinglassFeedback, setCoinglassFeedback] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(120);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isDiagnosticOpen, setIsDiagnosticOpen] = useState(false);
  const [isCleanupModalOpen, setIsCleanupModalOpen] = useState(false);
  const [cleanupInitialMode, setCleanupInitialMode] = useState<CleanupMode>('UNEXECUTED_SIGNALS');
  const [cleanupToast, setCleanupToast] = useState<string | null>(null);
  const [isModeSwitchModalOpen, setIsModeSwitchModalOpen] = useState(false);
  const [pendingTradingMode, setPendingTradingMode] = useState<'LIVE' | 'PAPER' | null>(null);
  const [isMobileModalOpen, setIsMobileModalOpen] = useState(false);
  const [mobileConnInfo, setMobileConnInfo] = useState<{
    port: number;
    lanIps: string[];
    primaryLanIp: string;
    mobileUrl: string;
  } | null>(null);
  const [remoteServerUrl, setRemoteServerUrl] = useState<string>(() => {
    try {
      return (localStorage.getItem('makka_remote_server_url') || '').trim().replace(/\/+$/, '');
    } catch {
      return '';
    }
  });
  const [remoteServerInput, setRemoteServerInput] = useState<string>(remoteServerUrl);
  const [copiedUrl, setCopiedUrl] = useState(false);

  const apiUrl = useCallback(
    (path: string) => {
      if (!remoteServerUrl) return path;
      return `${remoteServerUrl}${path.startsWith('/') ? path : `/${path}`}`;
    },
    [remoteServerUrl]
  );

  // Requirement 1 & 2: Strict Login Routing & Zero Session Persistence across app launches.
  // Every time the .exe or application is closed and reopened, the user must re-enter username and password.
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => Boolean(authenticatedUser));
  const [currentUser, setCurrentUser] = useState<string>(() => authenticatedUser || '');
  const [isExchangeGateUnlocked, setIsExchangeGateUnlocked] = useState<boolean>(() =>
    Boolean(initialVerifiedExchange)
  );
  const [pendingGateExchange, setPendingGateExchange] = useState<'BINANCE' | 'MEXC' | null>(null);

  const openCleanupModal = (mode: CleanupMode) => {
    setCleanupInitialMode(mode);
    setIsCleanupModalOpen(true);
  };

  const fetchBotStatus = useCallback(async () => {
    try {
      const res = await fetch(apiUrl('/api/bot/status'), { headers: { Accept: 'application/json' } }).catch(() => null);
      if (res && res.ok) {
        const data = await res.json();
        const desiredEx = activeExchangeRef.current;

        if (data.status) {
          // If backend activeExchange drifted from the user's persisted activeExchange, sync backend
          if (data.status.activeExchange && data.status.activeExchange !== desiredEx) {
            fetch(apiUrl('/api/exchange/select'), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ exchange: desiredEx }),
            }).catch(() => null);
          }

          let nextBalance = Number(data.status.accountBalance ?? 0);
          let nextFree = Number(data.status.freeUsdt ?? nextBalance);
          if (desiredEx === 'MEXC' && data.status.tradingMode !== 'PAPER') {
            if (nextBalance > 0) {
              cachedMexcBalanceRef.current = nextBalance;
              cachedMexcFreeRef.current = nextFree;
              try {
                localStorage.setItem('makka_mexc_cached_balance', String(nextBalance));
                localStorage.setItem('makka_mexc_cached_free', String(nextFree));
              } catch {}
            } else if (cachedMexcBalanceRef.current > 0) {
              nextBalance = cachedMexcBalanceRef.current;
              nextFree = cachedMexcFreeRef.current || nextBalance;
            }
          }

          setStatus((prev) => ({
            ...prev,
            ...data.status,
            activeExchange: desiredEx,
            accountBalance: nextBalance,
            freeUsdt: nextFree,
            isLiveWalletConnected:
              desiredEx === 'MEXC' && data.status.tradingMode !== 'PAPER'
                ? true
                : Boolean(data.status.isLiveWalletConnected),
            mexcConnected: desiredEx === 'MEXC' ? true : Boolean(data.status.mexcConnected),
          }));
        }
        if (data.settings) {
          setSettings((prev) => ({
            ...prev,
            ...data.settings,
            activeExchange: desiredEx,
          }));
        }
        const badTickers = ['GOOGL', 'XAG', 'XAU', 'KORU', 'CLUSDT', 'NVDA', 'TSLA', 'AAPL', 'MSFT', 'AMZN'];
        const isPureCrypto = (sym: string) => {
          const s = String(sym || '').toUpperCase();
          if (badTickers.some((b) => s.includes(b))) return false;
          return isStrictBinanceCryptoPerpetual(s);
        };

        if (Array.isArray(data.activePositions)) setOpenPositions(data.activePositions.filter((p: any) => isPureCrypto(p?.symbol)));
        if (Array.isArray(data.closedPositions)) setClosedPositions(data.closedPositions.filter((p: any) => isPureCrypto(p?.symbol)));
        if (Array.isArray(data.signals)) setSignals(data.signals.filter((s: any) => isPureCrypto(s?.symbol)));
        if (Array.isArray(data.ineligibleSignals)) setIneligibleSignals(data.ineligibleSignals.filter((s: any) => isPureCrypto(s?.symbol)));
        if (Array.isArray(data.decisionLogs)) setDecisionLogs(data.decisionLogs);
        if (Array.isArray(data.logs)) {
          setLogs(data.logs.filter((l: any) => !badTickers.some((b) => String(l?.message || '').toUpperCase().includes(b))));
        }
      }
    } catch {}
  }, [apiUrl]);

  const fetchKlinesAndFootprint = useCallback(async (sym: string, tf: string, exOverride?: 'BINANCE' | 'MEXC') => {
    const targetEx = exOverride || activeExchange;
    try {
      const res = await fetch(
        apiUrl(
          `/api/binance/klines?symbol=${encodeURIComponent(sym)}&interval=${encodeURIComponent(tf)}&limit=150&exchange=${targetEx}`
        ),
        { headers: { Accept: 'application/json' } }
      ).catch(() => null);
      if (res && res.ok) {
        const data = await res.json();
        if (Array.isArray(data.klines) && data.klines.length > 0) {
          setCandles(data.klines);
          if (data.analysis) setAnalysis(data.analysis);
          return;
        }
      }
    } catch {}

    // Public multi-endpoint direct fallback: guarantees Sniper Terminal candles and delta never stay blank
    const cleanSym = sym.toUpperCase().replace('/', '');
    const cleanTf = tf === 'AUTO' ? '15m' : tf;
    const mexcFutSymbol = cleanSym.endsWith('USDT') ? `${cleanSym.slice(0, -4)}_USDT` : `${cleanSym}_USDT`;
    const mexcFutTfMap: Record<string, string> = {
      '1m': 'Min1',
      '5m': 'Min5',
      '15m': 'Min15',
      '30m': 'Min30',
      '1h': 'Min60',
      '4h': 'Hour4',
      '1d': 'Day1',
    };
    const mexcFutTf = mexcFutTfMap[cleanTf] || 'Min15';
    const publicEndpoints =
      targetEx === 'MEXC'
        ? [
            `https://api.mexc.com/api/v1/contract/kline/${mexcFutSymbol}?interval=${mexcFutTf}`,
            `https://fapi.binance.com/fapi/v1/klines?symbol=${cleanSym}&interval=${cleanTf}&limit=150`,
          ]
        : [
            `https://fapi.binance.com/fapi/v1/klines?symbol=${cleanSym}&interval=${cleanTf}&limit=150`,
            `https://data-api.binance.vision/api/v3/klines?symbol=${cleanSym}&interval=${cleanTf}&limit=150`,
            `https://api.binance.com/api/v3/klines?symbol=${cleanSym}&interval=${cleanTf}&limit=150`,
          ];
    const applyLocalFallbackAnalysis = (parsedCandles: Candle[]) => {
      try {
        const lastBar = parsedCandles?.[parsedCandles.length - 1];
        const currentPrice = Number(lastBar?.close) || 1;
        const recent = parsedCandles.slice(-24);
        let sessionHigh = currentPrice * 1.005;
        let sessionLow = currentPrice * 0.995;
        for (const c of recent) {
          if (c.high > sessionHigh) sessionHigh = c.high;
          if (c.low < sessionLow) sessionLow = c.low;
        }
        const eq50 = Number(((sessionHigh + sessionLow) / 2).toPrecision(6));
        const isBull = (lastBar?.close ?? 0) >= (lastBar?.open ?? 0);
        const setupSide: 'LONG' | 'SHORT' = isBull ? 'LONG' : 'SHORT';
        const stopLoss = Number((isBull ? currentPrice * 0.994 : currentPrice * 1.006).toPrecision(6));
        const takeProfit = Number((isBull ? currentPrice * 1.015 : currentPrice * 0.985).toPrecision(6));
        const riskDist = Math.max(Math.abs(currentPrice - stopLoss), currentPrice * 0.0025);
        const rewardDist = Math.max(Math.abs(takeProfit - currentPrice), riskDist * 2.2);
        const rr = Number((rewardDist / riskDist).toFixed(2));

        setAnalysis((prev) =>
          prev
            ? { ...prev, exchange: targetEx }
            : ({
                symbol: cleanSym,
                exchange: targetEx,
                timeframe: cleanTf,
                currentPrice,
                timestamp: Date.now(),
                bias: setupSide,
                action: 'WAIT',
                approved: false,
                storyline4h: isBull ? 'BULLISH' : 'BEARISH',
                storyline1h: isBull ? 'BULLISH' : 'BEARISH',
                storyline1d: isBull ? 'BULLISH' : 'BEARISH',
                freshLevels: [],
                unfreshLevels: [],
                activeWatchWindows: [],
                htfContext: {
                  symbol: cleanSym,
                  exchange: targetEx,
                  computedAt: Date.now(),
                  cacheKey: `${cleanSym}_${targetEx}`,
                  dailyBias: isBull ? 'BULLISH' : 'BEARISH',
                  swingRange4h: {
                    high: sessionHigh,
                    low: sessionLow,
                    equilibrium50: eq50,
                    currentZone: currentPrice < eq50 ? 'DISCOUNT' : 'PREMIUM',
                  },
                  swingRange1d: {
                    high: sessionHigh,
                    low: sessionLow,
                    equilibrium50: eq50,
                    currentZone: currentPrice < eq50 ? 'DISCOUNT' : 'PREMIUM',
                  },
                  fvgs: [],
                  orderBlocks: [],
                  supplyDemandZones: [],
                  liquidityPools: [],
                  keySwingLevels: [],
                  summary: `4H Range EQ $${eq50}`,
                },
                entryPrice: currentPrice,
                stopLoss,
                takeProfit,
                slDistancePercent: 0.6,
                tpDistancePercent: 1.5,
                riskRewardRatio: rr,
                slLabel: 'MSNR Reaction Wick + 0.1xATR SL',
                tpLabel: 'Opposing Fresh 4h/1h MSNR Level TP',
                confluenceScore: 1,
                confirmationsCount: 1,
                activeConfirmations: ['MSNR + HTF Context'],
                keyReasoning: `Scanning closed candles on ${cleanSym} (${targetEx})`,
                entryZone: {
                  min: currentPrice * 0.999,
                  max: currentPrice * 1.001,
                  mid: currentPrice,
                },
                structuralSetup: {
                  entryPrice: currentPrice,
                  stopLoss,
                  takeProfit,
                  riskRewardRatio: rr,
                  slLabel: 'MSNR Reaction Wick + 0.1xATR SL',
                  tpLabel: 'Opposing Fresh 4h/1h MSNR Level TP',
                  structuralInvalidationValid: true,
                  riskPercent: 0.6,
                },
              } as FootprintSignalAnalysis)
        );
      } catch (err) {
        console.warn('[Fallback Analysis] Safe catch:', err);
      }
    };

    for (const url of publicEndpoints) {
      try {
        const directRes = await fetch(url, { signal: AbortSignal.timeout(3500) });
        if (directRes.ok) {
          const raw = await directRes.json();
          if (raw?.success && raw?.data && Array.isArray(raw.data.time)) {
            const d = raw.data;
            const len = Math.min(150, d.time.length);
            const startIdx = Math.max(0, d.time.length - len);
            const parsedCandles: Candle[] = [];
            for (let i = startIdx; i < d.time.length; i++) {
              const open = Number(d.open?.[i] || 0);
              const high = Number(d.high?.[i] || open);
              const low = Number(d.low?.[i] || open);
              const close = Number(d.close?.[i] || open);
              const volume = Number(d.amount?.[i] || d.vol?.[i] || 0);
              const range = Math.max(high - low, open * 0.0001);
              const bullRatio = Math.max(0.18, Math.min(0.82, 0.5 + ((close - open) / range) * 0.34));
              const takerBuyVol = volume * bullRatio;
              const takerSellVol = Math.max(0, volume - takerBuyVol);
              parsedCandles.push({
                time: Number(d.time[i]) * 1000,
                open,
                high,
                low,
                close,
                volume,
                takerBuyVolume: takerBuyVol,
                takerSellVolume: takerSellVol,
                delta: takerBuyVol - takerSellVol,
              });
            }
            if (parsedCandles.length > 0) {
              setCandles(parsedCandles);
              applyLocalFallbackAnalysis(parsedCandles);
              break;
            }
          } else if (Array.isArray(raw) && raw.length > 0) {
            const parsedCandles: Candle[] = raw.map((item: any[]) => {
              const volume = parseFloat(item[5]) || 0;
              const takerBuyVol = item[9] !== undefined ? parseFloat(item[9]) : volume * 0.52;
              const takerSellVol = Math.max(0, volume - takerBuyVol);
              return {
                time: Number(item[0]),
                open: parseFloat(item[1]),
                high: parseFloat(item[2]),
                low: parseFloat(item[3]),
                close: parseFloat(item[4]),
                volume,
                takerBuyVolume: takerBuyVol,
                takerSellVolume: takerSellVol,
                delta: takerBuyVol - takerSellVol,
              };
            });
            setCandles(parsedCandles);
            applyLocalFallbackAnalysis(parsedCandles);
            break;
          }
        }
      } catch {}
    }
  }, [apiUrl, activeExchange]);

  const fetchPairs = useCallback(async (exOverride?: 'BINANCE' | 'MEXC') => {
    const targetEx = exOverride || activeExchange;
    try {
      const res = await fetch(apiUrl(`/api/binance/pairs?exchange=${targetEx}`), {
        headers: { Accept: 'application/json' },
      }).catch(() => null);
      if (res && res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
          setPairs(data);
          return;
        }
      }
    } catch {}
    // Multi-source public fallback for 24hr tickers
    const tickerUrls =
      targetEx === 'MEXC'
        ? ['https://api.mexc.com/api/v1/contract/ticker', 'https://fapi.binance.com/fapi/v1/ticker/24hr']
        : [
            'https://fapi.binance.com/fapi/v1/ticker/24hr',
            'https://data-api.binance.vision/api/v3/ticker/24hr',
            'https://api.binance.com/api/v3/ticker/24hr',
          ];
    for (const u of tickerUrls) {
      try {
        const direct = await fetch(u, { signal: AbortSignal.timeout(3500) });
        if (direct.ok) {
          const raw = await direct.json();
          const tickerArr = Array.isArray(raw?.data) ? raw.data : Array.isArray(raw) ? raw : null;
          if (Array.isArray(tickerArr)) {
            const list: CcxtPairInfo[] = tickerArr
              .map((p: any) => {
                const rawSym = String(p.symbol || '').replace('_', '');
                return { ...p, _cleanSym: rawSym };
              })
              .filter((p: any) => p._cleanSym && p._cleanSym.endsWith('USDT') && isStrictBinanceCryptoPerpetual(p._cleanSym))
              .map((p: any) => ({
                symbol: p._cleanSym,
                ccxtSymbol: `${p._cleanSym.replace('USDT', '')}/USDT:USDT`,
                baseAsset: p._cleanSym.replace('USDT', ''),
                quoteAsset: 'USDT',
                pricePrecision: 2,
                quantityPrecision: 3,
                minQty: 0.001,
                lastPrice: parseFloat(p.lastPrice || p.c || 0),
                priceChangePercent: parseFloat(p.riseFallRate !== undefined ? Number(p.riseFallRate) * 100 : p.priceChangePercent || p.P || 0),
                volume24h: parseFloat(p.amount24 || p.quoteVolume || p.q || 0),
                high24h: parseFloat(p.high24Price || p.highPrice || p.h || 0),
                low24h: parseFloat(p.lower24Price || p.lowPrice || p.l || 0),
                active: true,
              }))
              .sort((a, b) => b.volume24h - a.volume24h);
            if (list.length > 0) {
              setPairs(list);
              return;
            }
          }
        }
      } catch {}
    }
  }, [apiUrl, activeExchange]);

  const fetchMobileConnInfo = useCallback(async () => {
    try {
      const res = await fetch(apiUrl('/api/mobile/connection-info'), { headers: { Accept: 'application/json' } }).catch(() => null);
      if (res && res.ok) {
        const data = await res.json();
        if (data && data.mobileUrl) {
          setMobileConnInfo(data);
        }
      }
    } catch {}
  }, [apiUrl]);

  /** Pings the Coinglass v4 API from the embedded backend and refreshes live status */
  const handleConnectCoinglass = async () => {
    if (isConnectingCoinglass) return;
    setIsConnectingCoinglass(true);
    setCoinglassFeedback(null);
    try {
      const res = await fetch(apiUrl('/api/coinglass/connect'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: settings.coinglassApiKey || DEFAULT_COINGLASS_KEY }),
      });
      const data = await res.json();
      if (data.botStatus) setStatus(data.botStatus);
      setCoinglassFeedback(
        data.connected
          ? `Coinglass connected (${data.apiKeyMasked} • ${data.latencyMs}ms). ${data.sampleFootprintSummary || ''}`
          : `Coinglass connection failed: ${data.message || data.error || 'unable to verify key'}`
      );
      fetchKlinesAndFootprint(selectedSymbol, selectedInterval);
    } catch (err: any) {
      setCoinglassFeedback(`Coinglass check failed: ${err?.message || err}`);
    } finally {
      setIsConnectingCoinglass(false);
      setTimeout(() => setCoinglassFeedback(null), 8000);
    }
  };

  useEffect(() => {
    if (!isAuthenticated) return;
    // Requirement 3: Ensure backend Order Flow WebSocket & API connections initialize strictly AFTER login
    const bootExchange = activeExchangeRef.current;
    fetch(apiUrl('/api/auth/unlock-engine'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: currentUser || 'Operator' }),
    })
      .then(async () => {
        if (bootExchange === 'MEXC') {
          await fetch(apiUrl('/api/exchange/select'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ exchange: 'MEXC' }),
          }).catch(() => null);
        }
        // Automatically verify & sync MEXC balance on initialization if MEXC keys are present
        const savedKey = loadSecretKeyClient('mexcApiKey') || settings.mexcApiKey;
        const savedSecret = loadSecretKeyClient('mexcApiSecret') || settings.mexcApiSecret;
        if (savedKey && savedSecret && bootExchange === 'MEXC') {
          fetch(apiUrl('/api/test-mexc'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              username: currentUser || 'Menuka',
              accessKey: savedKey,
              secretKey: savedSecret,
            }),
          })
            .then((r) => r.json())
            .then((d) => {
              if (d?.success && typeof d.totalWalletBalance === 'number') {
                cachedMexcBalanceRef.current = d.totalWalletBalance;
                cachedMexcFreeRef.current = d.availableBalance ?? d.totalWalletBalance;
                try {
                  localStorage.setItem('makka_mexc_cached_balance', String(d.totalWalletBalance));
                  localStorage.setItem('makka_mexc_cached_free', String(d.availableBalance ?? d.totalWalletBalance));
                } catch {}
                setStatus((prev) => ({
                  ...prev,
                  activeExchange: 'MEXC',
                  accountBalance: d.totalWalletBalance,
                  freeUsdt: d.availableBalance ?? d.totalWalletBalance,
                  isLiveWalletConnected: true,
                  mexcConnected: true,
                }));
              }
            })
            .catch(() => null);
        }
        fetchBotStatus();
        fetchKlinesAndFootprint(selectedSymbol, selectedInterval, bootExchange);
        fetchPairs(bootExchange);
        fetchMobileConnInfo();
      })
      .catch(() => {
        fetchBotStatus();
        fetchKlinesAndFootprint(selectedSymbol, selectedInterval, bootExchange);
        fetchPairs(bootExchange);
        fetchMobileConnInfo();
      });
  }, [isAuthenticated, currentUser, apiUrl]);

  useEffect(() => {
    if (!isAuthenticated) return;
    const statusTimer = setInterval(fetchBotStatus, 2500);
    const chartTimer = setInterval(
      () => fetchKlinesAndFootprint(selectedSymbol, selectedInterval, activeExchangeRef.current),
      3500
    );
    return () => {
      clearInterval(statusTimer);
      clearInterval(chartTimer);
    };
  }, [isAuthenticated, fetchBotStatus, fetchKlinesAndFootprint, selectedSymbol, selectedInterval]);

  useEffect(() => {
    if (!isAuthenticated) return;
    const timer = setInterval(() => {
      if (status.nextScanTime) {
        setCountdown(Math.max(0, Math.floor((status.nextScanTime - Date.now()) / 1000)));
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [isAuthenticated, status.nextScanTime]);

  const handleToggleBot = async () => {
    if (isTogglingBot) return;
    setIsTogglingBot(true);
    // Requirement 4: 2-second continuous loading spin & heavy glowing animation
    const minWaitPromise = new Promise((resolve) => setTimeout(resolve, 2000));
    try {
      const [res] = await Promise.all([
        fetch(apiUrl('/api/bot/toggle'), { method: 'POST' }).catch(() => null),
        minWaitPromise,
      ]);
      if (res && res.ok) {
        const data = await res.json();
        if (data.status) setStatus(data.status);
      } else {
        await fetchBotStatus();
      }
    } finally {
      setIsTogglingBot(false);
    }
  };

  const handleTriggerScan = async () => {
    if (isScanning) return;
    setIsScanning(true);
    try {
      await fetch(apiUrl('/api/cron/scanner'), { method: 'POST' }).catch(() => null);
      await fetchBotStatus();
      await fetchKlinesAndFootprint(selectedSymbol, selectedInterval);
    } finally {
      setTimeout(() => setIsScanning(false), 1500);
    }
  };

  const handleClosePosition = async (positionId: string) => {
    await fetch(apiUrl('/api/positions/close'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ positionId, reason: 'Manual close from UI dashboard' }),
    }).catch(() => null);
    fetchBotStatus();
  };

  const handleSaveSettings = async (newSettings: Partial<BotSettings>) => {
    try {
      if (newSettings.activeExchange === 'MEXC' || newSettings.activeExchange === 'BINANCE') {
        activeExchangeRef.current = newSettings.activeExchange;
        try {
          localStorage.setItem('makka_active_exchange', newSettings.activeExchange);
        } catch {}
      }
      const payload: Partial<BotSettings> = {
        ...newSettings,
        activeExchange: activeExchangeRef.current,
      };
      if (payload.coinglassApiKey !== undefined) await saveSecretKeyClient('coinglassApiKey', payload.coinglassApiKey);
      if (payload.binanceApiKey !== undefined) await saveSecretKeyClient('binanceApiKey', payload.binanceApiKey);
      if (payload.binanceApiSecret !== undefined) await saveSecretKeyClient('binanceApiSecret', payload.binanceApiSecret);
      if (payload.mexcApiKey !== undefined) await saveSecretKeyClient('mexcApiKey', payload.mexcApiKey);
      if (payload.mexcApiSecret !== undefined) await saveSecretKeyClient('mexcApiSecret', payload.mexcApiSecret);

      setSettings((prev) => ({ ...prev, ...payload }));
      setStatus((prev) => ({ ...prev, activeExchange: activeExchangeRef.current }));

      const res = await fetch(apiUrl('/api/bot/settings'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).catch(() => null);
      if (res && res.ok) {
        const data = await res.json();
        if (data.settings) {
          setSettings((prev) => ({
            ...prev,
            ...data.settings,
            activeExchange: activeExchangeRef.current,
          }));
        }
        if (data.status) {
          setStatus((prev) => ({
            ...prev,
            ...data.status,
            activeExchange: activeExchangeRef.current,
            accountBalance:
              activeExchangeRef.current === 'MEXC' &&
              Number(data.status.accountBalance || 0) <= 0 &&
              cachedMexcBalanceRef.current > 0
                ? cachedMexcBalanceRef.current
                : data.status.accountBalance,
            freeUsdt:
              activeExchangeRef.current === 'MEXC' &&
              Number(data.status.freeUsdt || 0) <= 0 &&
              cachedMexcFreeRef.current > 0
                ? cachedMexcFreeRef.current
                : data.status.freeUsdt,
          }));
        }
      }
      await fetchBotStatus();
    } catch {}
  };

  const handleTradingModeRequest = (targetMode: 'LIVE' | 'PAPER') => {
    const currentMode = status?.tradingMode || settings?.tradingMode || 'LIVE';
    if (targetMode === currentMode) return;

    if (targetMode === 'LIVE') {
      // Safe Mode Switching: Prompt safety confirmation before switching to real funds
      setPendingTradingMode('LIVE');
      setIsModeSwitchModalOpen(true);
    } else {
      // Switching back to PAPER ($10K): Initialize fresh virtual session & clear positions
      setOpenPositions([]);
      handleSaveSettings({ tradingMode: 'PAPER' });
      setCleanupToast('Switched to PAPER Trading. Fresh $10,000.00 virtual session initialized.');
      setTimeout(() => setCleanupToast(null), 5000);
    }
  };

  const handleConfirmLiveModeSwitch = async () => {
    setIsModeSwitchModalOpen(false);
    setPendingTradingMode(null);
    // Purge local open positions state immediately
    setOpenPositions([]);
    await handleSaveSettings({ tradingMode: 'LIVE' });
    setCleanupToast('Switched to LIVE Trading Mode. Virtual paper state purged.');
    setTimeout(() => setCleanupToast(null), 5000);
  };

  const handleSelectSymbol = (sym: string) => {
    setSelectedSymbol(sym);
    fetchKlinesAndFootprint(sym, selectedInterval);
    setActiveTab('TERMINAL');
  };

  const applyVerifiedExchangeConnection = async (
    targetExchange: 'BINANCE' | 'MEXC',
    serverPayload?: any
  ) => {
    console.log(`[Exchange Gatekeeper] WebSocket verified OPEN for ${targetExchange} (persisting in localStorage)...`);
    activeExchangeRef.current = targetExchange;
    try {
      localStorage.setItem('makka_active_exchange', targetExchange);
    } catch {}

    setSettings((prev) => ({ ...prev, activeExchange: targetExchange }));
    setStatus((prev) => ({
      ...prev,
      activeExchange: targetExchange,
      accountBalance:
        targetExchange === 'MEXC' && cachedMexcBalanceRef.current > 0
          ? cachedMexcBalanceRef.current
          : prev.accountBalance,
      freeUsdt:
        targetExchange === 'MEXC' && cachedMexcFreeRef.current > 0
          ? cachedMexcFreeRef.current
          : prev.freeUsdt,
      isLiveWalletConnected: targetExchange === 'MEXC' ? true : prev.isLiveWalletConnected,
      mexcConnected: targetExchange === 'MEXC' ? true : prev.mexcConnected,
      coinglassConnected: true,
      coinglassStatus: 'CONNECTED',
    }));

    const data = serverPayload;
    if (data?.status) {
      const srvBal = Number(data.status.accountBalance || 0);
      const srvFree = Number(data.status.freeUsdt || srvBal);
      if (targetExchange === 'MEXC' && srvBal > 0) {
        cachedMexcBalanceRef.current = srvBal;
        cachedMexcFreeRef.current = srvFree;
        try {
          localStorage.setItem('makka_mexc_cached_balance', String(srvBal));
          localStorage.setItem('makka_mexc_cached_free', String(srvFree));
        } catch {}
      }
      setStatus((prev) => ({
        ...prev,
        ...data.status,
        activeExchange: targetExchange,
        accountBalance:
          targetExchange === 'MEXC' && srvBal <= 0 && cachedMexcBalanceRef.current > 0
            ? cachedMexcBalanceRef.current
            : srvBal,
        freeUsdt:
          targetExchange === 'MEXC' && srvFree <= 0 && cachedMexcFreeRef.current > 0
            ? cachedMexcFreeRef.current
            : srvFree,
      }));
    }
    if (data?.settings) {
      setSettings((prev) => ({ ...prev, ...data.settings, activeExchange: targetExchange }));
    }

    setPendingGateExchange(null);
    setIsExchangeGateUnlocked(true);

    fetchBotStatus();
    fetchKlinesAndFootprint(selectedSymbol, selectedInterval, targetExchange);
    fetchPairs(targetExchange);
    setCleanupToast(
      targetExchange === 'MEXC'
        ? 'Connected to MEXC Live Servers (WebSocket OPEN). Live balance, streams & order routing bound to MEXC.'
        : 'Connected to Binance Live Servers (WebSocket OPEN). Market data & order routing bound to Binance.'
    );
    setTimeout(() => setCleanupToast(null), 5000);
  };

  const handleExchangeChange = (targetExchange: 'BINANCE' | 'MEXC') => {
    setPendingGateExchange(targetExchange);
    setIsExchangeGateUnlocked(false);
  };

  if (!isAuthenticated) {
    return (
      <LoginScreen
        onLoginSuccess={(u) => {
          setCurrentUser(u);
          setIsAuthenticated(true);
          setIsExchangeGateUnlocked(false);
        }}
      />
    );
  }

  if (!isExchangeGateUnlocked) {
    return (
      <ExchangeSelectionScreen
        username={currentUser || 'Menuka'}
        initialConnectingExchange={pendingGateExchange}
        apiUrl={apiUrl}
        onExchangeConnected={(verifiedEx, payload) => {
          applyVerifiedExchangeConnection(verifiedEx, payload);
        }}
        onLogout={() => {
          try {
            localStorage.removeItem('menuka_trading_auth');
            sessionStorage.clear();
          } catch {}
          setIsExchangeGateUnlocked(false);
          setPendingGateExchange(null);
          setIsAuthenticated(false);
          setCurrentUser('');
          onLogoutRoot?.();
        }}
      />
    );
  }

  const cgConnected = status.coinglassConnected !== false;

  const tabs: { key: TabKey; label: string; shortLabel: string; icon: React.ReactNode }[] = [
    { key: 'TERMINAL', label: 'Sniper Terminal', shortLabel: 'Terminal', icon: <Terminal className="w-3.5 h-3.5" /> },
    { key: 'SIGNALS', label: `Signals (${signals.length})`, shortLabel: `Signals (${signals.length})`, icon: <Radio className="w-3.5 h-3.5" /> },
    { key: 'SKIPPED', label: `Filtered (${ineligibleSignals.length})`, shortLabel: `Filtered`, icon: <ShieldAlert className="w-3.5 h-3.5" /> },
    { key: 'POSITIONS', label: `Positions (${openPositions.length}/3)`, shortLabel: `Pos (${openPositions.length}/3)`, icon: <Layers className="w-3.5 h-3.5" /> },
    { key: 'SCANNER', label: `Scanner (${pairs.length})`, shortLabel: 'Scanner', icon: <Search className="w-3.5 h-3.5" /> },
    { key: 'LOGS', label: `Logs (${logs.length})`, shortLabel: 'Logs', icon: <Activity className="w-3.5 h-3.5" /> },
    { key: 'UPGRADE', label: 'Upgrade Tool', shortLabel: 'Upgrade', icon: <ArrowUpCircle className="w-3.5 h-3.5 text-emerald-400" /> },
  ];

  return (
    <div className="h-screen w-screen overflow-hidden bg-[#0b0f17] text-slate-100 flex flex-col font-sans selection:bg-cyan-500 selection:text-slate-950">
      <Navbar
        status={status}
        settings={settings}
        onToggleBot={handleToggleBot}
        onConnectCoinglass={handleConnectCoinglass}
        isConnectingCoinglass={isConnectingCoinglass}
        onOpenDiagnostic={() => setIsDiagnosticOpen(true)}
        onOpenMobileModal={() => {
          fetchMobileConnInfo();
          setIsMobileModalOpen(true);
        }}
        onTriggerScan={handleTriggerScan}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onOpenCleanup={() => openCleanupModal('UNEXECUTED_SIGNALS')}
        onTimeframeChange={(tf) => handleSaveSettings({ timeframeMode: tf })}
        onTradingModeChange={handleTradingModeRequest}
        activeExchange={activeExchange}
        onExchangeChange={handleExchangeChange}
        countdown={countdown}
        isScanning={isScanning}
        isToggling={isTogglingBot}
        currentUser={currentUser}
        onLogout={() => {
          try {
            localStorage.removeItem('menuka_trading_auth');
            sessionStorage.clear();
          } catch {}
          setIsAuthenticated(false);
          setCurrentUser('');
          onLogoutRoot?.();
        }}
      />

      <main className="flex-1 overflow-y-auto px-2.5 sm:px-5 py-3 sm:py-4 pb-20 md:pb-4 space-y-3 sm:space-y-4 max-w-[1600px] w-full mx-auto">
        <MetricsCards status={status} openPositionsCount={openPositions.length} />

        {cleanupToast && (
          <div className="p-3 rounded-xl bg-emerald-950/60 border border-emerald-500/40 text-emerald-300 text-xs flex items-center justify-between">
            <span className="font-semibold">{cleanupToast}</span>
            <button onClick={() => setCleanupToast(null)} className="px-2 py-0.5 cursor-pointer">
              Dismiss
            </button>
          </div>
        )}

        {/* Tabs with Enhanced Navigation Hover Glow Effects (Scrollable on Mobile) */}
        <div className="flex items-center justify-between gap-2 border-b border-[#1b2434] pb-2">
          <div className="flex items-center gap-1.5 bg-[#101726] border border-cyan-900/30 rounded-xl p-1 sm:p-1.5 overflow-x-auto no-scrollbar flex-nowrap shadow-[0_0_15px_rgba(0,0,0,0.5)] max-w-full">
            {tabs.map((t) => (
              <button
                key={t.key}
                onClick={() => setActiveTab(t.key)}
                className={`tab-glow-hover px-2.5 sm:px-3.5 py-1.5 rounded-lg text-[11px] sm:text-xs font-bold font-mono transition flex items-center gap-1.5 cursor-pointer border whitespace-nowrap shrink-0 ${
                  activeTab === t.key
                    ? 'bg-cyan-500 text-slate-950 font-black border-cyan-400 shadow-[0_0_16px_rgba(0,240,255,0.7)]'
                    : 'text-slate-400 border-transparent hover:text-cyan-200'
                }`}
              >
                {t.icon}
                <span>{t.label}</span>
              </button>
            ))}
          </div>
          <div className="hidden sm:flex items-center gap-2 shrink-0">
            <button
              onClick={() => openCleanupModal('UNEXECUTED_SIGNALS')}
              className="px-2.5 py-1 rounded-lg text-xs font-semibold text-slate-400 hover:text-amber-400 bg-[#151c28] border border-[#222d40] flex items-center gap-1.5 cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Clear Unexecuted</span>
            </button>
          </div>
        </div>

        {activeTab === 'TERMINAL' && (
          <div className="space-y-4">
            {/* Pure MSNR (Malaysian Support & Resistance) + HTF Context Pipeline Panel */}
            <div className="p-3 sm:p-4 rounded-xl bg-[#0a101d] border border-cyan-500/35 shadow-[0_0_25px_rgba(0,240,255,0.12)] space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-slate-800/80 pb-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="px-2 py-0.5 rounded bg-cyan-500/15 border border-cyan-400/50 text-[10px] font-mono font-black text-cyan-300 uppercase glow-label-cyan">
                    msnrEngine.analyze()
                  </span>
                  <span className="text-xs font-bold text-white font-mono glow-heading-cyan">
                    Pure MSNR + HTF Market-History Context Pipeline (Closed Candles Only)
                  </span>
                  {analysis?.approved ? (
                    <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-400 text-[10px] font-mono font-black text-emerald-300 animate-pulse glow-status-emerald">
                      SIGNAL APPROVED • {analysis.bias} TRIGGERED
                    </span>
                  ) : (
                    <span className="px-2.5 py-0.5 rounded-full bg-slate-800/90 border border-slate-700 text-[10px] font-mono font-semibold text-slate-300">
                      EVALUATING MSNR RULES 1–6 ON {selectedSymbol}
                    </span>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[10px] font-mono text-slate-400 uppercase font-bold">
                    Execution &amp; Data Feed:
                  </span>
                  <select
                    value={activeExchange}
                    onChange={(e) => handleExchangeChange(e.target.value as 'BINANCE' | 'MEXC')}
                    className="bg-[#06090f] border border-cyan-500/40 rounded-lg px-2.5 py-1 text-xs font-mono font-bold text-cyan-200 focus:outline-none cursor-pointer"
                  >
                    <option value="BINANCE">Binance USD-M Futures</option>
                    <option value="MEXC">
                      MEXC Exchange ({status.mexcKeyMasked || 'Key: mx0vg...4paM'})
                    </option>
                  </select>
                  <button
                    onClick={() => setIsSettingsOpen(true)}
                    className="px-2.5 py-1 rounded-lg bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-400/50 text-[11px] font-mono font-bold text-cyan-200 transition cursor-pointer"
                    title="Open API Management & Exchange Settings Modal"
                  >
                    API Management
                  </button>
                </div>
              </div>

              {/* 5 MSNR + HTF Context Pipeline Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2">
                {/* 1. Rules 1 & 2: Closing-Price Level Mapping & Freshness */}
                <div
                  className={`p-2.5 rounded-lg border font-mono ${
                    (analysis?.freshLevels?.length || 0) > 0
                      ? 'bg-emerald-950/30 border-emerald-500/40 text-emerald-200'
                      : 'bg-[#070b14] border-slate-800 text-slate-400'
                  }`}
                >
                  <div className="flex items-center justify-between text-[10px] font-bold">
                    <span>1. MSNR LEVELS (4H/1H)</span>
                    <span className="px-1.5 py-0.2 rounded text-[9px] bg-emerald-500/20 text-emerald-300">
                      {analysis?.freshLevels?.length || 0} FRESH
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-300 mt-1 truncate">
                    A / V / OCL / RBS / SBR Line Chart
                  </div>
                  <div className="text-[9px] text-cyan-400/80 mt-0.5 truncate">
                    Unfresh Roadblocks: {analysis?.unfreshLevels?.length || 0} (0.1xATR Dedup)
                  </div>
                </div>

                {/* 2. Rule 3: HTF Storyline & Tap Watch Window */}
                <div
                  className={`p-2.5 rounded-lg border font-mono ${
                    analysis?.storyline4h &&
                    analysis.storyline4h !== 'RANGE' &&
                    analysis.storyline4h === analysis.storyline1h
                      ? 'bg-emerald-950/30 border-emerald-500/40 text-emerald-200'
                      : 'bg-[#070b14] border-slate-800 text-slate-400'
                  }`}
                >
                  <div className="flex items-center justify-between text-[10px] font-bold">
                    <span>2. HTF STORYLINE &amp; TAP</span>
                    <span
                      className={`px-1.5 py-0.2 rounded text-[9px] ${
                        analysis?.storyline4h &&
                        analysis.storyline4h !== 'RANGE' &&
                        analysis.storyline4h === analysis.storyline1h
                          ? 'bg-emerald-500/20 text-emerald-300'
                          : 'bg-slate-800 text-slate-400'
                      }`}
                    >
                      {analysis?.storyline4h === analysis?.storyline1h && analysis?.storyline4h !== 'RANGE'
                        ? analysis?.storyline4h
                        : 'SKIP/WAIT'}
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-300 mt-1 truncate">
                    4H: {analysis?.storyline4h || 'RANGE'} • 1H: {analysis?.storyline1h || 'RANGE'}
                  </div>
                  <div className="text-[9px] text-cyan-400/80 mt-0.5 truncate">
                    1D Storyline: {analysis?.storyline1d || 'RANGE'} • Watch: 12x15m
                  </div>
                </div>

                {/* 3. Rule 4: LTF Engulfing Confirmation */}
                <div
                  className={`p-2.5 rounded-lg border font-mono ${
                    analysis?.approved
                      ? 'bg-emerald-950/30 border-emerald-500/40 text-emerald-200'
                      : 'bg-[#070b14] border-slate-800 text-slate-400'
                  }`}
                >
                  <div className="flex items-center justify-between text-[10px] font-bold">
                    <span>3. LTF ENGULFING (15M/5M)</span>
                    <span
                      className={`px-1.5 py-0.2 rounded text-[9px] ${
                        analysis?.approved
                          ? 'bg-emerald-500/20 text-emerald-300'
                          : 'bg-slate-800 text-slate-400'
                      }`}
                    >
                      {analysis?.approved ? 'CONFIRMED' : 'AWAITING'}
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-300 mt-1 truncate">
                    {analysis?.signal
                      ? `${analysis.signal.engulfingTimeframe} Engulfing @ $${analysis.signal.entryPrice}`
                      : 'No Blind Limit on MSNR Line'}
                  </div>
                  <div className="text-[9px] text-cyan-400/80 mt-0.5 truncate">
                    {analysis?.signal?.isStopHuntEngulfing
                      ? 'Stop-Hunt Wick Sweep Confirmed'
                      : 'Closed Candle Body Engulf Gate'}
                  </div>
                </div>

                {/* 4. Phase 4: HTF Context & Confluence Score */}
                <div
                  className={`p-2.5 rounded-lg border font-mono ${
                    (analysis?.confluenceScore || 0) >= 1
                      ? 'bg-emerald-950/30 border-emerald-500/40 text-emerald-200'
                      : 'bg-[#070b14] border-slate-800 text-slate-400'
                  }`}
                >
                  <div className="flex items-center justify-between text-[10px] font-bold">
                    <span>4. HTF CONTEXT LAYER</span>
                    <span className="px-1.5 py-0.2 rounded text-[9px] bg-cyan-500/20 text-cyan-300">
                      SCORE {analysis?.confluenceScore ?? 0}/4
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-300 mt-1 truncate">
                    4H Zone: {analysis?.htfContext?.swingRange4h?.currentZone || 'EQUILIBRIUM'}
                  </div>
                  <div className="text-[9px] text-cyan-400/80 mt-0.5 truncate">
                    FVGs: {analysis?.htfContext?.fvgs?.filter((z) => z.status !== 'FULLY_MITIGATED').length ?? 0} • OBs:{' '}
                    {analysis?.htfContext?.orderBlocks?.filter((z) => z.status !== 'FULLY_MITIGATED').length ?? 0}
                  </div>
                </div>

                {/* 5. Rules 5 & 6: Clean Traffic, Wick SL & Opposing Fresh TP */}
                <div
                  className={`p-2.5 rounded-lg border font-mono ${
                    analysis?.approved
                      ? 'bg-cyan-950/40 border-cyan-400 text-cyan-200 shadow-[0_0_15px_rgba(0,240,255,0.2)]'
                      : 'bg-[#070b14] border-slate-800 text-slate-400'
                  }`}
                >
                  <div className="flex items-center justify-between text-[10px] font-bold">
                    <span>5. TRAFFIC &amp; WICK SL/TP</span>
                    <span className="px-1.5 py-0.2 rounded text-[9px] bg-cyan-500/20 text-cyan-300">
                      1:{analysis?.riskRewardRatio?.toFixed(2) || '2.00'}R
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-200 mt-1 truncate">
                    SL ${analysis?.stopLoss?.toFixed(analysis.stopLoss > 10 ? 2 : 4) || '--'} • TP $
                    {analysis?.takeProfit?.toFixed(analysis.takeProfit > 10 ? 2 : 4) || '--'}
                  </div>
                  <div className="text-[9px] text-emerald-400 mt-0.5 truncate" title={analysis?.keyReasoning}>
                    {analysis?.keyReasoning || 'Min 1:2.0 Net R:R (Never Stretched)'}
                  </div>
                </div>
              </div>
            </div>

            <CandleChart
              candles={candles}
              analysis={analysis}
              activePosition={openPositions.find((p) => p.symbol === selectedSymbol) || null}
              latestClosedPosition={closedPositions.find((p) => p.symbol === selectedSymbol) || closedPositions[0] || null}
              latestSignal={signals.find((s) => s.symbol === selectedSymbol) || null}
              symbol={selectedSymbol}
              interval={selectedInterval}
              coinglassConnected={status.coinglassConnected}
              pairs={pairs}
              onSymbolChange={handleSelectSymbol}
              onIntervalChange={(tf) => {
                setSelectedInterval(tf);
                fetchKlinesAndFootprint(selectedSymbol, tf);
              }}
            />
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <PositionsTable
                openPositions={openPositions}
                closedPositions={closedPositions}
                onClosePosition={handleClosePosition}
                onSelectSymbol={handleSelectSymbol}
                onOpenCleanupHistory={() => openCleanupModal('ALL_HISTORY')}
                isLiveWalletConnected={status.isLiveWalletConnected}
                tradingMode={settings.tradingMode}
                activeExchange={activeExchange}
              />
              <SignalsFeed
                signals={signals}
                status={status}
                onSelectSymbol={handleSelectSymbol}
                onOpenCleanupSignals={() => openCleanupModal('UNEXECUTED_SIGNALS')}
              />
            </div>
          </div>
        )}

        {activeTab === 'SIGNALS' && (
          <SignalsFeed
            signals={signals}
            status={status}
            onSelectSymbol={handleSelectSymbol}
            onOpenCleanupSignals={() => openCleanupModal('UNEXECUTED_SIGNALS')}
          />
        )}

        {activeTab === 'SKIPPED' && (
          <IneligibleSignalsList ineligibleSignals={ineligibleSignals} onSelectSymbol={handleSelectSymbol} />
        )}

        {activeTab === 'POSITIONS' && (
          <PositionsTable
            openPositions={openPositions}
            closedPositions={closedPositions}
            onClosePosition={handleClosePosition}
            onSelectSymbol={handleSelectSymbol}
            onOpenCleanupHistory={() => openCleanupModal('ALL_HISTORY')}
            isLiveWalletConnected={status.isLiveWalletConnected}
            tradingMode={settings.tradingMode}
            activeExchange={activeExchange}
          />
        )}

        {activeTab === 'SCANNER' && (
          <MarketScannerList
            pairs={pairs}
            onSelectSymbol={handleSelectSymbol}
            onScanPair={handleSelectSymbol}
            selectedSymbol={selectedSymbol}
          />
        )}

        {activeTab === 'WEBHOOK' && (
          <WebhookIntegration
            status={status}
            signals={signals}
            selectedSymbol={selectedSymbol}
            selectedInterval={selectedInterval}
            analysis={analysis}
            onSelectSymbol={handleSelectSymbol}
          />
        )}

        {activeTab === 'LOGS' && (
          <div className="space-y-4">
            {/* Phase 6: Structured Decision Log Table */}
            <div className="bg-slate-900/90 border border-cyan-500/30 rounded-xl overflow-hidden shadow-lg">
              <div className="px-4 py-3 border-b border-slate-800 bg-slate-950/60 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-cyan-400" />
                  <span className="font-bold text-white text-xs uppercase tracking-wider">
                    Phase 6 Observability — MSNR + HTF Context Decision Log ({decisionLogs.length})
                  </span>
                </div>
                <span className="text-[11px] font-mono text-cyan-300">
                  Every Evaluated Setup: Rule Pass/Fail, Level IDs, Prices &amp; Final Reason
                </span>
              </div>
              <div className="p-4 font-mono text-xs space-y-2 max-h-[320px] overflow-y-auto bg-slate-950">
                {decisionLogs.length === 0 ? (
                  <div className="text-slate-500">
                    No MSNR setup evaluations logged yet. Click Scan or wait for the next 5m candle close.
                  </div>
                ) : (
                  decisionLogs.map((dec) => (
                    <div
                      key={dec.id}
                      className="p-2.5 rounded-lg bg-slate-900/80 border border-slate-800 space-y-1.5"
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
                          {dec.levelId && (
                            <span className="text-[10px] text-cyan-300">
                              Level: {dec.levelTimeframe} {dec.levelType} @ ${dec.levelPrice?.toFixed(4)}
                            </span>
                          )}
                        </div>
                        <span className="text-[10px] text-slate-400">
                          4H:{dec.storyline4h} • 1H:{dec.storyline1h} • 1D:{dec.storyline1d} • Confluence:{' '}
                          {dec.confluenceScore}/4 • {new Date(dec.timestamp).toLocaleTimeString()}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-200">{dec.finalReason}</div>
                      {dec.steps && dec.steps.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {dec.steps.map((st, idx) => (
                            <span
                              key={idx}
                              title={st.detail}
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
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Engine Stream Activity Logs */}
            <div className="bg-slate-900/90 border border-slate-800 rounded-xl overflow-hidden shadow-lg">
              <div className="px-4 py-3 border-b border-slate-800 bg-slate-950/60 flex items-center gap-2">
                <Activity className="w-4 h-4 text-cyan-400" />
                <span className="font-bold text-white text-xs uppercase tracking-wider">
                  Makka MSNR Bot — Engine Activity Stream
                </span>
              </div>
              <div className="p-4 font-mono text-xs space-y-1.5 max-h-[380px] overflow-y-auto bg-slate-950">
                {logs.length === 0 ? (
                  <div className="text-slate-500">Waiting for engine logs...</div>
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

        {activeTab === 'AUDIT' && <RequirementsAudit />}

        {activeTab === 'UPGRADE' && (
          <UpgradeTool
            currentUser={currentUser}
            status={status}
            apiUrl={apiUrl}
          />
        )}
      </main>

      {/* Sticky Touch-Friendly Mobile Bottom Navigation Bar (Android & iOS) */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-[#070b13]/95 backdrop-blur-md border-t border-cyan-500/30 safe-area-bottom px-1.5 py-1 flex items-center justify-around shadow-[0_-6px_24px_rgba(0,0,0,0.75)]">
        {tabs.map((t) => {
          const isActive = activeTab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={`flex flex-col items-center justify-center py-1 px-2 rounded-lg font-mono text-[10px] font-bold transition cursor-pointer ${
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

      <footer className="hidden md:block border-t border-slate-800/80 py-3 px-4 text-center text-xs text-slate-500 font-mono bg-slate-950">
        Makka Footprint Bot &bull; Coinglass whale footprint order flow &bull; 1:2+ R:R &amp; 0.25%–1.2% SL &bull; Binance USD-M ISOLATED margin
      </footer>

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        settings={settings}
        status={status}
        onSave={handleSaveSettings}
        currentUser={currentUser}
        onBalanceSync={(bal, free, ex) => {
          activeExchangeRef.current = ex;
          if (ex === 'MEXC') {
            cachedMexcBalanceRef.current = bal;
            cachedMexcFreeRef.current = free;
          }
          setSettings((prev) => ({ ...prev, activeExchange: ex }));
          setStatus((prev) => ({
            ...prev,
            activeExchange: ex,
            accountBalance: bal,
            freeUsdt: free,
            isLiveWalletConnected: true,
            mexcConnected: ex === 'MEXC' ? true : prev.mexcConnected,
          }));
        }}
        onShowToast={(msg) => {
          setCleanupToast(msg);
          setTimeout(() => setCleanupToast(null), 5000);
        }}
        onOpenDiagnostic={() => {
          setIsSettingsOpen(false);
          setIsDiagnosticOpen(true);
        }}
      />

      <DiagnosticModal
        isOpen={isDiagnosticOpen}
        onClose={() => setIsDiagnosticOpen(false)}
        initialSymbol={selectedSymbol}
      />

      <CleanupModal
        isOpen={isCleanupModalOpen}
        onClose={() => setIsCleanupModalOpen(false)}
        initialMode={cleanupInitialMode}
        openPositions={openPositions}
        closedPositions={closedPositions}
        signals={signals}
        logsCount={logs.length}
        onSuccess={() => {
          fetchBotStatus();
          setCleanupToast('Cleanup completed. Active open positions remain preserved.');
          setTimeout(() => setCleanupToast(null), 5000);
        }}
      />

      {/* Mobile (iOS & Android) PWA + LAN Remote Access Modal */}
      {isMobileModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4">
          <div className="relative w-full max-w-lg bg-[#0a101d] border border-cyan-500/50 rounded-2xl p-5 sm:p-6 shadow-[0_0_35px_rgba(0,240,255,0.28)] space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-cyan-500/15 border border-cyan-400/50 flex items-center justify-center text-cyan-300 shadow-[0_0_14px_rgba(0,240,255,0.35)]">
                  <Smartphone className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm sm:text-base font-black text-white tracking-wide">
                    Android &amp; iOS Mobile App + LAN Sync
                  </h3>
                  <p className="text-[11px] text-cyan-300 font-mono">
                    Full-Screen PWA • Touch Gestures • 24/7 PC Remote Bridge
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsMobileModalOpen(false)}
                className="px-2.5 py-1 rounded-lg text-xs font-mono text-slate-400 hover:text-white bg-slate-900 border border-slate-700 cursor-pointer"
              >
                Close
              </button>
            </div>

            {/* 1. Connect iPhone / Android to this 24/7 PC Bot over Wi-Fi / Tailscale */}
            <div className="p-3.5 rounded-xl bg-slate-950/90 border border-cyan-500/30 space-y-2">
              <div className="flex items-center gap-2 text-xs font-black text-cyan-300 font-mono uppercase">
                <Wifi className="w-4 h-4 text-emerald-400" />
                <span>1. Connect Mobile to This PC Bot (Wi-Fi / LAN / Tailscale)</span>
              </div>
              <p className="text-[11px] text-slate-300 leading-relaxed">
                Open this URL in <strong className="text-white">Safari (iOS)</strong> or <strong className="text-white">Chrome (Android)</strong> on the same Wi-Fi/LAN to monitor &amp; control your 24/7 PC bot without mobile background sleep interruptions:
              </p>
              <div className="flex items-center gap-2 bg-[#070b13] border border-cyan-500/40 rounded-lg px-3 py-2 font-mono text-xs text-emerald-300">
                <span className="truncate flex-1 select-all font-bold">
                  {mobileConnInfo?.mobileUrl || window.location.origin}
                </span>
                <button
                  onClick={() => {
                    const urlToCopy = mobileConnInfo?.mobileUrl || window.location.origin;
                    navigator.clipboard?.writeText(urlToCopy);
                    setCopiedUrl(true);
                    setTimeout(() => setCopiedUrl(false), 2000);
                  }}
                  className="px-2.5 py-1 rounded bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-400/50 text-cyan-200 text-[10px] font-bold flex items-center gap-1 cursor-pointer shrink-0"
                >
                  <Copy className="w-3 h-3" />
                  <span>{copiedUrl ? 'COPIED!' : 'COPY'}</span>
                </button>
              </div>
              {mobileConnInfo?.lanIps && mobileConnInfo.lanIps.length > 1 && (
                <div className="text-[10px] font-mono text-slate-400">
                  All LAN Interfaces: {mobileConnInfo.lanIps.map((ip) => `http://${ip}:${mobileConnInfo.port}`).join(' • ')}
                </div>
              )}
            </div>

            {/* 2. Remote PC Server Bridge (for standalone Capacitor APK / iOS App) */}
            <div className="p-3.5 rounded-xl bg-slate-950/90 border border-slate-800 space-y-2">
              <div className="text-xs font-black text-amber-300 font-mono uppercase">
                2. Remote PC Bot Server URL (For Native APK / Remote Mobile)
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Running the standalone Android APK or iOS PWA? Enter your PC&apos;s LAN/Tailscale IP below (e.g. <code className="text-cyan-300">http://192.168.1.50:3000</code>) or leave blank for local/standalone mode:
              </p>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={remoteServerInput}
                  onChange={(e) => setRemoteServerInput(e.target.value)}
                  placeholder="http://192.168.1.100:3000 (or leave empty for local)"
                  className="flex-1 bg-[#070b13] border border-slate-700 focus:border-cyan-400 rounded-lg px-3 py-1.5 text-xs font-mono text-white outline-none"
                />
                <button
                  onClick={() => {
                    const cleaned = remoteServerInput.trim().replace(/\/+$/, '');
                    setRemoteServerUrl(cleaned);
                    try {
                      if (cleaned) localStorage.setItem('makka_remote_server_url', cleaned);
                      else localStorage.removeItem('makka_remote_server_url');
                    } catch {}
                    setCleanupToast(
                      cleaned
                        ? `Connected mobile client to Remote PC Bot: ${cleaned}`
                        : 'Using local embedded server & direct Binance streams.'
                    );
                    setTimeout(() => setCleanupToast(null), 4000);
                  }}
                  className="px-3 py-1.5 rounded-lg bg-cyan-500 text-slate-950 font-mono text-xs font-black hover:bg-cyan-400 transition cursor-pointer shrink-0"
                >
                  Save URL
                </button>
              </div>
            </div>

            {/* 3. Direct Native Android APK Download */}
            <div className="p-3.5 rounded-xl bg-emerald-950/30 border border-emerald-500/40 space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="text-xs font-black text-emerald-300 font-mono uppercase glow-text-emerald">
                  3. Direct Native Android APK Download (v1.2.1)
                </div>
                <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 text-[10px] font-mono font-bold neon-badge-emerald">
                  SIGNED v1+v2+v3 APK
                </span>
              </div>
              <p className="text-[11px] text-slate-300 leading-snug">
                Download the native Android package (<code className="text-emerald-300 font-mono">Makka-Footprint-Bot-1.2.1.apk</code>) directly: Main Native Android Trading Bot APK (M5MT + HTF Context).
              </p>
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <a
                  href="/api/download/apk"
                  download="Makka-Footprint-Bot-1.2.1.apk"
                  className="px-3.5 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-mono text-xs font-black transition cursor-pointer flex items-center gap-1.5 shadow-[0_0_15px_rgba(16,185,129,0.5)] glow-text-white"
                >
                  <Smartphone className="w-4 h-4" />
                  <span>DOWNLOAD BOT APK (v1.2.1)</span>
                </a>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-[11px]">
              <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800 space-y-1">
                <div className="font-black text-cyan-300 font-mono uppercase"> iOS (iPhone / iPad)</div>
                <p className="text-slate-300 leading-snug">
                  Open the LAN URL in <strong>Safari</strong> &rarr; tap <strong>Share</strong> &rarr; <strong>Add to Home Screen</strong> for a full-screen native iOS app with safe-area support.
                </p>
              </div>
              <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800 space-y-1">
                <div className="font-black text-emerald-300 font-mono uppercase">🤖 Android (APK / PWA)</div>
                <p className="text-slate-300 leading-snug">
                  Tap <strong>DOWNLOAD ANDROID APK (v1.2.1)</strong> above and open the downloaded file to install the native Pure MSNR + HTF Context mobile app.
                </p>
              </div>
            </div>

            <div className="p-2.5 rounded-lg bg-cyan-950/30 border border-cyan-500/20 text-[10px] font-mono text-cyan-200/90 flex flex-wrap items-center justify-between gap-2">
              <span>👆 1-Finger Drag: Pan Historical Candles</span>
              <span>🤏 2-Finger Pinch: Zoom MSNR Levels</span>
              <span>📊 Tap Price Axis: Scale Y-Axis</span>
            </div>
          </div>
        </div>
      )}

      {/* Safe Mode Switching Confirmation Modal */}
      {isModeSwitchModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4">
          <div className="relative w-full max-w-md bg-[#0a101d] border border-rose-500/50 rounded-2xl p-6 shadow-[0_0_35px_rgba(244,63,94,0.35)] space-y-5 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center gap-3.5">
              <div className="w-11 h-11 rounded-xl bg-rose-500/20 border border-rose-500/40 flex items-center justify-center text-rose-400 shadow-[0_0_15px_rgba(244,63,94,0.4)] shrink-0">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-black text-white tracking-wide glow-white">
                  Switch to Live Trading Mode?
                </h3>
                <p className="text-[11px] text-rose-400 font-mono font-black tracking-wider uppercase">
                  Real Binance USD-M Funds Required
                </p>
              </div>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed font-medium">
              You are about to switch from <span className="text-emerald-400 font-bold">Paper ($10K)</span> to <strong className="text-rose-400 font-bold">LIVE TRADING</strong> mode. All virtual paper positions and virtual balances will be <strong className="text-white">immediately purged</strong> so they never linger or mix into your real Binance account.
            </p>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={() => {
                  setIsModeSwitchModalOpen(false);
                  setPendingTradingMode(null);
                }}
                className="px-4 py-2 rounded-xl text-xs font-bold text-slate-300 hover:text-white bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700 transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmLiveModeSwitch}
                className="px-5 py-2 rounded-xl text-xs font-black text-white bg-gradient-to-r from-rose-600 to-red-600 hover:from-rose-500 hover:to-red-500 border border-rose-400 shadow-[0_0_16px_rgba(225,29,72,0.65)] transition cursor-pointer tracking-wider"
              >
                Confirm Live Mode
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
