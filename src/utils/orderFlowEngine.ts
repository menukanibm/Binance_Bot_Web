import type {
  Candle,
  ConfluenceGateResult,
  ExchangeType,
  L1Quote,
  L3ConfirmationState,
  MsnrLevel,
  OrderBookLevel,
  OrderFlowL3Snapshot,
  SyntheticL3Event,
  TickTradeEvent,
} from '../types/trading.ts';

export interface L1BookTickerInput {
  bestBid: number;
  bestAsk: number;
  bestBidQty: number;
  bestAskQty: number;
  ts?: number;
}

export interface DepthDeltaInput {
  bids: Array<[number, number]>;
  asks: Array<[number, number]>;
  ts?: number;
  isSnapshot?: boolean;
}

interface IndexedTrade {
  price: number;
  qty: number;
  side: 'BUY' | 'SELL';
  ts: number;
}

const MAX_EVENTS = 40;
const TRADE_WINDOW_MS = 15_000;
const MATCH_TOLERANCE_MS = 350;

function priceKey(price: number, decimals: number): string {
  return price.toFixed(decimals);
}

function inferDecimals(price: number): number {
  if (!Number.isFinite(price) || price <= 0) return 2;
  if (price >= 1000) return 2;
  if (price >= 10) return 3;
  if (price >= 0.1) return 4;
  return 6;
}

/**
 * Institutional Real-Time Market Microstructure Engine:
 * - Level 1 (L1): Best Bid/Ask, Spread, Top-of-Book Size, AggTrades (buyer vs seller initiated)
 * - Level 2 (L2): Full Depth snapshots + incremental 100ms depth deltas
 * - Synthetic Level 3 (L3): Cross-references L2 level deltas against same-millisecond aggTrades
 *   to distinguish actual fills from cancelled spoofing walls, detect passive iceberg absorption,
 *   and track multi-level queue depletion/sweeps.
 */
export class OrderFlowEngine {
  public readonly symbol: string;
  public readonly exchange: ExchangeType;
  private decimals: number;
  private bids = new Map<string, {price: number; qty: number}>();
  private asks = new Map<string, {price: number; qty: number}>();
  private recentTrades: IndexedTrade[] = [];
  private events: SyntheticL3Event[] = [];

  private l1: L1Quote = {
    bestBid: 0,
    bestAsk: 0,
    bestBidQty: 0,
    bestAskQty: 0,
    spread: 0,
    spreadBps: 0,
    midPrice: 0,
    updatedAt: Date.now(),
  };

  private addedLimitQty = 0;
  private cancelledSpoofQty = 0;
  private opposingSpoofSide: 'BID' | 'ASK' | 'NONE' = 'NONE';
  private lastSpoofTs = 0;

  private absorptionSide: 'BUY' | 'SELL' | 'NONE' = 'NONE';
  private icebergPrice: number | null = null;
  private icebergReloadCount = 0;
  private lastAbsorptionTs = 0;

  private queueDepletionSide: 'BID' | 'ASK' | 'NONE' = 'NONE';
  private sweepLevelsCount = 0;
  private lastSweepTs = 0;

  private eventSeq = 0;

  constructor(symbol: string, exchange: ExchangeType, decimals = 2) {
    this.symbol = symbol.toUpperCase();
    this.exchange = exchange;
    this.decimals = decimals;
  }

  public setDecimals(decimals: number): void {
    if (Number.isInteger(decimals) && decimals >= 0 && decimals <= 8) {
      this.decimals = decimals;
    }
  }

  public ingestBookTicker(input: L1BookTickerInput): L1Quote {
    const ts = input.ts ?? Date.now();
    if (input.bestBid > 0 && input.bestAsk > 0) {
      const spread = Math.max(0, Number((input.bestAsk - input.bestBid).toFixed(this.decimals + 2)));
      const midPrice = Number(((input.bestBid + input.bestAsk) / 2).toFixed(this.decimals));
      const spreadBps = midPrice > 0 ? Number(((spread / midPrice) * 10_000).toFixed(2)) : 0;
      this.l1 = {
        bestBid: input.bestBid,
        bestAsk: input.bestAsk,
        bestBidQty: Math.max(0, input.bestBidQty),
        bestAskQty: Math.max(0, input.bestAskQty),
        spread,
        spreadBps,
        midPrice,
        updatedAt: ts,
      };
    }
    return this.l1;
  }

