export type UserRole = 'admin' | 'trader';
export type ExchangeType = 'BINANCE' | 'MEXC';
export type TradingMode = 'PAPER' | 'LIVE';
export type MarginMode = 'ISOLATED' | 'CROSS';

export interface UserAccount {
  id: string;
  username: string;
  passwordHash: string;
  role: UserRole;
  isActive: boolean;
  expiryDate: string; // YYYY-MM-DD or ISO timestamp
  durationMonths?: number;
  deviceId: string | null;
  boundedDeviceId?: string | null; // Legacy EXE compatibility field
  createdAt: string;
  lastLoginAt?: string | null;
}

export interface FirebaseUserRecord {
  passwordHash: string;
  isActive: boolean;
  expiryDate: string;
  durationMonths?: number;
  deviceId: string | null;
  boundedDeviceId?: string | null;
  role?: UserRole;
  createdAt?: string;
  lastLoginAt?: string | null;
}

export interface SessionState {
  userId: string;
  username: string;
  role: UserRole;
  deviceId: string;
  loggedInAt: string;
}

export type TradingPairSymbol =
  | 'BTCUSDT'
  | 'AVAXUSDT'
  | 'XAUUSD'
  | 'ETHUSDT'
  | 'SOLUSDT'
  | 'XRPUSDT'
  | 'BNBUSDT'
  | 'DOGEUSDT'
  | 'LINKUSDT'
  | 'ADAUSDT';

export type DirectionPreference = 'BOTH' | 'LONG' | 'SHORT';
export type ExecutionVenue = 'Binance WS' | 'MEXC Futures' | 'Bybit WS' | 'MT5 Bridge';

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  takerBuyVolume: number;
  takerSellVolume: number;
  delta: number;
}

export interface FootprintLevel {
  price: number;
  bidVol: number;
  askVol: number;
  imbalance: 'BID' | 'ASK' | 'NONE';
  isPoc: boolean;
}

export interface FootprintCandle {
  index: number;
  timeLabel: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  delta: number;
  cvd: number;
  pocPrice: number;
  levels: FootprintLevel[];
}

export interface OrderBookLevel {
  price: number;
  bidSize: number;
  askSize: number;
  cumulativeBid: number;
  cumulativeAsk: number;
  heatIntensity: number;
  isLiquidityWall: boolean;
}

export interface SMCZone {
  id: string;
  type: 'BULLISH_FVG' | 'BEARISH_FVG' | 'BULLISH_OB' | 'BEARISH_OB' | 'BOS' | 'CHOCH';
  label: string;
  topPrice: number;
  bottomPrice: number;
  startIndex: number;
  endIndex: number;
  mitigated: boolean;
}

export interface GoldenPocketData {
  swingHigh: number;
  swingLow: number;
  fib382: number;
  fib500: number;
  fib618: number;
  fib650: number;
  fib786: number;
  bias: 'BULLISH_RELOAD' | 'BEARISH_RELOAD';
}

export interface VolumeProfileRow {
  price: number;
  totalVolume: number;
  buyVolume: number;
  sellVolume: number;
  zone: 'POC' | 'VA' | 'OUTSIDE';
}

export interface VolumeProfileSummary {
  pocPrice: number;
  vahPrice: number;
  valPrice: number;
  rows: VolumeProfileRow[];
}

export interface ElliottWavePoint {
  waveLabel: string;
  candleIndex: number;
  price: number;
  phase: 'IMPULSE' | 'CORRECTION';
}

export interface MsnrLevel {
  id: string;
  type: 'A' | 'V' | 'OCL' | 'RBS' | 'SBR';
  timeframe: '4h' | '1h';
  price: number;
  fresh: boolean;
}

export interface HtfZoneItem {
  id: string;
  type: string;
  top: number;
  bottom: number;
  status: 'FRESH' | 'PARTIAL' | 'FULLY_MITIGATED';
}

export interface HtfContext {
  symbol: string;
  exchange: ExchangeType;
  computedAt: number;
  cacheKey: string;
  dailyBias: 'BULLISH' | 'BEARISH' | 'RANGE';
  swingRange4h: {
    high: number;
    low: number;
    equilibrium50: number;
    currentZone: 'DISCOUNT' | 'PREMIUM' | 'EQUILIBRIUM';
  };
  swingRange1d: {
    high: number;
    low: number;
    equilibrium50: number;
    currentZone: 'DISCOUNT' | 'PREMIUM' | 'EQUILIBRIUM';
  };
  fvgs: HtfZoneItem[];
  orderBlocks: HtfZoneItem[];
  supplyDemandZones: HtfZoneItem[];
  liquidityPools: HtfZoneItem[];
  keySwingLevels: number[];
  summary: string;
}

