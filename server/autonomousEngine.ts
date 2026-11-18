import {EventEmitter} from 'node:events';
import type {
  FirebaseActivePositionsNode,
  FootprintSignalAnalysis,
  MarketStreamSnapshot,
  Position,
} from '../src/types/trading.ts';
import {encodeUsernameKey} from '../src/services/firebaseRtdb.ts';
import {calculateUnrealizedPnL, clampStopLossPercent} from '../src/utils/tradingMath.ts';
import type {MarketIngestionEngine} from './marketIngestion.ts';
import {
  getServerRtdbUrl,
  handleWebhookDispatch,
  type WebhookDispatchResult,
} from './webhookEngine.ts';

export class AutonomousExecutionEngine extends EventEmitter {
  private ingestion: MarketIngestionEngine;
  private isStarted = false;
  private isExecuting = false;
  private lastSignalKey = '';
  private lastSignalTs = 0;
  private lastPnlSyncTs = 0;
  private onAnalysisBound: (payload: {
    snapshot: MarketStreamSnapshot;
    analysis: FootprintSignalAnalysis;
  }) => void;
  private onTickBound: (payload: {snapshot: MarketStreamSnapshot}) => void;

  constructor(ingestion: MarketIngestionEngine) {
    super();
    this.ingestion = ingestion;
    this.onAnalysisBound = (payload) => {
      void this.handleAnalysisEvent(payload.snapshot, payload.analysis);
    };
    this.onTickBound = (payload) => {
      void this.syncLiveMarkPnl(payload.snapshot);
    };
  }

  public start(): void {
    if (this.isStarted) return;
    this.isStarted = true;
    this.ingestion.on('analysis', this.onAnalysisBound);
    this.ingestion.on('tick', this.onTickBound);
  }

  public stop(): void {
    if (!this.isStarted) return;
    this.isStarted = false;
    this.ingestion.off('analysis', this.onAnalysisBound);
    this.ingestion.off('tick', this.onTickBound);
  }

  public async evaluateAndExecute(params?: {
    targetUsername?: string;
    forceDispatch?: boolean;
    slPercentOverride?: number;
  }): Promise<{
    evaluated: boolean;
    approved: boolean;
    dispatch: WebhookDispatchResult | null;
    snapshot: MarketStreamSnapshot | null;
  }> {
    const evalRes = this.ingestion.evaluateActiveAnalysis(false);
    if (!evalRes) {
      return {evaluated: false, approved: false, dispatch: null, snapshot: null};
    }

    const {snapshot, analysis} = evalRes;
    const isSetupReady =
      Boolean(params?.forceDispatch) ||
      (analysis.approved && analysis.riskRewardRatio >= 2.0);

    if (!isSetupReady) {
      return {evaluated: true, approved: false, dispatch: null, snapshot};
    }

    const slPct = clampStopLossPercent(
      params?.slPercentOverride ??
        analysis.signal?.slDistancePercent ??
        (Math.abs(analysis.entryPrice - analysis.stopLoss) / Math.max(1, analysis.entryPrice)) *
          100,
    );
    const slFrac = slPct / 100;
    const adjustedStopLoss =
      analysis.bias === 'LONG'
        ? analysis.entryPrice * (1 - slFrac)
        : analysis.entryPrice * (1 + slFrac);

    this.isExecuting = true;
    try {
      const dispatch = await handleWebhookDispatch({
        source: 'MAKKA_AUTONOMOUS_WS_ENGINE',
        username: params?.targetUsername,
        exchange: snapshot.exchange,
        symbol: snapshot.symbol,
        timeframe: snapshot.interval,
        side: analysis.bias,
        orderType: 'MARKET',
        entryPrice: snapshot.lastPrice || analysis.entryPrice,
        stopLoss: adjustedStopLoss,
        riskRewardRatio: Math.max(2.0, analysis.riskRewardRatio),
        reasoning:
          analysis.keyReasoning ||
          `Autonomous WS+MSNR ${analysis.bias} ${snapshot.symbol} (${slPct.toFixed(2)}% SL / 1:${analysis.riskRewardRatio.toFixed(1)} R:R)`,
      });

      this.emit('execution', dispatch);
      return {evaluated: true, approved: true, dispatch, snapshot};
    } finally {
      this.isExecuting = false;
    }
  }

  private async handleAnalysisEvent(
    snapshot: MarketStreamSnapshot,
    analysis: FootprintSignalAnalysis,
  ): Promise<void> {
    if (!analysis.approved || analysis.riskRewardRatio < 2.0) return;

    const latestBarTime = snapshot.candles[snapshot.candles.length - 1]?.time ?? 0;
    const dedupKey = `${snapshot.exchange}:${snapshot.symbol}:${snapshot.interval}:${analysis.bias}:${latestBarTime}`;
    const now = Date.now();
    if (dedupKey === this.lastSignalKey && now - this.lastSignalTs < 60_000) {
      return;
    }
    if (this.isExecuting) return;

    this.lastSignalKey = dedupKey;
    this.lastSignalTs = now;
    try {
      await this.evaluateAndExecute();
    } catch {
      // Non-blocking autonomous execution guard
    }
  }

  private async syncLiveMarkPnl(snapshot: MarketStreamSnapshot): Promise<void> {
    const now = Date.now();
    if (now - this.lastPnlSyncTs < 2500) return;
    this.lastPnlSyncTs = now;

    try {
      const rtdbUrl = getServerRtdbUrl();
      const res = await fetch(`${rtdbUrl}/active_positions.json`, {
        signal: AbortSignal.timeout(3500),
      });
      if (!res.ok) return;
      const allActive = (await res.json()) as Record<
        string,
        Partial<FirebaseActivePositionsNode>
      > | null;
      if (!allActive) return;

      for (const [userKey, node] of Object.entries(allActive)) {
        if (!node || !Array.isArray(node.openPositions) || node.openPositions.length === 0) {
          continue;
        }
        let changed = false;
        const updatedPositions: Position[] = node.openPositions.map((pos) => {
          if (pos.symbol !== snapshot.symbol) return pos;
          const {pnlUsd, roePct} = calculateUnrealizedPnL(pos, snapshot.lastPrice);
          changed = true;
          return {
            ...pos,
            markPrice: snapshot.lastPrice,
            unrealizedPnl: pnlUsd,
            roePercent: roePct,
          };
        });
        if (!changed) continue;

        const totalUnrealizedPnl = Number(
          updatedPositions.reduce((s, p) => s + (p.unrealizedPnl || 0), 0).toFixed(2),
        );
        await fetch(`${rtdbUrl}/active_positions/${encodeUsernameKey(userKey)}.json`, {
          method: 'PATCH',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({
            openPositions: updatedPositions,
            totalUnrealizedPnl,
            updatedAt: now,
          }),
          signal: AbortSignal.timeout(3500),
        }).catch(() => null);
      }
    } catch {
      // Non-blocking live PnL sync
    }
  }
}