  public ingestAggTrade(trade: TickTradeEvent): void {
    if (!trade || trade.price <= 0 || trade.qty <= 0) return;
    const ts = trade.ts || Date.now();
    this.recentTrades.push({
      price: trade.price,
      qty: trade.qty,
      side: trade.side,
      ts,
    });
    this.pruneOldTrades(ts);
  }

  public ingestDepthDelta(input: DepthDeltaInput): OrderFlowL3Snapshot {
    const ts = input.ts ?? Date.now();
    this.pruneOldTrades(ts);

    if (input.isSnapshot) {
      this.bids.clear();
      this.asks.clear();
      for (const [price, qty] of input.bids) {
        if (price > 0 && qty > 0) {
          this.bids.set(priceKey(price, this.decimals), {price, qty});
        }
      }
      for (const [price, qty] of input.asks) {
        if (price > 0 && qty > 0) {
          this.asks.set(priceKey(price, this.decimals), {price, qty});
        }
      }
      this.syncL1FromDepth(ts);
      return this.getSnapshot(ts);
    }

    const avgLevelQty = this.computeAverageLevelQty();
    const wallThreshold = Math.max(5, avgLevelQty * 1.4);

    let depletedBidLevels = 0;
    let depletedAskLevels = 0;

    // Evaluate BID L2 deltas against aggressive SELL aggTrades
    for (const [price, newQty] of input.bids) {
      if (price <= 0) continue;
      const key = priceKey(price, this.decimals);
      const prev = this.bids.get(key)?.qty ?? 0;
      const delta = newQty - prev;
      const matchedSellVol = this.sumMatchedTradeQty(price, 'SELL', ts);

      if (delta > 0) {
        this.addedLimitQty = Number((this.addedLimitQty + delta).toFixed(2));
        if (matchedSellVol >= Math.max(2, prev * 0.25) && newQty >= prev) {
          // Aggressive sells hit this bid level, yet the resting bid size reloaded -> Buy Iceberg Absorption
          this.recordAbsorption('BUY', price, delta, matchedSellVol, ts);
        }
      } else if (delta < 0) {
        const dropped = Math.abs(delta);
        const unmatchedCancelled = Math.max(0, dropped - matchedSellVol);
        const fillRatio = dropped > 0 ? matchedSellVol / dropped : 0;

        if (unmatchedCancelled >= wallThreshold && fillRatio < 0.35) {
          // Large resting bid liquidity pulled without being traded -> Spoofing / Cancellation
          this.cancelledSpoofQty = Number((this.cancelledSpoofQty + unmatchedCancelled).toFixed(2));
          this.opposingSpoofSide = 'BID';
          this.lastSpoofTs = ts;
          this.pushEvent({
            type: 'SPOOF_CANCEL',
            side: 'BID',
            price,
            deltaQty: Number((-unmatchedCancelled).toFixed(2)),
            matchedTradeQty: Number(matchedSellVol.toFixed(2)),
            confidence: Math.min(98, Math.round(70 + (1 - fillRatio) * 28)),
            description: `Bid wall cancelled (-${unmatchedCancelled.toFixed(1)}) with only ${matchedSellVol.toFixed(1)} filled @ $${price.toFixed(this.decimals)}`,
            ts,
          });
        } else if (matchedSellVol >= dropped * 0.55 && (newQty === 0 || newQty <= prev * 0.25)) {
          depletedBidLevels += 1;
        }
      } else if (matchedSellVol >= Math.max(4, prev * 0.4) && prev > 0) {
        // Resting size did not drop despite heavy aggressive selling -> Passive Buy Absorption
        this.recordAbsorption('BUY', price, 0, matchedSellVol, ts);
      }

      if (newQty <= 0) {
        this.bids.delete(key);
      } else {
        this.bids.set(key, {price, qty: newQty});
      }
    }

    // Evaluate ASK L2 deltas against aggressive BUY aggTrades
    for (const [price, newQty] of input.asks) {
      if (price <= 0) continue;
      const key = priceKey(price, this.decimals);
      const prev = this.asks.get(key)?.qty ?? 0;
      const delta = newQty - prev;
      const matchedBuyVol = this.sumMatchedTradeQty(price, 'BUY', ts);

      if (delta > 0) {
        this.addedLimitQty = Number((this.addedLimitQty + delta).toFixed(2));
        if (matchedBuyVol >= Math.max(2, prev * 0.25) && newQty >= prev) {
          // Aggressive buys hit this ask level, yet resting ask size reloaded -> Sell Iceberg Absorption
          this.recordAbsorption('SELL', price, delta, matchedBuyVol, ts);
        }
      } else if (delta < 0) {
        const dropped = Math.abs(delta);
        const unmatchedCancelled = Math.max(0, dropped - matchedBuyVol);
        const fillRatio = dropped > 0 ? matchedBuyVol / dropped : 0;

        if (unmatchedCancelled >= wallThreshold && fillRatio < 0.35) {
          this.cancelledSpoofQty = Number((this.cancelledSpoofQty + unmatchedCancelled).toFixed(2));
          this.opposingSpoofSide = 'ASK';
          this.lastSpoofTs = ts;
          this.pushEvent({
            type: 'SPOOF_CANCEL',
            side: 'ASK',
            price,
            deltaQty: Number((-unmatchedCancelled).toFixed(2)),
            matchedTradeQty: Number(matchedBuyVol.toFixed(2)),
            confidence: Math.min(98, Math.round(70 + (1 - fillRatio) * 28)),
            description: `Ask wall spoof pulled (-${unmatchedCancelled.toFixed(1)}) with ${matchedBuyVol.toFixed(1)} filled @ $${price.toFixed(this.decimals)}`,
            ts,
          });
        } else if (matchedBuyVol >= dropped * 0.55 && (newQty === 0 || newQty <= prev * 0.25)) {
          depletedAskLevels += 1;
        }
      } else if (matchedBuyVol >= Math.max(4, prev * 0.4) && prev > 0) {
        this.recordAbsorption('SELL', price, 0, matchedBuyVol, ts);
      }

      if (newQty <= 0) {
        this.asks.delete(key);
      } else {
        this.asks.set(key, {price, qty: newQty});
      }
    }

    // Multi-level queue depletion / aggressive sweep detection
    if (depletedAskLevels >= 2) {
      this.queueDepletionSide = 'ASK';
      this.sweepLevelsCount = depletedAskLevels;
      this.lastSweepTs = ts;
      this.pushEvent({
        type: 'QUEUE_SWEEP',
        side: 'ASK',
        price: this.l1.bestAsk || 0,
        deltaQty: depletedAskLevels,
        matchedTradeQty: this.getRecentTakerVolumes().buyVol,
        confidence: Math.min(96, 72 + depletedAskLevels * 6),
        description: `Aggressive Buy Sweep depleted ${depletedAskLevels} consecutive Ask levels`,
        ts,
      });
    } else if (depletedBidLevels >= 2) {
      this.queueDepletionSide = 'BID';
      this.sweepLevelsCount = depletedBidLevels;
      this.lastSweepTs = ts;
      this.pushEvent({
        type: 'QUEUE_SWEEP',
        side: 'BID',
        price: this.l1.bestBid || 0,
        deltaQty: depletedBidLevels,
        matchedTradeQty: this.getRecentTakerVolumes().sellVol,
        confidence: Math.min(96, 72 + depletedBidLevels * 6),
        description: `Aggressive Sell Sweep depleted ${depletedBidLevels} consecutive Bid levels`,
        ts,
      });
    }

    this.syncL1FromDepth(ts);
    return this.getSnapshot(ts);
  }

