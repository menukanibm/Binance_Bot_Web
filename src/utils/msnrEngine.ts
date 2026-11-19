import type {
  Candle,
  ConfluenceGateResult,
  ConfluenceRejectionCode,
  ExchangeType,
  InstitutionalCheckItem,
  MsnrLevel,
  MultiTimeframeCandles,
  OrderBookLevel,
  OrderFlowL3Snapshot,
  TickTradeEvent,
} from '../types/trading.ts';
import {buildTradingViewFootprintCandles} from './footprintEngine.ts';

export interface InstitutionalMsnrInput {
  symbol: string;
  exchange: ExchangeType;
  timeframe: string;
  candles: Candle[];
  multiTimeframe?: MultiTimeframeCandles;
  orderBook: OrderBookLevel[];
  recentTicks?: TickTradeEvent[];
  l3: OrderFlowL3Snapshot;
  stopLossPercent: number;
  minSlPercent?: number;
  maxSlPercent?: number;
  minRiskReward?: number;
  apiKeyValid?: boolean;
  dataAuthentic?: boolean;
}

export interface HtfStructureResult {
  bias: 'BULLISH' | 'BEARISH' | 'RANGE';
  event: 'BULLISH_BOS' | 'BEARISH_BOS' | 'BULLISH_CHOCH' | 'BEARISH_CHOCH' | 'CONSOLIDATION';
  freshLevels: MsnrLevel[];
  unfreshLevels: MsnrLevel[];
  swingHigh: number;
  swingLow: number;
}

export interface InstitutionalEvaluationResult {
  bias: 'LONG' | 'SHORT';
  storyline4h: 'BULLISH' | 'BEARISH' | 'RANGE';
  storyline1h: 'BULLISH' | 'BEARISH' | 'RANGE';
  structureEvent: 'BULLISH_BOS' | 'BEARISH_BOS' | 'BULLISH_CHOCH' | 'BEARISH_CHOCH' | 'CONSOLIDATION';
  freshLevels: MsnrLevel[];
  unfreshLevels: MsnrLevel[];
  tappedLevel: MsnrLevel | null;
  cleanTraffic: boolean;
  blockingObstacleLabel: string | null;
  ltfTriggerConfirmed: boolean;
  ltfTriggerDetail: string;
  footprintImbalanceConfirmed: boolean;
  footprintImbalanceDetail: string;
  cvdAligned: boolean;
  cvdValue: number;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  slPercent: number;
  riskRewardRatio: number;
  strongSignal: boolean;
  confluenceGate: ConfluenceGateResult;
  checks: InstitutionalCheckItem[];
  failedReason: string;
}

/**
 * Extracts real closed-candle MSNR levels (A, V, OCL, RBS, SBR) and BOS/CHoCH bias
 * directly from exchange OHLCV history — zero synthetic/random generation.
 */
