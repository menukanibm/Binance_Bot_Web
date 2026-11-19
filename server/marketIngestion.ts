import {EventEmitter} from 'node:events';
import WebSocket from 'ws';
import type {
  Candle,
  ExchangeType,
  FootprintSignalAnalysis,
  IneligibleSignal,
  MarketStreamSnapshot,
  MultiTimeframeCandles,
  OrderBookLevel,
  OrderFlowL3Snapshot,
  TickTradeEvent,
} from '../src/types/trading.ts';
import {
  buildL3SnapshotFromMarketData,
  OrderFlowEngine,
} from '../src/utils/orderFlowEngine.ts';
import {
  analyzeMsnrFootprint,
  getPairMeta,
} from '../src/utils/tradingMath.ts';
import {
  buildOrderBookLevelsFromSides,
  syncHistoricalMarketData,
  toMexcSymbol,
} from './historicalSync.ts';

interface StreamBufferState {
  key: string;
  symbol: string;
  exchange: ExchangeType;
  interval: string;
  source: MarketStreamSnapshot['source'];
  wsConnected: boolean;
  lastPrice: number;
  cumulativeDelta: number;
  candles: Candle[];
  multiTimeframe: MultiTimeframeCandles;
  orderBook: OrderBookLevel[];
  ticks: TickTradeEvent[];
  orderFlow: OrderFlowEngine;
  l3Snapshot: OrderFlowL3Snapshot;
  analysis: FootprintSignalAnalysis;
  lastUpdatedAt: number;
}

const MAX_TICK_BUFFER = 500;
const MAX_CANDLE_BUFFER = 300;

export class MarketIngestionEngine extends EventEmitter {
  private buffers = new Map<string, StreamBufferState>();
  private activeKey = 'BINANCE:BTCUSDT:15m';
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private isDisposed = false;
  private stopLossPercent = 0.5;
  private syncPromise: Promise<MarketStreamSnapshot> | null = null;

  public getActiveKey(): string {
    return this.activeKey;
  }

  public setStopLossPercent(sl: number): void {
    this.stopLossPercent = Math.min(1.2, Math.max(0.25, sl || 0.5));
  }

  public makeKey(exchange: ExchangeType, symbol: string, interval: string): string {
    const cleanSym = symbol.toUpperCase().replace(/[^A-Z0-9]/g, '') || 'BTCUSDT';
    return `${exchange}:${cleanSym}:${interval}`;
  }

  public async initialize(
    exchange: ExchangeType = 'BINANCE',
    symbol = 'BTCUSDT',
    interval = '15m',
  ): Promise<MarketStreamSnapshot> {
    return this.switchStream(exchange, symbol, interval);
  }