export interface TradeSignal {
  id: string;
  symbol: string;
  exchange: ExchangeType;
  side: 'LONG' | 'SHORT';
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  riskRewardRatio: number;
  slDistancePercent: number;
  engulfingTimeframe: '5m' | '15m';
  isStopHuntEngulfing: boolean;
  confluenceScore: number;
  msnrLevelLabel: string;
  reasoning: string;
  timestamp: number;
  status: 'EXECUTED' | 'PENDING' | 'SKIPPED';
}

export interface IneligibleSignal {
  id: string;
  symbol: string;
  exchange: ExchangeType;
  side: 'LONG' | 'SHORT';
  failedRule: string;
  reason: string;
  riskRewardRatio: number;
  slDistancePercent: number;
  timestamp: number;
}

export interface FootprintSignalAnalysis {
  symbol: string;
  exchange: ExchangeType;
  timeframe: string;
  currentPrice: number;
  timestamp: number;
  bias: 'LONG' | 'SHORT';
  action: 'BUY' | 'SELL' | 'WAIT';
  approved: boolean;
  storyline4h: 'BULLISH' | 'BEARISH' | 'RANGE';
  storyline1h: 'BULLISH' | 'BEARISH' | 'RANGE';
  storyline1d: 'BULLISH' | 'BEARISH' | 'RANGE';
  freshLevels: MsnrLevel[];
  unfreshLevels: MsnrLevel[];
  activeWatchWindows: string[];
  htfContext: HtfContext;
  signal?: TradeSignal;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  slDistancePercent: number;
  tpDistancePercent: number;
  riskRewardRatio: number;
  slLabel: string;
  tpLabel: string;
  confluenceScore: number;
  confirmationsCount: number;
  activeConfirmations: string[];
  keyReasoning: string;
  structureEvent?: 'BULLISH_BOS' | 'BEARISH_BOS' | 'BULLISH_CHOCH' | 'BEARISH_CHOCH' | 'CONSOLIDATION';
  footprintTrend?: 'BULLISH_IMBALANCE' | 'BEARISH_IMBALANCE' | 'NEUTRAL';
  winProbabilityPct?: number;
  goldenPocketZone?: {
    fib618: number;
    fib650: number;
    inZone: boolean;
  };
  pocPrice?: number;
  entryZone: {
    min: number;
    max: number;
    mid: number;
  };
  structuralSetup: {
    entryPrice: number;
    stopLoss: number;
    takeProfit: number;
    riskRewardRatio: number;
    slLabel: string;
    tpLabel: string;
    structuralInvalidationValid: boolean;
    riskPercent: number;
  };
}

export interface Position {
  id: string;
  symbol: string;
  exchange: ExchangeType;
  side: 'LONG' | 'SHORT';
  leverage: number;
  entryPrice: number;
  markPrice: number;
  exitPrice?: number;
  sizeUsd: number;
  marginUsd: number;
  stopLoss: number;
  takeProfit: number;
  unrealizedPnl: number;
  realizedPnl?: number;
  roePercent: number;
  status: 'OPEN' | 'CLOSED';
  openedAt: number;
  closedAt?: number;
  closeReason?: string;
  source: 'AUTO_MSNR' | 'MANUAL_SNIPER';
}

export interface BotStatus {
  isRunning: boolean;
  currentAction: string;
  analyzingSymbol: string | null;
  upcomingSignal: string | null;
  lastScanTime: number;
  nextScanTime: number;
  scanIntervalSeconds: number;
  monitoredPairsCount: number;
  activePositionsCount: number;
  maxConcurrentTrades: number;
  concurrentTradesSlotStatus: string;
  totalTrades: number;
  totalWins: number;
  totalLosses: number;
  winRate: number;
  netPnl: number;
  accountBalance: number;
  freeUsdt: number;
  totalActiveMarginUsdt: number;
  totalActiveMarginPercent: number;
  maxTotalMarginPct: number;
  marginMode: MarginMode;
  tradingMode: TradingMode;
  positionCapitalPercent: number;
  isLiveWalletConnected: boolean;
  ineligibleSignalsCount: number;
  coinglassConnected: boolean;
  coinglassStatus: 'CONNECTED' | 'DISCONNECTED';
  coinglassLatencyMs: number;
  coinglassKeyMasked: string;
  coinglassMessage: string;
  coinglassLastChecked: number;
  timeframeMode: 'AUTO' | '5m' | '15m' | '1h';
  activeExchange: ExchangeType;
  mexcConnected: boolean;
  mexcKeyMasked: string;
}

export interface BotSettings {
  autoTrading: boolean;
  activeSymbol: string;
  directionPreference: DirectionPreference;
  scanIntervalMinutes: number;
  leverage: number;
  riskPercentage: number;
  positionCapitalPercent: number;
  footprintThreshold: number;
  tradingMode: TradingMode;
  timeframeMode: 'AUTO' | '5m' | '15m' | '1h';
  stopLossPercent: number; // 0.25% - 1.2%
  minSlPercent: number;
  maxSlPercent: number;
  minRiskReward: number;
  coinglassApiKey: string;
  binanceApiKey: string;
  binanceApiSecret: string;
  mexcApiKey: string;
  mexcApiSecret: string;
  activeExchange: ExchangeType;
  maxTotalMarginPct: number;
  marginMode: MarginMode;
}