export function extractRealMsnrStructure(
  candles: Candle[],
  timeframe: '4h' | '1h',
  symbol: string,
): HtfStructureResult {
  // Use only closed candles (exclude last forming bar if length > 10)
  const closed = candles.length > 10 ? candles.slice(0, -1) : candles;
  if (closed.length < 7) {
    const lastClose = closed[closed.length - 1]?.close ?? 0;
    return {
      bias: 'RANGE',
      event: 'CONSOLIDATION',
      freshLevels: [],
      unfreshLevels: [],
      swingHigh: lastClose,
      swingLow: lastClose,
    };
  }

  const swingHighs: Array<{idx: number; price: number; bodyTop: number}> = [];
  const swingLows: Array<{idx: number; price: number; bodyBot: number}> = [];

  for (let i = 1; i < closed.length - 1; i++) {
    const c = closed[i];
    const isHigh = c.high > closed[i - 1].high && c.high >= closed[i + 1].high;
    const isLow = c.low < closed[i - 1].low && c.low <= closed[i + 1].low;

    if (isHigh) {
      swingHighs.push({idx: i, price: c.high, bodyTop: Math.max(c.open, c.close)});
    }
    if (isLow) {
      swingLows.push({idx: i, price: c.low, bodyBot: Math.min(c.open, c.close)});
    }
  }

  const latestClosed = closed[closed.length - 1];
  const prevHigh = swingHighs[swingHighs.length - 1];
  const prev2High = swingHighs[swingHighs.length - 2];
  const prevLow = swingLows[swingLows.length - 1];
  const prev2Low = swingLows[swingLows.length - 2];

  const allHighs = closed.slice(-40).map((c) => c.high);
  const allLows = closed.slice(-40).map((c) => c.low);
  const swingHigh = Math.max(...allHighs);
  const swingLow = Math.min(...allLows);

  let bias: 'BULLISH' | 'BEARISH' | 'RANGE' = 'RANGE';
  let event: HtfStructureResult['event'] = 'CONSOLIDATION';

  const brokeHigh = prevHigh ? latestClosed.close > prevHigh.price : false;
  const brokeLow = prevLow ? latestClosed.close < prevLow.price : false;
  const higherHighs = prevHigh && prev2High ? prevHigh.price > prev2High.price : false;
  const higherLows = prevLow && prev2Low ? prevLow.price > prev2Low.price : false;
  const lowerHighs = prevHigh && prev2High ? prevHigh.price < prev2High.price : false;
  const lowerLows = prevLow && prev2Low ? prevLow.price < prev2Low.price : false;

  if (brokeHigh) {
    bias = 'BULLISH';
    event = lowerLows ? 'BULLISH_CHOCH' : 'BULLISH_BOS';
  } else if (brokeLow) {
    bias = 'BEARISH';
    event = higherHighs ? 'BEARISH_CHOCH' : 'BEARISH_BOS';
  } else if (higherHighs && higherLows) {
    bias = 'BULLISH';
    event = 'BULLISH_BOS';
  } else if (lowerHighs && lowerLows) {
    bias = 'BEARISH';
    event = 'BEARISH_BOS';
  } else {
    // Structural midpoint trend from closed candle closes when swings are tighter
    const mid = (swingHigh + swingLow) / 2;
    const emaFast =
      closed.slice(-5).reduce((s, c) => s + c.close, 0) / Math.min(5, closed.length);
    const emaSlow =
      closed.slice(-15).reduce((s, c) => s + c.close, 0) / Math.min(15, closed.length);
    if (latestClosed.close > mid && emaFast > emaSlow * 1.0005) {
      bias = 'BULLISH';
      event = 'BULLISH_BOS';
    } else if (latestClosed.close < mid && emaFast < emaSlow * 0.9995) {
      bias = 'BEARISH';
      event = 'BEARISH_BOS';
    }
  }

  const freshLevels: MsnrLevel[] = [];
  const unfreshLevels: MsnrLevel[] = [];
  const currentLast = candles[candles.length - 1];

  const classifyLevel = (
    id: string,
    type: MsnrLevel['type'],
    price: number,
    createdIdx: number,
    isResistance: boolean,
  ) => {
    // Check if any strictly intermediate closed candle (excluding creation bar and most recent 2 bars) mitigated it
    const checkEnd = Math.max(createdIdx + 1, closed.length - 2);
    let touchedBeforeNow = false;
    for (let j = createdIdx + 1; j < checkEnd; j++) {
      const bar = closed[j];
      const tol = price * 0.0012;
      if (isResistance && bar.high >= price - tol) {
        touchedBeforeNow = true;
        break;
      }
      if (!isResistance && bar.low <= price + tol) {
        touchedBeforeNow = true;
        break;
      }
    }
    const lvl: MsnrLevel = {
      id,
      type,
      timeframe,
      price,
      fresh: !touchedBeforeNow,
    };
    if (lvl.fresh) {
      freshLevels.push(lvl);
    } else {
      unfreshLevels.push(lvl);
    }
  };

  for (const sh of swingHighs.slice(-4)) {
    // If price closed above a former A-high, it flips into an RBS support level
    if (currentLast && currentLast.close > sh.price * 1.0015) {
      classifyLevel(`${symbol}-${timeframe}-RBS-${sh.idx}`, 'RBS', sh.price, sh.idx, false);
    } else {
      classifyLevel(`${symbol}-${timeframe}-A-${sh.idx}`, 'A', sh.price, sh.idx, true);
      classifyLevel(`${symbol}-${timeframe}-OCL-H-${sh.idx}`, 'OCL', sh.bodyTop, sh.idx, true);
    }
  }

  for (const sl of swingLows.slice(-4)) {
    // If price closed below a former V-low, it flips into an SBR resistance level
    if (currentLast && currentLast.close < sl.price * 0.9985) {
      classifyLevel(`${symbol}-${timeframe}-SBR-${sl.idx}`, 'SBR', sl.price, sl.idx, true);
    } else {
      classifyLevel(`${symbol}-${timeframe}-V-${sl.idx}`, 'V', sl.price, sl.idx, false);
      classifyLevel(`${symbol}-${timeframe}-OCL-L-${sl.idx}`, 'OCL', sl.bodyBot, sl.idx, false);
    }
  }

  return {
    bias,
    event,
    freshLevels,
    unfreshLevels,
    swingHigh,
    swingLow,
  };
}