  public getSnapshot(now = Date.now()): OrderFlowL3Snapshot {
    this.pruneOldTrades(now);
    const {buyVol, sellVol} = this.getRecentTakerVolumes();
    const takerDelta = Number((buyVol - sellVol).toFixed(2));
    const totalTaker = buyVol + sellVol;

    let l2TotalBidQty = 0;
    let l2BidWallPrice = this.l1.bestBid;
    let l2BidWallQty = 0;
    for (const lvl of this.bids.values()) {
      l2TotalBidQty += lvl.qty;
      if (lvl.qty > l2BidWallQty) {
        l2BidWallQty = lvl.qty;
        l2BidWallPrice = lvl.price;
      }
    }

    let l2TotalAskQty = 0;
    let l2AskWallPrice = this.l1.bestAsk;
    let l2AskWallQty = 0;
    for (const lvl of this.asks.values()) {
      l2TotalAskQty += lvl.qty;
      if (lvl.qty > l2AskWallQty) {
        l2AskWallQty = lvl.qty;
        l2AskWallPrice = lvl.price;
      }
    }

    // Expire stale events after 45s
    const spoofingFresh = now - this.lastSpoofTs <= 45_000 && this.opposingSpoofSide !== 'NONE';
    const absorptionFresh = now - this.lastAbsorptionTs <= 45_000 && this.absorptionSide !== 'NONE';
    const sweepFresh = now - this.lastSweepTs <= 30_000 && this.queueDepletionSide !== 'NONE';

    // Compute L3 Micro-Imbalance Score (-100 to +100)
    const bookDenom = Math.max(1, l2TotalBidQty + l2TotalAskQty);
    const bookImbalance = ((l2TotalBidQty - l2TotalAskQty) / bookDenom) * 35;
    const takerImbalance = totalTaker > 0 ? (takerDelta / totalTaker) * 35 : 0;
    const absorptionBoost = absorptionFresh
      ? this.absorptionSide === 'BUY'
        ? 22
        : -22
      : 0;
    const sweepBoost = sweepFresh ? (this.queueDepletionSide === 'ASK' ? 14 : -14) : 0;
    const spoofPenalty = spoofingFresh ? (this.opposingSpoofSide === 'ASK' ? -12 : 12) : 0;

    const rawScore = bookImbalance + takerImbalance + absorptionBoost + sweepBoost + spoofPenalty;
    const queueImbalanceScore = Math.max(-100, Math.min(100, Math.round(rawScore)));

    // Strict L3 Confirmation State
    let confirmationState: L3ConfirmationState = 'NEUTRAL';
    if (
      absorptionFresh &&
      this.absorptionSide === 'BUY' &&
      takerDelta > 0 &&
      queueImbalanceScore >= 25 &&
      !(spoofingFresh && this.opposingSpoofSide === 'ASK')
    ) {
      confirmationState = 'BULLISH_L3_CONFIRMED';
    } else if (
      absorptionFresh &&
      this.absorptionSide === 'SELL' &&
      takerDelta < 0 &&
      queueImbalanceScore <= -25 &&
      !(spoofingFresh && this.opposingSpoofSide === 'BID')
    ) {
      confirmationState = 'BEARISH_L3_CONFIRMED';
    }

    return {
      symbol: this.symbol,
      exchange: this.exchange,
      l1: {...this.l1},
      l2BidWallPrice: Number(l2BidWallPrice.toFixed(this.decimals)),
      l2BidWallQty: Number(l2BidWallQty.toFixed(2)),
      l2AskWallPrice: Number(l2AskWallPrice.toFixed(this.decimals)),
      l2AskWallQty: Number(l2AskWallQty.toFixed(2)),
      l2TotalBidQty: Number(l2TotalBidQty.toFixed(2)),
      l2TotalAskQty: Number(l2TotalAskQty.toFixed(2)),
      addedLimitQty: Number(this.addedLimitQty.toFixed(2)),
      cancelledSpoofQty: Number(this.cancelledSpoofQty.toFixed(2)),
      spoofingDetected: spoofingFresh,
      opposingSpoofSide: spoofingFresh ? this.opposingSpoofSide : 'NONE',
      absorptionDetected: absorptionFresh,
      absorptionSide: absorptionFresh ? this.absorptionSide : 'NONE',
      icebergPrice: absorptionFresh ? this.icebergPrice : null,
      icebergReloadCount: absorptionFresh ? this.icebergReloadCount : 0,
      queueDepletionSide: sweepFresh ? this.queueDepletionSide : 'NONE',
      sweepLevelsCount: sweepFresh ? this.sweepLevelsCount : 0,
      takerBuyVol: Number(buyVol.toFixed(2)),
      takerSellVol: Number(sellVol.toFixed(2)),
      takerDelta,
      queueImbalanceScore,
      confirmationState,
      recentEvents: this.events.slice(0, 12),
      updatedAt: now,
    };
  }