  public async switchStream(
    exchange: ExchangeType,
    symbol: string,
    interval: string,
  ): Promise<MarketStreamSnapshot> {
    const cleanSym = symbol.toUpperCase().replace(/[^A-Z0-9]/g, '') || 'BTCUSDT';
    const key = this.makeKey(exchange, cleanSym, interval);
    this.activeKey = key;

    if (this.syncPromise) {
      await this.syncPromise.catch(() => null);
    }

    const syncTask = (async () => {
      const existing = this.buffers.get(key);
      const hist = await syncHistoricalMarketData(cleanSym, exchange, interval);
      if (
        existing &&
        existing.source !== 'OFFLINE_NO_DATA' &&
        hist.source === 'OFFLINE_NO_DATA' &&
        Date.now() - existing.lastUpdatedAt < 120_000
      ) {
        this.connectUpstreamWs(existing);
        const snap = this.toSnapshot(existing, 0);
        this.emit('snapshot', snap);
        return snap;
      }

      const lastCandle = hist.candles[hist.candles.length - 1];
      const meta = getPairMeta(cleanSym);
      const lastPrice = lastCandle?.close ?? 0;
      const cumulativeDelta = hist.candles
        .slice(-12)
        .reduce((acc, c) => acc + c.delta, 0);

      const recentTicks = Array.isArray(hist.recentTicks)
        ? hist.recentTicks.slice(-MAX_TICK_BUFFER)
        : [];
      const orderFlow = new OrderFlowEngine(cleanSym, exchange, meta.decimals);
      const initBids: Array<[number, number]> = hist.orderBook
        .filter((l) => l.bidSize > 0)
        .map((l) => [l.price, l.bidSize]);
      const initAsks: Array<[number, number]> = hist.orderBook
        .filter((l) => l.askSize > 0)
        .map((l) => [l.price, l.askSize]);
      if (initBids.length > 0 || initAsks.length > 0) {
        orderFlow.ingestDepthDelta({bids: initBids, asks: initAsks, isSnapshot: true});
      }
      for (const tk of recentTicks.slice(-60)) {
        orderFlow.ingestAggTrade(tk);
      }

      const l3Snapshot = buildL3SnapshotFromMarketData({
        symbol: cleanSym,
        exchange,
        candles: hist.candles,
        orderBook: hist.orderBook,
        recentTicks,
      });

      const dataAuthentic = hist.source !== 'OFFLINE_NO_DATA' && hist.candles.length >= 10;
      const analysis = analyzeMsnrFootprint(
        cleanSym,
        exchange,
        interval,
        hist.candles,
        this.stopLossPercent,
        {
          l3Snapshot,
          orderBook: hist.orderBook,
          multiTimeframe: hist.multiTimeframe,
          recentTicks,
          dataAuthentic,
        },
      );

      const state: StreamBufferState = {
        key,
        symbol: cleanSym,
        exchange,
        interval,
        source: hist.source,
        wsConnected: false,
        lastPrice,
        cumulativeDelta: Number(cumulativeDelta.toFixed(2)),
        candles: hist.candles,
        multiTimeframe: hist.multiTimeframe,
        orderBook: hist.orderBook,
        ticks: recentTicks,
        orderFlow,
        l3Snapshot,
        analysis,
        lastUpdatedAt: Date.now(),
      };

      this.buffers.set(key, state);
      this.connectUpstreamWs(state);

      const snapshot = this.toSnapshot(state, 0);
      this.emit('snapshot', snapshot);
      this.emit('analysis', {snapshot, analysis});
      this.emitFilteredIfBlocked(state);
      return snapshot;
    })();

    this.syncPromise = syncTask;
    try {
      return await syncTask;
    } finally {
      if (this.syncPromise === syncTask) {
        this.syncPromise = null;
      }
    }
  }

  public getSnapshot(
    exchange?: ExchangeType,
    symbol?: string,
    interval?: string,
  ): MarketStreamSnapshot | null {
    const key =
      exchange && symbol && interval
        ? this.makeKey(exchange, symbol, interval)
        : this.activeKey;
    const state = this.buffers.get(key);
    if (!state) return null;
    return this.toSnapshot(state, 0);
  }

  public getLatestPrices(): Record<string, number> {
    const prices: Record<string, number> = {};
    for (const buf of this.buffers.values()) {
      prices[buf.symbol] = buf.lastPrice;
    }
    return prices;
  }