/**
 * Evaluates Pillar 2 (LTF 15m / 5m Trigger Confirmation):
 * Liquidity sweep / wick rejection at the tapped MSNR level followed by a
 * strong closed-body engulfing candle or LTF CHoCH in the HTF direction.
 */
export function evaluateLtfTrigger(
  ltfCandles: Candle[],
  bias: 'LONG' | 'SHORT',
  tappedLevel: MsnrLevel | null,
): {confirmed: boolean; detail: string} {
  if (ltfCandles.length < 6) {
    return {confirmed: false, detail: 'Insufficient LTF candles (<6 bars)'};
  }

  const recent = ltfCandles.slice(-6);
  const prev = recent[recent.length - 3];
  const sweepBar = recent[recent.length - 2];
  const triggerBar = recent[recent.length - 1];

  const sweepRange = Math.max(sweepBar.high - sweepBar.low, sweepBar.close * 0.0001);
  const sweepBody = Math.abs(sweepBar.close - sweepBar.open);
  const triggerBody = Math.abs(triggerBar.close - triggerBar.open);
  const triggerRange = Math.max(triggerBar.high - triggerBar.low, triggerBar.close * 0.0001);
  const priorSwingHigh = Math.max(...recent.slice(0, -1).map((c) => c.high));
  const priorSwingLow = Math.min(...recent.slice(0, -1).map((c) => c.low));

  if (bias === 'LONG') {
    const lowerWick = Math.min(sweepBar.open, sweepBar.close) - sweepBar.low;
    const triggerLowerWick = Math.min(triggerBar.open, triggerBar.close) - triggerBar.low;
    const hasWickSweep =
      lowerWick >= Math.max(sweepBody * 0.85, sweepRange * 0.32) ||
      triggerLowerWick >= Math.max(triggerBody * 0.85, triggerRange * 0.32) ||
      (tappedLevel !== null && sweepBar.low <= tappedLevel.price * 1.0015);

    const bullishEngulfing =
      triggerBar.close > triggerBar.open &&
      triggerBody >= Math.max(sweepBody * 1.05, triggerRange * 0.45) &&
      triggerBar.close > Math.max(sweepBar.open, sweepBar.close);

    const ltfBullChoch =
      triggerBar.close > triggerBar.open &&
      triggerBar.close > Math.max(prev.high, sweepBar.high) &&
      triggerBar.close >= priorSwingHigh * 0.999;

    if (hasWickSweep && (bullishEngulfing || ltfBullChoch)) {
      return {
        confirmed: true,
        detail: bullishEngulfing
          ? 'Sweep wick rejection + closed bullish engulfing'
          : 'Sweep wick rejection + LTF bullish CHoCH',
      };
    }
    return {
      confirmed: false,
      detail: !hasWickSweep
        ? 'No liquidity sweep / wick rejection at MSNR zone'
        : 'No closed bullish engulfing or LTF CHoCH confirmation',
    };
  }

  // SHORT trigger
  const upperWick = sweepBar.high - Math.max(sweepBar.open, sweepBar.close);
  const triggerUpperWick = triggerBar.high - Math.max(triggerBar.open, triggerBar.close);
  const hasWickSweep =
    upperWick >= Math.max(sweepBody * 0.85, sweepRange * 0.32) ||
    triggerUpperWick >= Math.max(triggerBody * 0.85, triggerRange * 0.32) ||
    (tappedLevel !== null && sweepBar.high >= tappedLevel.price * 0.9985);

  const bearishEngulfing =
    triggerBar.close < triggerBar.open &&
    triggerBody >= Math.max(sweepBody * 1.05, triggerRange * 0.45) &&
    triggerBar.close < Math.min(sweepBar.open, sweepBar.close);

  const ltfBearChoch =
    triggerBar.close < triggerBar.open &&
    triggerBar.close < Math.min(prev.low, sweepBar.low) &&
    triggerBar.close <= priorSwingLow * 1.001;

  if (hasWickSweep && (bearishEngulfing || ltfBearChoch)) {
    return {
      confirmed: true,
      detail: bearishEngulfing
        ? 'Sweep wick rejection + closed bearish engulfing'
        : 'Sweep wick rejection + LTF bearish CHoCH',
    };
  }
  return {
    confirmed: false,
    detail: !hasWickSweep
      ? 'No liquidity sweep / upper wick rejection at MSNR zone'
      : 'No closed bearish engulfing or LTF CHoCH confirmation',
  };
}