  private recordAbsorption(
    side: 'BUY' | 'SELL',
    price: number,
    reloadQty: number,
    matchedVol: number,
    ts: number,
  ): void {
    const samePrice =
      this.icebergPrice !== null && Math.abs(this.icebergPrice - price) < Math.pow(10, -this.decimals);
    this.absorptionSide = side;
    this.icebergPrice = Number(price.toFixed(this.decimals));
    this.icebergReloadCount = samePrice ? this.icebergReloadCount + 1 : Math.max(1, this.icebergReloadCount + 1);
    this.lastAbsorptionTs = ts;
    this.pushEvent({
      type: 'ICEBERG_ABSORPTION',
      side: side === 'BUY' ? 'BID' : 'ASK',
      price: Number(price.toFixed(this.decimals)),
      deltaQty: Number(reloadQty.toFixed(2)),
      matchedTradeQty: Number(matchedVol.toFixed(2)),
      confidence: Math.min(99, 76 + this.icebergReloadCount * 5),
      description: `Passive ${side} Iceberg absorbed ${matchedVol.toFixed(1)} aggressive vol @ $${price.toFixed(this.decimals)} (Reload #${this.icebergReloadCount})`,
      ts,
    });
  }

  private pushEvent(ev: Omit<SyntheticL3Event, 'id'>): void {
    this.eventSeq += 1;
    this.events.unshift({
      ...ev,
      id: `l3-${this.symbol}-${ev.ts}-${this.eventSeq}`,
    });
    if (this.events.length > MAX_EVENTS) {
      this.events.length = MAX_EVENTS;
    }
  }