  // Deterministic in-memory tick handler (usable by both live WS messages and unit tests)
  public ingestTick(tick: TickTradeEvent, targetKey = this.activeKey): MarketStreamSnapshot | null {
    const startNs = process.hrtime.bigint();
    const state = this.buffers.get(targetKey);
    if (!state) return null;

    state.ticks.push(tick);
    if (state.ticks.length > MAX_TICK_BUFFER) {
      state.ticks.shift();
    }

    // Feed live L1 aggTrade directly into Synthetic L3 Microstructure Engine
    state.orderFlow.ingestAggTrade(tick);

    state.lastPrice = tick.price;
    const signedVol = tick.side === 'BUY' ? tick.qty : -tick.qty;
    state.cumulativeDelta = Number((state.cumulativeDelta + signedVol).toFixed(2));
    state.source = state.exchange === 'MEXC' ? 'MEXC_WS' : 'BINANCE_WS';
    state.lastUpdatedAt = tick.ts;

    // Update current candle bar in-memory with zero DB blocking
    const lastBar = state.candles[state.candles.length - 1];
    if (lastBar) {
      const updatedBar: Candle = {
        ...lastBar,
        high: Math.max(lastBar.high, tick.price),
        low: Math.min(lastBar.low, tick.price),
        close: tick.price,
        volume: Number((lastBar.volume + tick.qty).toFixed(2)),
        takerBuyVolume:
          tick.side === 'BUY'
            ? Number((lastBar.takerBuyVolume + tick.qty).toFixed(2))
            : lastBar.takerBuyVolume,
        takerSellVolume:
          tick.side === 'SELL'
            ? Number((lastBar.takerSellVolume + tick.qty).toFixed(2))
            : lastBar.takerSellVolume,
        delta: Number((lastBar.delta + signedVol).toFixed(2)),
      };
      state.candles[state.candles.length - 1] = updatedBar;
    }

    state.l3Snapshot = state.orderFlow.getSnapshot(tick.ts);

    const elapsedMs = Number(process.hrtime.bigint() - startNs) / 1_000_000;
    const snapshot = this.toSnapshot(state, Number(elapsedMs.toFixed(3)));
    this.emit('tick', {tick, snapshot});
    return snapshot;
  }

  public updateDepth(
    key: string,
    bids: Array<[number, number]>,
    asks: Array<[number, number]>,
    isSnapshot = false,
  ): void {
    const state = this.buffers.get(key);
    if (!state) return;
    const meta = getPairMeta(state.symbol);

    if (bids.length > 0 || asks.length > 0) {
      state.orderBook = buildOrderBookLevelsFromSides(bids, asks, meta.decimals);
      state.l3Snapshot = state.orderFlow.ingestDepthDelta({
        bids,
        asks,
        ts: Date.now(),
        isSnapshot,
      });
    }
  }

  public applyKlineUpdate(
    key: string,
    candle: Candle,
    isClosed: boolean,
  ): MarketStreamSnapshot | null {
    const state = this.buffers.get(key);
    if (!state) return null;

    const last = state.candles[state.candles.length - 1];
    if (last && last.time === candle.time) {
      state.candles[state.candles.length - 1] = candle;
    } else {
      state.candles.push(candle);
      if (state.candles.length > MAX_CANDLE_BUFFER) {
        state.candles.shift();
      }
    }

    state.lastPrice = candle.close;
    state.lastUpdatedAt = Date.now();
    const liveL3 =
      state.ticks.length >= 4
        ? state.orderFlow.getSnapshot(state.lastUpdatedAt)
        : buildL3SnapshotFromMarketData({
            symbol: state.symbol,
            exchange: state.exchange,
            candles: state.candles,
            orderBook: state.orderBook,
            recentTicks: state.ticks,
          });
    state.l3Snapshot = liveL3;
    const dataAuthentic = state.source !== 'OFFLINE_NO_DATA' && state.candles.length >= 10;
    state.analysis = analyzeMsnrFootprint(
      state.symbol,
      state.exchange,
      state.interval,
      state.candles,
      this.stopLossPercent,
      {
        l3Snapshot: liveL3,
        orderBook: state.orderBook,
        multiTimeframe: state.multiTimeframe,
        recentTicks: state.ticks,
        dataAuthentic,
      },
    );

    const snapshot = this.toSnapshot(state, 0.25);
    if (isClosed) {
      this.emit('analysis', {snapshot, analysis: state.analysis});
      this.emitFilteredIfBlocked(state);
    } else {
      this.emit('snapshot', snapshot);
    }
    return snapshot;
  }

