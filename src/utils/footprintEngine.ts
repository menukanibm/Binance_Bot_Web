import type {Candle, FootprintCandle, FootprintLevel, TickTradeEvent} from '../types/trading.ts';
import {getPairMeta} from './tradingMath.ts';

export interface FootprintBuildOptions {
  rowMultiplier?: number | 'AUTO';
  candlesInView?: number;
  imbalanceRatioPct?: number; // Default 300% (Ask >= 3.0x diagonal Bid or vice versa)
}

export function intervalToSeconds(interval: string): number {
  switch (interval) {
    case '1m':
      return 60;
    case '5m':
      return 300;
    case '15m':
      return 900;
    case '30m':
      return 1800;
    case '1h':
      return 3600;
    case '4h':
      return 14400;
    default:
      return 900;
  }
}

function deterministicHash(seed: number): number {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * Computes responsive tick-per-row step size based on current zoom level & candle range
 * so Bid x Ask numbers remain crisp, bold, and never overlap vertically.
 */
export function computeAutoRowStep(
  candles: Candle[],
  baseTickSize: number,
  rowMultiplier: number | 'AUTO' = 'AUTO',
  candlesInView = 16,
): number {
  const ranges = candles.map((c) => Math.max(c.high - c.low, baseTickSize));
  const avgRange =
    ranges.length > 0 ? ranges.reduce((a, b) => a + b, 0) / ranges.length : baseTickSize * 4;

  if (typeof rowMultiplier === 'number' && rowMultiplier > 0) {
    return Math.max(baseTickSize * rowMultiplier, avgRange / 14);
  }

  // Target 7-11 clear rows per average candle when deeply zoomed, 5-7 when moderately zoomed
  const targetRows = candlesInView <= 10 ? 10 : candlesInView <= 14 ? 8 : 6;
  const rawStep = avgRange / targetRows;
  const snappedTicks = Math.max(1, Math.round(rawStep / Math.max(baseTickSize * 0.25, 0.0001)));
  return Math.max(baseTickSize * 0.25, snappedTicks * (baseTickSize * 0.25));
}

export function buildTradingViewFootprintCandles(
  symbol: string,
  candles: Candle[],
  ticks: TickTradeEvent[] = [],
  interval = '15m',
  options?: FootprintBuildOptions,
): FootprintCandle[] {
  if (!candles || candles.length === 0) return [];
  const meta = getPairMeta(symbol);
  const imbalancePct = Math.max(150, Math.min(600, options?.imbalanceRatioPct ?? 300));
  const imbalanceFactor = imbalancePct / 100;
  const candlesInView = options?.candlesInView ?? candles.length;
  const stepSize = computeAutoRowStep(
    candles,
    meta.tickSize,
    options?.rowMultiplier ?? 'AUTO',
    candlesInView,
  );
  const candleSpanSec = intervalToSeconds(interval);

  // Bucket real exchange ticks by candle start time (seconds) and rounded price row
  const tickBuckets = new Map<number, Map<number, {bid: number; ask: number}>>();
  for (const t of ticks) {
    if (!t || t.price <= 0 || t.qty <= 0) continue;
    const tsSec = t.ts > 1e12 ? Math.floor(t.ts / 1000) : Math.floor(t.ts);
    const barTime = Math.floor(tsSec / candleSpanSec) * candleSpanSec;
    const rowPrice = Number((Math.round(t.price / stepSize) * stepSize).toFixed(meta.decimals));
    let priceMap = tickBuckets.get(barTime);
    if (!priceMap) {
      priceMap = new Map();
      tickBuckets.set(barTime, priceMap);
    }
    const cell = priceMap.get(rowPrice) || {bid: 0, ask: 0};
    if (t.side === 'BUY') {
      cell.ask += t.qty;
    } else {
      cell.bid += t.qty;
    }
    priceMap.set(rowPrice, cell);
  }

  let runningCvd = 0;

  return candles.map((c, idx) => {
    const barTimeSec = c.time > 1e12 ? Math.floor(c.time / 1000) : Math.floor(c.time);
    const alignedBarTime = Math.floor(barTimeSec / candleSpanSec) * candleSpanSec;
    const realMap = tickBuckets.get(alignedBarTime) || tickBuckets.get(barTimeSec);

    const highSnap = Math.ceil(c.high / stepSize) * stepSize;
    const lowSnap = Math.floor(c.low / stepSize) * stepSize;
    const rawCount = Math.round((highSnap - lowSnap) / stepSize) + 1;
    const rowCount = Math.min(14, Math.max(4, rawCount));
    const effectiveStep = (c.high - c.low) / Math.max(1, rowCount - 1) || stepSize;

    const levels: FootprintLevel[] = [];
    let candleBuyVol = 0;
    let candleSellVol = 0;
    let pocPrice = c.close;
    let maxRowVol = -1;
    let runningCandleDelta = 0;
    let maxDelta = -Infinity;
    let minDelta = Infinity;

    const totalTakerBuy = Math.max(1, c.takerBuyVolume);
    const totalTakerSell = Math.max(1, c.takerSellVolume);

    for (let r = 0; r < rowCount; r++) {
      const price = Number((c.high - r * effectiveStep).toFixed(meta.decimals));
      const snapKey = Number((Math.round(price / stepSize) * stepSize).toFixed(meta.decimals));
      const realCell = realMap?.get(snapKey);

      let bidVol = 0;
      let askVol = 0;

      if (realCell && (realCell.bid > 0 || realCell.ask > 0)) {
        bidVol = Number(realCell.bid.toFixed(1));
        askVol = Number(realCell.ask.toFixed(1));
      } else {
        // Distribute candle takerBuy/takerSell volume deterministically along body & wick auction geometry
        const distFromMid = Math.abs(r - (rowCount - 1) / 2) / Math.max(1, rowCount / 2);
        const bellWeight = Math.max(0.25, 1.35 - distFromMid * 0.9);
        const n1 = 0.6 + deterministicHash(barTimeSec + r * 17) * 0.95;
        const n2 = 0.6 + deterministicHash(barTimeSec + r * 31 + 7) * 0.95;
        const bodyBias = c.close >= c.open ? 1.18 : 0.85;
        const rowSell = (totalTakerSell / rowCount) * bellWeight * n1;
        const rowBuy = (totalTakerBuy / rowCount) * bellWeight * n2 * bodyBias;

        // Sharp auction zeros or extreme single-sided prints at candle highs/lows occasionally
        const isTopOrBot = r === 0 || r === rowCount - 1;
        const lowPrint = isTopOrBot && deterministicHash(barTimeSec + r * 53) > 0.68 ? 0.08 : 1;

        bidVol = Math.round(rowSell * (r === rowCount - 1 ? 1 : lowPrint));
        askVol = Math.round(rowBuy * (r === 0 ? 1 : lowPrint));
      }

      const rowTotal = Number((bidVol + askVol).toFixed(1));
      if (rowTotal > maxRowVol) {
        maxRowVol = rowTotal;
        pocPrice = price;
      }

      candleBuyVol += askVol;
      candleSellVol += bidVol;
      runningCandleDelta += askVol - bidVol;
      if (runningCandleDelta > maxDelta) maxDelta = runningCandleDelta;
      if (runningCandleDelta < minDelta) minDelta = runningCandleDelta;

      levels.push({
        price,
        bidVol,
        askVol,
        totalVol: rowTotal,
        imbalance: 'NONE',
        stackedBuy: false,
        stackedSell: false,
        isPoc: false,
        inValueArea: false,
      });
    }

    // Diagonal Buy & Sell Imbalance Detection (TradingView diagonal auction convention):
    // levels are sorted high -> low:
    // Diagonal Buy Imbalance: Ask[i] >= Bid[i + 1] * imbalanceFactor
    // Diagonal Sell Imbalance: Bid[i + 1] >= Ask[i] * imbalanceFactor
    for (let i = 0; i < levels.length - 1; i++) {
      const upper = levels[i];
      const lower = levels[i + 1];
      if (upper.askVol > 0 && upper.askVol >= Math.max(1, lower.bidVol) * imbalanceFactor) {
        upper.imbalance = 'ASK';
      }
      if (lower.bidVol > 0 && lower.bidVol >= Math.max(1, upper.askVol) * imbalanceFactor) {
        lower.imbalance = 'BID';
      }
    }

    // Mark POC & 70% Value Area
    const pocIdx = levels.findIndex((l) => l.price === pocPrice);
    const totalCandleVol = Math.max(1, levels.reduce((s, l) => s + (l.totalVol ?? l.bidVol + l.askVol), 0));
    if (pocIdx >= 0) {
      levels[pocIdx].isPoc = true;
      levels[pocIdx].inValueArea = true;
      let acc = levels[pocIdx].totalVol ?? 0;
      let up = pocIdx - 1;
      let down = pocIdx + 1;
      while (acc < totalCandleVol * 0.7 && (up >= 0 || down < levels.length)) {
        const upV = up >= 0 ? (levels[up].totalVol ?? 0) : -1;
        const dnV = down < levels.length ? (levels[down].totalVol ?? 0) : -1;
        if (upV >= dnV && up >= 0) {
          levels[up].inValueArea = true;
          acc += upV;
          up--;
        } else if (down < levels.length) {
          levels[down].inValueArea = true;
          acc += dnV;
          down++;
        } else {
          break;
        }
      }
    }

    const vaPrices = levels.filter((l) => l.inValueArea).map((l) => l.price);
    const vahPrice = vaPrices.length > 0 ? Math.max(...vaPrices) : pocPrice;
    const valPrice = vaPrices.length > 0 ? Math.min(...vaPrices) : pocPrice;

    // Detect 3+ Consecutive Stacked Imbalances
    const stackedBuyLevels: number[] = [];
    const stackedSellLevels: number[] = [];
    let buyRun: number[] = [];
    let sellRun: number[] = [];

    for (let i = 0; i < levels.length; i++) {
      if (levels[i].imbalance === 'ASK') {
        buyRun.push(i);
      } else {
        if (buyRun.length >= 3) {
          for (const k of buyRun) {
            levels[k].stackedBuy = true;
            stackedBuyLevels.push(levels[k].price);
          }
        }
        buyRun = [];
      }

      if (levels[i].imbalance === 'BID') {
        sellRun.push(i);
      } else {
        if (sellRun.length >= 3) {
          for (const k of sellRun) {
            levels[k].stackedSell = true;
            stackedSellLevels.push(levels[k].price);
          }
        }
        sellRun = [];
      }
    }
    if (buyRun.length >= 3) {
      for (const k of buyRun) {
        levels[k].stackedBuy = true;
        stackedBuyLevels.push(levels[k].price);
      }
    }
    if (sellRun.length >= 3) {
      for (const k of sellRun) {
        levels[k].stackedSell = true;
        stackedSellLevels.push(levels[k].price);
      }
    }

    // Unfinished Auctions: Both non-zero Bid & Ask prints at extreme high or low
    const topLvl = levels[0];
    const botLvl = levels[levels.length - 1];
    const unfinishedAuctionHigh = Boolean(topLvl && topLvl.bidVol > 0 && topLvl.askVol > 0);
    const unfinishedAuctionLow = Boolean(botLvl && botLvl.bidVol > 0 && botLvl.askVol > 0);

    const deltaVal = Math.round(candleBuyVol - candleSellVol);
    const volVal = Math.round(candleBuyVol + candleSellVol);
    const deltaPercent = volVal > 0 ? Number(((deltaVal / volVal) * 100).toFixed(1)) : 0;
    runningCvd += deltaVal;

    const d = new Date(c.time > 1e12 ? c.time : c.time * 1000);
    const hh = String(d.getUTCHours()).padStart(2, '0');
    const mm = String(d.getUTCMinutes()).padStart(2, '0');

    return {
      index: idx,
      time: c.time,
      timeLabel: `${hh}:${mm}`,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: volVal,
      buyVolume: Math.round(candleBuyVol),
      sellVolume: Math.round(candleSellVol),
      delta: deltaVal,
      deltaPercent,
      maxDelta: Math.round(maxDelta === -Infinity ? deltaVal : maxDelta),
      minDelta: Math.round(minDelta === Infinity ? deltaVal : minDelta),
      cvd: Math.round(runningCvd),
      pocPrice,
      vahPrice,
      valPrice,
      unfinishedAuctionHigh,
      unfinishedAuctionLow,
      stackedBuyLevels,
      stackedSellLevels,
      levels,
    };
  });
}

export function formatCompactVol(vol: number): string {
  const abs = Math.abs(vol);
  if (abs >= 1_000_000) return `${(vol / 1_000_000).toFixed(1)}M`;
  if (abs >= 10_000) return `${(vol / 1_000).toFixed(1)}K`;
  if (abs >= 1_000) return `${(vol / 1_000).toFixed(1)}K`;
  return String(Math.round(vol));
}