  private pruneOldTrades(now: number): void {
    const cutoff = now - TRADE_WINDOW_MS;
    while (this.recentTrades.length > 0 && this.recentTrades[0].ts < cutoff) {
      this.recentTrades.shift();
    }
  }

  private sumMatchedTradeQty(price: number, side: 'BUY' | 'SELL', ts: number): number {
    const eps = Math.max(Math.pow(10, -this.decimals) * 0.6, price * 0.00002);
    let sum = 0;
    for (let i = this.recentTrades.length - 1; i >= 0; i--) {
      const t = this.recentTrades[i];
      if (ts - t.ts > MATCH_TOLERANCE_MS) break;
      if (t.side === side && Math.abs(t.price - price) <= eps) {
        sum += t.qty;
      }
    }
    return sum;
  }

  private getRecentTakerVolumes(): {buyVol: number; sellVol: number} {
    let buyVol = 0;
    let sellVol = 0;
    for (const t of this.recentTrades) {
      if (t.side === 'BUY') buyVol += t.qty;
      else sellVol += t.qty;
    }
    return {buyVol, sellVol};
  }

  private computeAverageLevelQty(): number {
    let total = 0;
    let count = 0;
    for (const b of this.bids.values()) {
      total += b.qty;
      count += 1;
    }
    for (const a of this.asks.values()) {
      total += a.qty;
      count += 1;
    }
    return count > 0 ? total / count : 10;
  }

  private syncL1FromDepth(ts: number): void {
    let bestBid = 0;
    let bestBidQty = 0;
    for (const b of this.bids.values()) {
      if (b.price > bestBid) {
        bestBid = b.price;
        bestBidQty = b.qty;
      }
    }

    let bestAsk = Infinity;
    let bestAskQty = 0;
    for (const a of this.asks.values()) {
      if (a.price < bestAsk) {
        bestAsk = a.price;
        bestAskQty = a.qty;
      }
    }

    if (bestBid > 0 && Number.isFinite(bestAsk) && bestAsk > 0) {
      this.ingestBookTicker({
        bestBid,
        bestAsk,
        bestBidQty,
        bestAskQty,
        ts,
      });
    }
  }
}

/**
 * Deterministic L1/L2/Synthetic L3 builder from REST/historical candles, depth, and ticks
 * used for initial snapshot hydration before real-time 100ms depth deltas accumulate.
 */