  public evaluateActiveAnalysis(emitEvent = true): {
    snapshot: MarketStreamSnapshot;
    analysis: FootprintSignalAnalysis;
  } | null {
    const state = this.buffers.get(this.activeKey);
    if (!state) return null;
    const liveL3 =
      state.ticks.length >= 4
        ? state.orderFlow.getSnapshot(Date.now())
        : buildL3SnapshotFromMarketData({
            symbol: state.symbol,
            exchange: state.exchange,
            candles: state.candles,
            orderBook: state.orderBook,
            recentTicks: state.ticks,
          });
    state.l3Snapshot = liveL3;
    const dataAuthentic = state.source !== 'OFFLINE_NO_DATA' && state.candles.length >= 10;
    state.analysis = analyzeMsnrFootprint(
      state.symbol,
      state.exchange,
      state.interval,
      state.candles,
      this.stopLossPercent,
      {
        l3Snapshot: liveL3,
        orderBook: state.orderBook,
        multiTimeframe: state.multiTimeframe,
        recentTicks: state.ticks,
        dataAuthentic,
      },
    );
    const snapshot = this.toSnapshot(state, 0.2);
    if (emitEvent) {
      this.emit('analysis', {snapshot, analysis: state.analysis});
      this.emitFilteredIfBlocked(state);
    }
    return {snapshot, analysis: state.analysis};
  }

  private emitFilteredIfBlocked(state: StreamBufferState): void {
    // Only emit filtered records from authentic live exchange data
    if (state.source === 'OFFLINE_NO_DATA' || state.candles.length < 10) return;
    const gate = state.analysis.confluenceGate;
    if (!gate || gate.canEmitSignal || gate.rejectionCode === 'OFFLINE_NO_DATA') return;
    const filtered: IneligibleSignal = {
      id: `flt-${state.symbol}-${gate.rejectionCode}-${Math.floor(Date.now() / 60_000)}`,
      symbol: state.symbol,
      exchange: state.exchange,
      side: state.analysis.bias,
      failedRule: gate.rejectionLabel,
      reason: state.analysis.keyReasoning,
      riskRewardRatio: state.analysis.riskRewardRatio,
      slDistancePercent: state.analysis.slDistancePercent,
      timestamp: Date.now(),
    };
    this.emit('filtered', filtered);
  }

  private toSnapshot(state: StreamBufferState, latencyMs: number): MarketStreamSnapshot {
    return {
      symbol: state.symbol,
      exchange: state.exchange,
      interval: state.interval,
      source: state.source,
      wsConnected: state.wsConnected,
      lastPrice: state.lastPrice,
      cumulativeDelta: state.cumulativeDelta,
      ticksBuffered: state.ticks.length,
      latencyMs,
      candles: state.candles,
      multiTimeframe: state.multiTimeframe,
      orderBook: state.orderBook,
      recentTicks: state.ticks.slice(-300),
      l3Snapshot: state.l3Snapshot,
      confluenceGate: state.analysis.confluenceGate,
      analysis: state.analysis,
      updatedAt: state.lastUpdatedAt,
    };
  }

  private closeUpstreamWs(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    if (this.ws) {
      const stale = this.ws;
      this.ws = null;
      try {
        stale.removeAllListeners();
        stale.on('error', () => {
          // Swallow async close-before-open error on terminated sockets
        });
        if (stale.readyState === WebSocket.OPEN) {
          stale.close();
        } else if (stale.readyState === WebSocket.CONNECTING) {
          stale.terminate();
        }
      } catch {
        // Ignore close error
      }
    }
  }