/**
 * Evaluates Pillar 3 (Footprint >= 300% diagonal or stacked imbalance) from REAL ticks/candles.
 */
export function evaluateRealFootprintImbalance(
  symbol: string,
  candles: Candle[],
  recentTicks: TickTradeEvent[] | undefined,
  bias: 'LONG' | 'SHORT',
): {confirmed: boolean; detail: string; buyImbalances: number; sellImbalances: number} {
  if (candles.length === 0) {
    return {
      confirmed: false,
      detail: 'No real candle/tick footprint data available',
      buyImbalances: 0,
      sellImbalances: 0,
    };
  }

  const fpBars = buildTradingViewFootprintCandles(
    symbol,
    candles.slice(-12),
    recentTicks && recentTicks.length > 0 ? recentTicks : undefined,
  );
  const recentBars = fpBars.slice(-2);
  let buyImbalances = 0;
  let sellImbalances = 0;
  let stackedBuy = false;
  let stackedSell = false;

  for (const bar of recentBars) {
    for (const row of bar.levels) {
      if (row.imbalance === 'ASK') buyImbalances += 1;
      if (row.imbalance === 'BID') sellImbalances += 1;
    }
    if ((bar.stackedBuyLevels?.length ?? 0) > 0) stackedBuy = true;
    if ((bar.stackedSellLevels?.length ?? 0) > 0) stackedSell = true;
  }

  if (bias === 'LONG') {
    const confirmed = buyImbalances >= 1 || stackedBuy;
    return {
      confirmed,
      detail: confirmed
        ? `${buyImbalances} diagonal Buy imbalance(s) >=300%${stackedBuy ? ' + Stacked Buy' : ''}`
        : 'No >=300% Buy footprint imbalance at entry zone',
      buyImbalances,
      sellImbalances,
    };
  }

  const confirmed = sellImbalances >= 1 || stackedSell;
  return {
    confirmed,
    detail: confirmed
      ? `${sellImbalances} diagonal Sell imbalance(s) >=300%${stackedSell ? ' + Stacked Sell' : ''}`
      : 'No >=300% Sell footprint imbalance at entry zone',
    buyImbalances,
    sellImbalances,
  };
}

/**
 * Master All-or-Nothing Institutional Evaluation Engine.
 * A STRONG SIGNAL is emitted ONLY when 100% of all 4 quantitative pillars pass simultaneously.
 */