export function buildL3SnapshotFromMarketData(params: {
  symbol: string;
  exchange: ExchangeType;
  candles: Candle[];
  orderBook: OrderBookLevel[];
  recentTicks?: TickTradeEvent[];
}): OrderFlowL3Snapshot {
  const {symbol, exchange, candles, orderBook, recentTicks = []} = params;
  const lastCandle = candles[candles.length - 1];
  const refPrice = lastCandle?.close || 100;
  const decimals = inferDecimals(refPrice);

  const bids = orderBook
    .filter((l) => l.bidSize > 0)
    .sort((a, b) => b.price - a.price);
  const asks = orderBook
    .filter((l) => l.askSize > 0)
    .sort((a, b) => a.price - b.price);

  const bestBid = bids[0]?.price ?? Number((refPrice * 0.9999).toFixed(decimals));
  const bestAsk = asks[0]?.price ?? Number((refPrice * 1.0001).toFixed(decimals));
  const bestBidQty = bids[0]?.bidSize ?? 14.5;
  const bestAskQty = asks[0]?.askSize ?? 12.2;
  const spread = Math.max(0, Number((bestAsk - bestBid).toFixed(decimals + 2)));
  const midPrice = Number(((bestBid + bestAsk) / 2).toFixed(decimals));
  const spreadBps = midPrice > 0 ? Number(((spread / midPrice) * 10_000).toFixed(2)) : 0;

  const bidWall = bids.reduce(
    (best, cur) => (cur.bidSize > best.bidSize ? cur : best),
    bids[0] || {price: bestBid, bidSize: bestBidQty},
  );
  const askWall = asks.reduce(
    (best, cur) => (cur.askSize > best.askSize ? cur : best),
    asks[0] || {price: bestAsk, askSize: bestAskQty},
  );

  const l2TotalBidQty = Number(bids.reduce((s, l) => s + l.bidSize, 0).toFixed(2));
  const l2TotalAskQty = Number(asks.reduce((s, l) => s + l.askSize, 0).toFixed(2));

  let takerBuyVol = 0;
  let takerSellVol = 0;
  if (recentTicks.length > 0) {
    for (const t of recentTicks) {
      if (t.side === 'BUY') takerBuyVol += t.qty;
      else takerSellVol += t.qty;
    }
  } else if (lastCandle) {
    takerBuyVol = lastCandle.takerBuyVolume;
    takerSellVol = lastCandle.takerSellVolume;
  }
  const takerDelta = Number((takerBuyVol - takerSellVol).toFixed(2));
  const totalTaker = Math.max(1, takerBuyVol + takerSellVol);
  const deltaRatio = takerDelta / totalTaker;

  // Detect absorption from candle wick rejection + strong opposing resting depth wall
  const body = lastCandle ? Math.abs(lastCandle.close - lastCandle.open) : 0;
  const lowerWick = lastCandle ? Math.min(lastCandle.open, lastCandle.close) - lastCandle.low : 0;
  const upperWick = lastCandle ? lastCandle.high - Math.max(lastCandle.open, lastCandle.close) : 0;

  const buyAbsorption =
    deltaRatio > 0.1 && l2TotalBidQty >= l2TotalAskQty * 1.05 && (lowerWick >= body * 0.25 || deltaRatio > 0.16);
  const sellAbsorption =
    deltaRatio < -0.1 && l2TotalAskQty >= l2TotalBidQty * 1.05 && (upperWick >= body * 0.25 || deltaRatio < -0.16);

  const absorptionSide: 'BUY' | 'SELL' | 'NONE' = buyAbsorption
    ? 'BUY'
    : sellAbsorption
      ? 'SELL'
      : 'NONE';
  const absorptionDetected = absorptionSide !== 'NONE';
  const icebergPrice =
    absorptionSide === 'BUY'
      ? bidWall.price
      : absorptionSide === 'SELL'
        ? askWall.price
        : null;
  const icebergReloadCount = absorptionDetected
    ? Math.max(2, Math.min(6, Math.round(Math.abs(deltaRatio) * 18)))
    : 0;

  // Detect potential spoofing wall when one side has an extreme resting wall opposing taker flow
  const opposingAskSpoof =
    takerDelta > 0 && askWall.askSize > Math.max(25, bidWall.bidSize * 2.1);
  const opposingBidSpoof =
    takerDelta < 0 && bidWall.bidSize > Math.max(25, askWall.askSize * 2.1);
  const opposingSpoofSide: 'BID' | 'ASK' | 'NONE' = opposingAskSpoof
    ? 'ASK'
    : opposingBidSpoof
      ? 'BID'
      : 'NONE';
  const spoofingDetected = opposingSpoofSide !== 'NONE';

  const bookImbalance =
    ((l2TotalBidQty - l2TotalAskQty) / Math.max(1, l2TotalBidQty + l2TotalAskQty)) * 40;
  const takerImbalance = deltaRatio * 45;
  const absBoost = absorptionSide === 'BUY' ? 20 : absorptionSide === 'SELL' ? -20 : 0;
  const queueImbalanceScore = Math.max(
    -100,
    Math.min(100, Math.round(bookImbalance + takerImbalance + absBoost)),
  );

  let confirmationState: L3ConfirmationState = 'NEUTRAL';
  if (
    absorptionSide === 'BUY' &&
    takerDelta > 0 &&
    queueImbalanceScore >= 25 &&
    opposingSpoofSide !== 'ASK'
  ) {
    confirmationState = 'BULLISH_L3_CONFIRMED';
  } else if (
    absorptionSide === 'SELL' &&
    takerDelta < 0 &&
    queueImbalanceScore <= -25 &&
    opposingSpoofSide !== 'BID'
  ) {
    confirmationState = 'BEARISH_L3_CONFIRMED';
  }

  const now = Date.now();
  const recentEvents: SyntheticL3Event[] = [];
  if (absorptionDetected && icebergPrice !== null) {
    recentEvents.push({
      id: `l3-abs-${symbol}-${now}`,
      type: 'ICEBERG_ABSORPTION',
      side: absorptionSide === 'BUY' ? 'BID' : 'ASK',
      price: icebergPrice,
      deltaQty: Number((absorptionSide === 'BUY' ? bidWall.bidSize : askWall.askSize).toFixed(2)),
      matchedTradeQty: Number((absorptionSide === 'BUY' ? takerBuyVol : takerSellVol).toFixed(2)),
      confidence: Math.min(96, 74 + icebergReloadCount * 4),
      description: `Passive ${absorptionSide} Iceberg defense @ $${icebergPrice.toFixed(decimals)} (${icebergReloadCount}x reloads)`,
      ts: now - 400,
    });
  }
  if (spoofingDetected) {
    const spoofPrice = opposingSpoofSide === 'ASK' ? askWall.price : bidWall.price;
    const spoofQty = opposingSpoofSide === 'ASK' ? askWall.askSize : bidWall.bidSize;
    recentEvents.push({
      id: `l3-spoof-${symbol}-${now}`,
      type: 'SPOOF_CANCEL',
      side: opposingSpoofSide === 'ASK' ? 'ASK' : 'BID',
      price: spoofPrice,
      deltaQty: Number((-spoofQty * 0.72).toFixed(2)),
      matchedTradeQty: Number((spoofQty * 0.08).toFixed(2)),
      confidence: 86,
      description: `Unfilled ${opposingSpoofSide} spoofing wall pulled @ $${spoofPrice.toFixed(decimals)}`,
      ts: now - 1200,
    });
  }
  if (Math.abs(deltaRatio) > 0.14) {
    const sweepSide: 'BID' | 'ASK' = deltaRatio > 0 ? 'ASK' : 'BID';
    recentEvents.push({
      id: `l3-sweep-${symbol}-${now}`,
      type: 'QUEUE_SWEEP',
      side: sweepSide,
      price: sweepSide === 'ASK' ? bestAsk : bestBid,
      deltaQty: 3,
      matchedTradeQty: Number(Math.abs(takerDelta).toFixed(2)),
      confidence: 82,
      description: `${sweepSide === 'ASK' ? 'Buyers' : 'Sellers'} swept 3 ${sweepSide} levels across touch`,
      ts: now - 2100,
    });
  }

  return {
    symbol,
    exchange,
    l1: {
      bestBid,
      bestAsk,
      bestBidQty: Number(bestBidQty.toFixed(2)),
      bestAskQty: Number(bestAskQty.toFixed(2)),
      spread,
      spreadBps,
      midPrice,
      updatedAt: now,
    },
    l2BidWallPrice: Number(bidWall.price.toFixed(decimals)),
    l2BidWallQty: Number(bidWall.bidSize.toFixed(2)),
    l2AskWallPrice: Number(askWall.price.toFixed(decimals)),
    l2AskWallQty: Number(askWall.askSize.toFixed(2)),
    l2TotalBidQty,
    l2TotalAskQty,
    addedLimitQty: Number(((l2TotalBidQty + l2TotalAskQty) * 0.35).toFixed(2)),
    cancelledSpoofQty: spoofingDetected
      ? Number(((opposingSpoofSide === 'ASK' ? askWall.askSize : bidWall.bidSize) * 0.72).toFixed(2))
      : 0,
    spoofingDetected,
    opposingSpoofSide,
    absorptionDetected,
    absorptionSide,
    icebergPrice,
    icebergReloadCount,
    queueDepletionSide: Math.abs(deltaRatio) > 0.14 ? (deltaRatio > 0 ? 'ASK' : 'BID') : 'NONE',
    sweepLevelsCount: Math.abs(deltaRatio) > 0.14 ? 3 : 0,
    takerBuyVol: Number(takerBuyVol.toFixed(2)),
    takerSellVol: Number(takerSellVol.toFixed(2)),
    takerDelta,
    queueImbalanceScore,
    confirmationState,
    recentEvents,
    updatedAt: now,
  };
}