export interface DecisionLogEntry {
  id: string;
  symbol: string;
  exchange: ExchangeType;
  outcome: 'TRADED' | 'SKIPPED';
  levelId?: string;
  levelTimeframe?: string;
  levelType?: string;
  levelPrice?: number;
  storyline4h: string;
  storyline1h: string;
  storyline1d: string;
  confluenceScore: number;
  timestamp: number;
  finalReason: string;
  steps: {rule: string; passed: boolean; detail: string}[];
}

export interface EngineLogEntry {
  time: string;
  message: string;
  type: 'info' | 'trade' | 'success' | 'warn';
}

export interface CcxtPairInfo {
  symbol: string;
  ccxtSymbol: string;
  baseAsset: string;
  quoteAsset: string;
  pricePrecision: number;
  quantityPrecision: number;
  minQty: number;
  lastPrice: number;
  priceChangePercent: number;
  volume24h: number;
  high24h: number;
  low24h: number;
  active: boolean;
}

export interface ApiKeyRecord {
  id: string;
  venue: 'Binance Futures' | 'MEXC Futures' | 'Coinglass OrderFlow' | 'MetaTrader 5 Bridge';
  label: string;
  maskedKey: string;
  encryptedPayload: string;
  updatedAt: string;
}

export interface FirebaseExchangeKeyRecord {
  id: string;
  venue: 'Binance Futures' | 'MEXC Futures' | 'Coinglass OrderFlow' | 'MetaTrader 5 Bridge';
  exchange: ExchangeType;
  label: string;
  maskedKey: string;
  encryptedPayload: string;
  autoTradeEnabled: boolean;
  updatedAt: string;
}

export interface FirebaseBotSettingsNode {
  autoTrade: boolean;
  symbol: string;
  leverage: number;
  riskPercent: number;
  stopLoss: number;
  activeExchange?: ExchangeType;
  tradingMode?: TradingMode;
  timeframeMode?: 'AUTO' | '5m' | '15m' | '1h';
  directionPreference?: DirectionPreference;
  marginMode?: MarginMode;
  updatedAt?: number;
}

export interface FirebaseLiveSignalsNode {
  currentPnL: number;
  footprintTrend: 'BULLISH_IMBALANCE' | 'BEARISH_IMBALANCE' | 'NEUTRAL';
  openPosition: string;
  tradingMode?: TradingMode;
  activeSymbol?: string;
  activeExchange?: ExchangeType;
  latestSignal?: TradeSignal | null;
  signals?: TradeSignal[];
  openPositions?: Position[];
  closedPositions?: Position[];
  accountBalance?: number;
  updatedAt?: number;
}

export interface FirebaseBotState {
  autoTradeEnabled: boolean;
  activeSymbol: string;
  activeExchange: ExchangeType;
  tradingMode: TradingMode;
  timeframeMode: 'AUTO' | '5m' | '15m' | '1h';
  directionPreference: DirectionPreference;
  leverage: number;
  riskPercentage: number;
  stopLossPercent: number;
  minRiskReward: number;
  marginMode: MarginMode;
  accountBalance: number;
  netPnl: number;
  signals: TradeSignal[];
  openPositions: Position[];
  closedPositions: Position[];
  updatedAt: number;
}

export interface FirebaseActivePositionsNode {
  username: string;
  tradingMode: TradingMode;
  activeExchange: ExchangeType;
  accountBalance: number;
  totalUnrealizedPnl: number;
  realizedPnl: number;
  openPositions: Position[];
  closedPositions?: Position[];
  lastExecutionReason?: string;
  updatedAt: number;
}

export interface TickTradeEvent {
  symbol: string;
  exchange: ExchangeType;
  price: number;
  qty: number;
  side: 'BUY' | 'SELL';
  ts: number;
}

export interface MarketStreamSnapshot {
  symbol: string;
  exchange: ExchangeType;
  interval: string;
  source: 'BINANCE_WS' | 'MEXC_WS' | 'HISTORICAL_REST' | 'SYNTHETIC_FALLBACK';
  wsConnected: boolean;
  lastPrice: number;
  cumulativeDelta: number;
  ticksBuffered: number;
  latencyMs: number;
  candles: Candle[];
  orderBook: OrderBookLevel[];
  analysis: FootprintSignalAnalysis;
  updatedAt: number;
}

export type MarketAnalysisTab =
  | 'msnr_chart'
  | 'footprint'
  | 'orderbook'
  | 'smc'
  | 'golden_pocket'
  | 'volume_profile'
  | 'elliott_wave';