export function evaluateInstitutionalSetup(
  input: InstitutionalMsnrInput,
): InstitutionalEvaluationResult {
  const minSl = input.minSlPercent ?? 0.25;
  const maxSl = input.maxSlPercent ?? 1.2;
  const minRr = Math.max(2.0, input.minRiskReward ?? 2.0);
  const authentic = input.dataAuthentic !== false;

  const baseCandles = input.candles;
  const currentPrice = baseCandles[baseCandles.length - 1]?.close ?? 0;

  if (!authentic || baseCandles.length < 10 || currentPrice <= 0) {
    const offlineChecks: InstitutionalCheckItem[] = [
      {
        id: 'data-authentic',
        pillar: 'HTF_MSNR',
        label: 'Real Exchange Data Feed',
        passed: false,
        detail: 'Waiting for real live REST + WebSocket market data (synthetic data disabled)',
      },
    ];
    return {
      bias: 'LONG',
      storyline4h: 'RANGE',
      storyline1h: 'RANGE',
      structureEvent: 'CONSOLIDATION',
      freshLevels: [],
      unfreshLevels: [],
      tappedLevel: null,
      cleanTraffic: false,
      blockingObstacleLabel: 'No live exchange feed',
      ltfTriggerConfirmed: false,
      ltfTriggerDetail: 'Waiting for live exchange klines',
      footprintImbalanceConfirmed: false,
      footprintImbalanceDetail: 'Waiting for live aggTrades',
      cvdAligned: false,
      cvdValue: 0,
      entryPrice: 0,
      stopLoss: 0,
      takeProfit: 0,
      slPercent: input.stopLossPercent,
      riskRewardRatio: 0,
      strongSignal: false,
      checks: offlineChecks,
      failedReason: 'Offline — Waiting for Real Exchange Market Data',
      confluenceGate: {
        msnrValid: false,
        msnrDetails: {
          htfStorylineValid: false,
          freshLevelTapped: false,
          cleanTraffic: false,
          ltfReactionConfirmed: false,
        },
        l3Confirmed: false,
        l3Details: {
          absorptionAligned: false,
          noOpposingSpoof: false,
          takerDeltaAligned: false,
          footprintImbalanceAligned: false,
          cvdAligned: false,
          confirmationState: 'NEUTRAL',
        },
        riskDetails: {
          slGuardValid: false,
          rrValid: false,
          slPercent: input.stopLossPercent,
          riskRewardRatio: 0,
        },
        checks: offlineChecks,
        apiKeyValid: Boolean(input.apiKeyValid),
        canEmitSignal: false,
        canAutoExecute: false,
        rejectionCode: 'OFFLINE_NO_DATA',
        rejectionLabel: 'Waiting for Live Exchange Data',
      },
    };
  }

  // 1. HTF 4H & 1H Structural Alignment from real multi-timeframe candles
  const candles4h =
    input.multiTimeframe?.['4h'] && input.multiTimeframe['4h'].length >= 10
      ? input.multiTimeframe['4h']
      : baseCandles;
  const candles1h =
    input.multiTimeframe?.['1h'] && input.multiTimeframe['1h'].length >= 10
      ? input.multiTimeframe['1h']
      : baseCandles;
  const candlesLtf =
    input.multiTimeframe?.['5m'] && input.multiTimeframe['5m'].length >= 10
      ? input.multiTimeframe['5m']
      : input.multiTimeframe?.['15m'] && input.multiTimeframe['15m'].length >= 10
        ? input.multiTimeframe['15m']
        : baseCandles;

  const htf4h = extractRealMsnrStructure(candles4h, '4h', input.symbol);
  const htf1h = extractRealMsnrStructure(candles1h, '1h', input.symbol);

  const htfAlignedBull = htf4h.bias === 'BULLISH' && htf1h.bias === 'BULLISH';
  const htfAlignedBear = htf4h.bias === 'BEARISH' && htf1h.bias === 'BEARISH';
  const htfStorylineValid = htfAlignedBull || htfAlignedBear;
  const bias: 'LONG' | 'SHORT' = htfAlignedBear
    ? 'SHORT'
    : htfAlignedBull
      ? 'LONG'
      : htf1h.bias === 'BEARISH'
        ? 'SHORT'
        : 'LONG';

  const freshLevels = [...htf4h.freshLevels, ...htf1h.freshLevels];
  const unfreshLevels = [...htf4h.unfreshLevels, ...htf1h.unfreshLevels];

  // Fresh MSNR level tap check (within 0.45% of current price or touched by last 2 candles)
  const lastTwo = candlesLtf.slice(-2);
  const tapLow = Math.min(...lastTwo.map((c) => c.low), currentPrice);
  const tapHigh = Math.max(...lastTwo.map((c) => c.high), currentPrice);

  const tappedLevel =
    freshLevels.find((lvl) => {
      if (!lvl.fresh) return false;
      const isExpectedSupport =
        bias === 'LONG' && (lvl.type === 'V' || lvl.type === 'RBS' || lvl.type === 'OCL');
      const isExpectedResist =
        bias === 'SHORT' && (lvl.type === 'A' || lvl.type === 'SBR' || lvl.type === 'OCL');
      if (!isExpectedSupport && !isExpectedResist) return false;
      const distPct = (Math.abs(currentPrice - lvl.price) / currentPrice) * 100;
      const wickTouched = tapLow <= lvl.price * 1.002 && tapHigh >= lvl.price * 0.998;
      return distPct <= 0.45 || wickTouched;
    }) || null;

  const freshLevelTapped = tappedLevel !== null;

  // Compute strict Risk & SL/TP geometry (0.25% - 1.20% SL guard & >= 1:2.0 R:R)
  const rawSlPct = Number(input.stopLossPercent);
  const slGuardValid = Number.isFinite(rawSlPct) && rawSlPct >= minSl && rawSlPct <= maxSl;
  const effectiveSlPct = slGuardValid ? rawSlPct : Math.min(maxSl, Math.max(minSl, rawSlPct || 0.5));
  const slFrac = effectiveSlPct / 100;
  const tpFrac = slFrac * minRr;

  const stopLoss = bias === 'LONG' ? currentPrice * (1 - slFrac) : currentPrice * (1 + slFrac);
  const takeProfit = bias === 'LONG' ? currentPrice * (1 + tpFrac) : currentPrice * (1 - tpFrac);

  // Clean Traffic Check: No opposing fresh HTF MSNR level OR heavy L2 wall blocking >= 1:2.0 R:R path
  let blockingObstacleLabel: string | null = null;
  const opposingFreshLevel = freshLevels.find((lvl) => {
    if (!lvl.fresh) return false;
    if (bias === 'LONG') {
      const isOpp = lvl.type === 'A' || lvl.type === 'SBR';
      return isOpp && lvl.price > currentPrice * 1.0015 && lvl.price < takeProfit * 0.999;
    }
    const isOpp = lvl.type === 'V' || lvl.type === 'RBS';
    return isOpp && lvl.price < currentPrice * 0.9985 && lvl.price > takeProfit * 1.001;
  });

  if (opposingFreshLevel) {
    blockingObstacleLabel = `Opposing fresh ${opposingFreshLevel.timeframe.toUpperCase()} ${opposingFreshLevel.type} @ $${opposingFreshLevel.price}`;
  } else if (input.orderBook.length > 0) {
    const avgBookSize =
      input.orderBook.reduce((s, l) => s + l.bidSize + l.askSize, 0) /
      Math.max(1, input.orderBook.length);
    const blockingWall = input.orderBook.find((lvl) => {
      if (bias === 'LONG') {
        return (
          lvl.askSize >= Math.max(avgBookSize * 3.2, 40) &&
          lvl.price > currentPrice * 1.0005 &&
          lvl.price < takeProfit * 0.995
        );
      }
      return (
        lvl.bidSize >= Math.max(avgBookSize * 3.2, 40) &&
        lvl.price < currentPrice * 0.9995 &&
        lvl.price > takeProfit * 1.005
      );
    });
    if (blockingWall) {
      blockingObstacleLabel = `Heavy opposing L2 wall @ $${blockingWall.price}`;
    }
  }

  const cleanTraffic = blockingObstacleLabel === null;
  const riskRewardRatio = cleanTraffic ? Number((tpFrac / slFrac).toFixed(2)) : 1.1;
  const rrValid = cleanTraffic && riskRewardRatio >= minRr;

  // 2. LTF Trigger Confirmation (15m / 5m)
  const ltfEval = evaluateLtfTrigger(candlesLtf, bias, tappedLevel);

  // 3. Real-Time Order-Flow & Synthetic L3 Confluence
  const recentDeltaSum = candlesLtf.slice(-6).reduce((s, c) => s + c.delta, 0);
  const cvdValue = Number((recentDeltaSum + input.l3.takerDelta).toFixed(2));
  const cvdAligned = bias === 'LONG' ? cvdValue > 0 : cvdValue < 0;
  const takerDeltaAligned = bias === 'LONG' ? input.l3.takerDelta > 0 : input.l3.takerDelta < 0;

  const expectedAbsorptionSide = bias === 'LONG' ? 'BUY' : 'SELL';
  const absorptionAligned =
    input.l3.absorptionDetected && input.l3.absorptionSide === expectedAbsorptionSide;

  const opposingBookSide = bias === 'LONG' ? 'ASK' : 'BID';
  const noOpposingSpoof =
    !input.l3.spoofingDetected || input.l3.opposingSpoofSide !== opposingBookSide;

  const fpEval = evaluateRealFootprintImbalance(
    input.symbol,
    candlesLtf,
    input.recentTicks,
    bias,
  );

  const expectedL3State = bias === 'LONG' ? 'BULLISH_L3_CONFIRMED' : 'BEARISH_L3_CONFIRMED';
  const l3StateAligned = input.l3.confirmationState === expectedL3State;

  const msnrValid = htfStorylineValid && freshLevelTapped && cleanTraffic && ltfEval.confirmed;
  const l3Confirmed =
    l3StateAligned &&
    absorptionAligned &&
    noOpposingSpoof &&
    takerDeltaAligned &&
    cvdAligned &&
    fpEval.confirmed;
  const riskValid = slGuardValid && rrValid;

  const apiKeyValid = Boolean(input.apiKeyValid);
  const strongSignal = msnrValid && l3Confirmed && riskValid;
  const canEmitSignal = strongSignal;
  const canAutoExecute = strongSignal && apiKeyValid;

  const checks: InstitutionalCheckItem[] = [
    {
      id: 'htf-storyline',
      pillar: 'HTF_MSNR',
      label: 'HTF 4H & 1H BOS/CHoCH Alignment',
      passed: htfStorylineValid,
      detail: htfStorylineValid
        ? `4H ${htf4h.bias} (${htf4h.event}) + 1H ${htf1h.bias}`
        : `HTF conflict: 4H ${htf4h.bias} vs 1H ${htf1h.bias}`,
    },
    {
      id: 'fresh-msnr',
      pillar: 'HTF_MSNR',
      label: 'Fresh Unmitigated MSNR Tap',
      passed: freshLevelTapped,
      detail: tappedLevel
        ? `Tapped fresh ${tappedLevel.timeframe.toUpperCase()} ${tappedLevel.type} @ $${tappedLevel.price}`
        : `No fresh MSNR level within tap range of $${currentPrice}`,
    },
    {
      id: 'clean-traffic',
      pillar: 'HTF_MSNR',
      label: 'Clean 1:2.0 R:R Traffic Path',
      passed: cleanTraffic,
      detail: cleanTraffic
        ? `Clear path to 1:${riskRewardRatio.toFixed(1)} TP ($${takeProfit.toFixed(2)})`
        : blockingObstacleLabel || 'Opposing liquidity blocks 1:2 R:R path',
    },
    {
      id: 'ltf-trigger',
      pillar: 'LTF_TRIGGER',
      label: 'LTF Sweep Rejection + Engulf/CHoCH',
      passed: ltfEval.confirmed,
      detail: ltfEval.detail,
    },
    {
      id: 'delta-cvd',
      pillar: 'ORDERFLOW_L3',
      label: 'Aggressive Delta & CVD Shift',
      passed: takerDeltaAligned && cvdAligned,
      detail: `Taker Delta ${input.l3.takerDelta >= 0 ? '+' : ''}${input.l3.takerDelta} · CVD ${cvdValue >= 0 ? '+' : ''}${cvdValue}`,
    },
    {
      id: 'l3-absorption',
      pillar: 'ORDERFLOW_L3',
      label: 'Passive Absorption / Iceberg Defense',
      passed: absorptionAligned,
      detail: absorptionAligned
        ? `${input.l3.absorptionSide} Iceberg (${input.l3.icebergReloadCount}x reloads)`
        : 'No aligned passive L3 iceberg absorption detected',
    },
    {
      id: 'footprint-imbalance',
      pillar: 'ORDERFLOW_L3',
      label: 'Footprint >=300% Diagonal Imbalance',
      passed: fpEval.confirmed,
      detail: fpEval.detail,
    },
    {
      id: 'anti-spoof',
      pillar: 'ORDERFLOW_L3',
      label: 'Anti-Spoofing Guard',
      passed: noOpposingSpoof,
      detail: noOpposingSpoof
        ? 'No opposing spoof wall detected'
        : `Opposing ${input.l3.opposingSpoofSide} spoofing wall detected`,
    },
    {
      id: 'risk-guard',
      pillar: 'RISK_GATE',
      label: 'SL Guard (0.25%-1.2%) & >=1:2.0 R:R',
      passed: riskValid,
      detail: riskValid
        ? `SL ${effectiveSlPct.toFixed(2)}% · R:R 1:${riskRewardRatio.toFixed(2)}`
        : `SL ${rawSlPct.toFixed(2)}% or R:R 1:${riskRewardRatio.toFixed(2)} outside guard`,
    },
  ];

  let rejectionCode: ConfluenceRejectionCode = 'NONE';
  let rejectionLabel = 'STRONG SIGNAL CONFIRMED';
  let failedReason = 'All 9 institutional conditions passed simultaneously.';

  if (!htfStorylineValid || !freshLevelTapped || !cleanTraffic) {
    rejectionCode = 'NO_VALID_MSNR';
    rejectionLabel = 'No Valid MSNR Zone';
    failedReason = !htfStorylineValid
      ? `HTF Conflict: 4H ${htf4h.bias} vs 1H ${htf1h.bias} @ $${currentPrice}`
      : !freshLevelTapped
        ? `Mid-range ($${currentPrice}): no fresh 4H/1H MSNR key level tapped`
        : blockingObstacleLabel || 'Clean traffic blocked before 1:2.0 R:R';
  } else if (!ltfEval.confirmed) {
    rejectionCode = 'LTF_TRIGGER_MISSING';
    rejectionLabel = 'Awaiting LTF Trigger';
    failedReason = `${ltfEval.detail} @ $${currentPrice}`;
  } else if (!noOpposingSpoof) {
    rejectionCode = 'OPPOSING_SPOOF_WALL';
    rejectionLabel = 'Waiting for L3 Confirmation';
    failedReason = `Opposing ${input.l3.opposingSpoofSide} spoofing wall detected @ $${currentPrice}`;
  } else if (!fpEval.confirmed) {
    rejectionCode = 'FOOTPRINT_IMBALANCE_MISSING';
    rejectionLabel = 'Waiting for L3 Confirmation';
    failedReason = `${fpEval.detail} @ $${currentPrice}`;
  } else if (!l3Confirmed) {
    rejectionCode = 'WAITING_FOR_L3';
    rejectionLabel = 'Waiting for L3 Confirmation';
    failedReason = `Valid MSNR ${bias} @ $${currentPrice}, awaiting L3 Iceberg absorption & CVD shift (${input.l3.confirmationState})`;
  } else if (!riskValid) {
    rejectionCode = 'RISK_GUARD_FAILED';
    rejectionLabel = 'Risk Guard Rejected';
    failedReason = `SL ${rawSlPct.toFixed(2)}% outside [0.25%-1.20%] or R:R < 1:2.0`;
  } else if (!apiKeyValid) {
    rejectionCode = 'API_KEY_REQUIRED';
    rejectionLabel = 'STRONG SIGNAL · API Key Required';
    failedReason = 'Strong signal confirmed, connect Exchange API Key to auto-execute.';
  }

  return {
    bias,
    storyline4h: htf4h.bias,
    storyline1h: htf1h.bias,
    structureEvent: htf4h.event !== 'CONSOLIDATION' ? htf4h.event : htf1h.event,
    freshLevels,
    unfreshLevels,
    tappedLevel,
    cleanTraffic,
    blockingObstacleLabel,
    ltfTriggerConfirmed: ltfEval.confirmed,
    ltfTriggerDetail: ltfEval.detail,
    footprintImbalanceConfirmed: fpEval.confirmed,
    footprintImbalanceDetail: fpEval.detail,
    cvdAligned,
    cvdValue,
    entryPrice: currentPrice,
    stopLoss,
    takeProfit,
    slPercent: effectiveSlPct,
    riskRewardRatio,
    strongSignal,
    checks,
    failedReason,
    confluenceGate: {
      msnrValid,
      msnrDetails: {
        htfStorylineValid,
        freshLevelTapped,
        cleanTraffic,
        ltfReactionConfirmed: ltfEval.confirmed,
      },
      l3Confirmed,
      l3Details: {
        absorptionAligned,
        noOpposingSpoof,
        takerDeltaAligned,
        footprintImbalanceAligned: fpEval.confirmed,
        cvdAligned,
        confirmationState: input.l3.confirmationState,
      },
      riskDetails: {
        slGuardValid,
        rrValid,
        slPercent: effectiveSlPct,
        riskRewardRatio,
      },
      checks,
      apiKeyValid,
      canEmitSignal,
      canAutoExecute,
      rejectionCode,
      rejectionLabel,
    },
  };
}