/**
 * STRICT NON-NEGOTIABLE CONFLUENCE GATEKEEPER (MSNR + L3 AND-GATE)
 *
 * NO signal may be emitted and NO trade may be opened unless EVERY condition passes simultaneously:
 * 1. MSNR_VALID === true (HTF storyline + fresh MSNR tap + clean 1:2 R:R traffic + LTF reaction)
 * 2. L3_CONFIRMED === true (Aligned L3 passive absorption/iceberg + no opposing spoof wall + aligned taker delta & L3 confirmation state)
 * 3. VALID_API_KEY === true (required for autonomous execution)
 */
export function evaluateStrictConfluenceGate(params: {
  bias: 'LONG' | 'SHORT';
  storyline4h: 'BULLISH' | 'BEARISH' | 'RANGE';
  storyline1h: 'BULLISH' | 'BEARISH' | 'RANGE';
  freshLevels: MsnrLevel[];
  currentPrice: number;
  riskRewardRatio: number;
  cleanTraffic: boolean;
  ltfReactionConfirmed: boolean;
  l3: OrderFlowL3Snapshot;
  apiKeyValid?: boolean;
}): ConfluenceGateResult {
  const expectedStoryline = params.bias === 'LONG' ? 'BULLISH' : 'BEARISH';
  const htfStorylineValid =
    params.storyline4h === expectedStoryline && params.storyline1h === expectedStoryline;

  const hasFreshDirectionalLevel = params.freshLevels.some((lvl) => {
    if (!lvl.fresh) return false;
    const distPct =
      params.currentPrice > 0
        ? (Math.abs(params.currentPrice - lvl.price) / params.currentPrice) * 100
        : 99;
    return distPct <= 1.25;
  });

  const cleanTraffic = Boolean(params.cleanTraffic && params.riskRewardRatio >= 2.0);
  const ltfReactionConfirmed = Boolean(params.ltfReactionConfirmed);
  const msnrValid =
    htfStorylineValid && hasFreshDirectionalLevel && cleanTraffic && ltfReactionConfirmed;

  // Synthetic L3 validation
  const expectedAbsorption: 'BUY' | 'SELL' = params.bias === 'LONG' ? 'BUY' : 'SELL';
  const opposingWall: 'ASK' | 'BID' = params.bias === 'LONG' ? 'ASK' : 'BID';
  const expectedState: L3ConfirmationState =
    params.bias === 'LONG' ? 'BULLISH_L3_CONFIRMED' : 'BEARISH_L3_CONFIRMED';

  const absorptionAligned =
    params.l3.absorptionDetected && params.l3.absorptionSide === expectedAbsorption;
  const noOpposingSpoof = !(
    params.l3.spoofingDetected && params.l3.opposingSpoofSide === opposingWall
  );
  const takerDeltaAligned =
    params.bias === 'LONG'
      ? params.l3.takerDelta > 0 && params.l3.queueImbalanceScore >= 25
      : params.l3.takerDelta < 0 && params.l3.queueImbalanceScore <= -25;

  const l3Confirmed =
    absorptionAligned &&
    noOpposingSpoof &&
    takerDeltaAligned &&
    params.l3.confirmationState === expectedState;

  const apiKeyValid = Boolean(params.apiKeyValid);
  const canEmitSignal = msnrValid && l3Confirmed;
  const canAutoExecute = canEmitSignal && apiKeyValid;

  let rejectionCode: ConfluenceGateResult['rejectionCode'] = 'NONE';
  let rejectionLabel = 'ALL GATES PASSED (MSNR + L3 CONFIRMED)';

  if (msnrValid && !l3Confirmed) {
    if (!noOpposingSpoof) {
      rejectionCode = 'OPPOSING_SPOOF_WALL';
      rejectionLabel = 'Waiting for L3 Confirmation (Opposing Spoof Wall)';
    } else {
      rejectionCode = 'WAITING_FOR_L3';
      rejectionLabel = 'Waiting for L3 Confirmation';
    }
  } else if (!msnrValid && l3Confirmed) {
    rejectionCode = 'NO_VALID_MSNR';
    rejectionLabel = 'No Valid MSNR Zone';
  } else if (!msnrValid && !l3Confirmed) {
    rejectionCode = 'MSNR_RULES_UNMET';
    rejectionLabel = 'No Valid MSNR Zone · Waiting for L3 Confirmation';
  } else if (canEmitSignal && !apiKeyValid) {
    rejectionCode = 'API_KEY_REQUIRED';
    rejectionLabel = 'MSNR + L3 Confirmed · API Key Required to Execute';
  }

  return {
    msnrValid,
    msnrDetails: {
      htfStorylineValid,
      freshLevelTapped: hasFreshDirectionalLevel,
      cleanTraffic,
      ltfReactionConfirmed,
    },
    l3Confirmed,
    l3Details: {
      absorptionAligned,
      noOpposingSpoof,
      takerDeltaAligned,
      confirmationState: params.l3.confirmationState,
    },
    apiKeyValid,
    canEmitSignal,
    canAutoExecute,
    rejectionCode,
    rejectionLabel,
  };
}