  private connectUpstreamWs(state: StreamBufferState): void {
    if (this.isDisposed) return;
    this.closeUpstreamWs();

    const lowerSym = state.symbol.toLowerCase();
    const wsUrl =
      state.exchange === 'MEXC'
        ? 'wss://contract.mexc.com/edge'
        : `wss://fstream.binance.com/stream?streams=${lowerSym}@bookTicker/${lowerSym}@aggTrade/${lowerSym}@depth20@100ms/${lowerSym}@kline_${state.interval}`;

    let socket: WebSocket;
    try {
      socket = new WebSocket(wsUrl);
    } catch {
      this.scheduleReconnect(state);
      return;
    }
    this.ws = socket;

    socket.on('open', () => {
      if (this.activeKey !== state.key) return;
      state.wsConnected = true;
      state.source = state.exchange === 'MEXC' ? 'MEXC_WS' : 'BINANCE_WS';

      if (state.exchange === 'MEXC') {
        const mexcSym = toMexcSymbol(state.symbol);
        const mexcTf =
          state.interval === '1m'
            ? 'Min1'
            : state.interval === '5m'
              ? 'Min5'
              : state.interval === '30m'
                ? 'Min30'
                : state.interval === '1h'
                  ? 'Hour1'
                  : state.interval === '4h'
                    ? 'Hour4'
                    : 'Min15';
        socket.send(JSON.stringify({method: 'sub.ticker', param: {symbol: mexcSym}}));
        socket.send(JSON.stringify({method: 'sub.deal', param: {symbol: mexcSym}}));
        socket.send(JSON.stringify({method: 'sub.depth', param: {symbol: mexcSym}}));
        socket.send(JSON.stringify({method: 'sub.kline', param: {symbol: mexcSym, interval: mexcTf}}));
        this.pingTimer = setInterval(() => {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({method: 'ping'}));
          }
        }, 15_000);
      }
      this.emit('snapshot', this.toSnapshot(state, 0));
    });

    socket.on('message', (raw) => {
      if (this.activeKey !== state.key) return;
      try {
        const msg = JSON.parse(raw.toString()) as Record<string, unknown>;
        if (state.exchange === 'BINANCE') {
          this.handleBinanceMessage(state, msg);
        } else {
          this.handleMexcMessage(state, msg);
        }
      } catch {
        // Ignore malformed tick frames
      }
    });

    socket.on('error', () => {
      state.wsConnected = false;
    });

    socket.on('close', () => {
      state.wsConnected = false;
      if (!this.isDisposed && this.activeKey === state.key) {
        this.scheduleReconnect(state);
      }
    });
  }

  private scheduleReconnect(state: StreamBufferState): void {
    if (this.isDisposed || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.isDisposed && this.activeKey === state.key) {
        this.connectUpstreamWs(state);
      }
    }, 5000);
  }

  private handleBinanceMessage(state: StreamBufferState, msg: Record<string, unknown>): void {
    const stream = String(msg.stream || '');
    const data = msg.data as Record<string, unknown> | undefined;
    if (!data) return;

    if (stream.endsWith('@bookTicker')) {
      const bestBid = Number(data.b);
      const bestBidQty = Number(data.B);
      const bestAsk = Number(data.a);
      const bestAskQty = Number(data.A);
      if (bestBid > 0 && bestAsk > 0) {
        state.orderFlow.ingestBookTicker({
          bestBid,
          bestAsk,
          bestBidQty,
          bestAskQty,
          ts: Number(data.T || Date.now()),
        });
        state.l3Snapshot = state.orderFlow.getSnapshot();
      }
      return;
    }

    if (stream.endsWith('@aggTrade')) {
      const price = Number(data.p);
      const qty = Number(data.q);
      const isBuyerMaker = Boolean(data.m);
      if (price > 0 && qty > 0) {
        this.ingestTick(
          {
            symbol: state.symbol,
            exchange: 'BINANCE',
            price,
            qty,
            side: isBuyerMaker ? 'SELL' : 'BUY',
            ts: Number(data.T || Date.now()),
          },
          state.key,
        );
      }
      return;
    }

    if (stream.includes('@depth20')) {
      const bids = ((data.b as Array<[string, string]>) || []).map(
        ([p, q]) => [Number(p), Number(q)] as [number, number],
      );
      const asks = ((data.a as Array<[string, string]>) || []).map(
        ([p, q]) => [Number(p), Number(q)] as [number, number],
      );
      this.updateDepth(state.key, bids, asks, false);
      return;
    }

    if (stream.includes('@kline_')) {
      const k = data.k as Record<string, unknown> | undefined;
      if (!k) return;
      const meta = getPairMeta(state.symbol);
      const open = Number(k.o);
      const high = Number(k.h);
      const low = Number(k.l);
      const close = Number(k.c);
      const volume = Number(k.v);
      const takerBuyVolume = Number(k.V || volume * 0.52);
      const takerSellVolume = Math.max(0, volume - takerBuyVolume);
      const delta = Number((takerBuyVolume - takerSellVolume).toFixed(2));
      const isClosed = Boolean(k.x);
      this.applyKlineUpdate(
        state.key,
        {
          time: Math.floor(Number(k.t) / 1000),
          open: Number(open.toFixed(meta.decimals)),
          high: Number(high.toFixed(meta.decimals)),
          low: Number(low.toFixed(meta.decimals)),
          close: Number(close.toFixed(meta.decimals)),
          volume: Number(volume.toFixed(2)),
          takerBuyVolume: Number(takerBuyVolume.toFixed(2)),
          takerSellVolume: Number(takerSellVolume.toFixed(2)),
          delta,
        },
        isClosed,
      );
    }
  }

  private handleMexcMessage(state: StreamBufferState, msg: Record<string, unknown>): void {
    const channel = String(msg.channel || '');
    const data = msg.data as Record<string, unknown> | Array<Record<string, unknown>> | undefined;
    if (!data) return;

    if (channel === 'push.ticker' && !Array.isArray(data)) {
      const bestBid = Number(data.bid1 || data.lastPrice || 0);
      const bestAsk = Number(data.ask1 || data.lastPrice || 0);
      if (bestBid > 0 && bestAsk > 0) {
        state.orderFlow.ingestBookTicker({
          bestBid,
          bestAsk,
          bestBidQty: Number(data.bid1Vol || 10),
          bestAskQty: Number(data.ask1Vol || 10),
          ts: Number(data.timestamp || Date.now()),
        });
        state.l3Snapshot = state.orderFlow.getSnapshot();
      }
      return;
    }

    if (channel === 'push.deal') {
      const deals = Array.isArray(data) ? data : [data];
      for (const deal of deals) {
        const price = Number(deal.p);
        const qty = Number(deal.v);
        const side = Number(deal.T) === 2 ? 'SELL' : 'BUY';
        if (price > 0 && qty > 0) {
          this.ingestTick(
            {
              symbol: state.symbol,
              exchange: 'MEXC',
              price,
              qty,
              side,
              ts: Number(deal.t || Date.now()),
            },
            state.key,
          );
        }
      }
      return;
    }

    if (channel === 'push.depth' && !Array.isArray(data)) {
      const bids = ((data.bids as Array<[number, number]>) || []).map(
        ([p, q]) => [Number(p), Number(q)] as [number, number],
      );
      const asks = ((data.asks as Array<[number, number]>) || []).map(
        ([p, q]) => [Number(p), Number(q)] as [number, number],
      );
      this.updateDepth(state.key, bids, asks);
      return;
    }

    if (channel === 'push.kline' && !Array.isArray(data)) {
      const meta = getPairMeta(state.symbol);
      const open = Number(data.o);
      const high = Number(data.h);
      const low = Number(data.l);
      const close = Number(data.c);
      const volume = Number(data.q || data.v || 0);
      const takerBuyVolume = Number((volume * (close >= open ? 0.58 : 0.42)).toFixed(2));
      const takerSellVolume = Number(Math.max(0, volume - takerBuyVolume).toFixed(2));
      this.applyKlineUpdate(
        state.key,
        {
          time: Number(data.t || Math.floor(Date.now() / 1000)),
          open: Number(open.toFixed(meta.decimals)),
          high: Number(high.toFixed(meta.decimals)),
          low: Number(low.toFixed(meta.decimals)),
          close: Number(close.toFixed(meta.decimals)),
          volume: Number(volume.toFixed(2)),
          takerBuyVolume,
          takerSellVolume,
          delta: Number((takerBuyVolume - takerSellVolume).toFixed(2)),
        },
        false,
      );
    }
  }

  public dispose(): void {
    this.isDisposed = true;
    this.closeUpstreamWs();
  }
}

export const marketIngestion = new MarketIngestionEngine();
