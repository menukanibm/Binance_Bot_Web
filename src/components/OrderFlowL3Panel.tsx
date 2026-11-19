import React from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Layers,
  Lock,
  ShieldAlert,
  ShieldCheck,
  Waves,
  XCircle,
} from 'lucide-react';
import type {
  ConfluenceGateResult,
  OrderFlowL3Snapshot,
} from '../types/trading';
import {formatPrice, getPairMeta} from '../utils/tradingMath';

interface OrderFlowL3PanelProps {
  symbol: string;
  l3: OrderFlowL3Snapshot;
  gate: ConfluenceGateResult;
  hasVerifiedApiKey: boolean;
  stage2Symbols: string[];
}

export const OrderFlowL3Panel: React.FC<OrderFlowL3PanelProps> = ({
  symbol,
  l3,
  gate,
  hasVerifiedApiKey,
  stage2Symbols,
}) => {
  const meta = getPairMeta(symbol);
  const isBullL3 = l3.confirmationState === 'BULLISH_L3_CONFIRMED';
  const isBearL3 = l3.confirmationState === 'BEARISH_L3_CONFIRMED';
  const isStage2Locked = stage2Symbols.includes(symbol);

  const scorePct = Math.max(0, Math.min(100, Math.round((l3.queueImbalanceScore + 100) / 2)));
  const totalBook = Math.max(1, l3.l2TotalBidQty + l3.l2TotalAskQty);
  const bidBookPct = Math.round((l3.l2TotalBidQty / totalBook) * 100);

  return (
    <section
      aria-label="Level 1, Level 2 and Synthetic Level 3 Order-Flow Microstructure Engine"
      data-testid="orderflow-l3-panel"
      className="cyber-card rounded-xl p-4 space-y-4 font-mono"
    >
      {/* Header Row */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--ex-border)] pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <Layers className="h-4 w-4 text-[var(--ex-accent)] shrink-0" aria-hidden="true" />
          <h2 className="text-xs sm:text-sm font-black uppercase tracking-wider text-[var(--ex-text)]">
            L1 / L2 Depth &amp; Synthetic Level 3 Engine ({symbol})
          </h2>
          <span className="text-[11px] text-[var(--ex-muted)]">
            &middot; {isStage2Locked ? 'Stage 2 Deep Lock-On (bookTicker · depth@100ms · aggTrade)' : 'Stage 1 Telemetry'}
          </span>
        </div>

        <div className="flex items-center gap-3 text-xs">
          <span
            data-testid="l3-confirmation-state"
            className="font-black tracking-wide"
            style={{
              color: isBullL3
                ? 'var(--ex-long)'
                : isBearL3
                  ? 'var(--ex-short)'
                  : '#94A3B8',
            }}
          >
            {l3.confirmationState}
          </span>
          <span className="text-[11px] text-[var(--ex-muted)] tabular-nums">
            Score: {l3.queueImbalanceScore > 0 ? `+${l3.queueImbalanceScore}` : l3.queueImbalanceScore}
          </span>
        </div>
      </div>

      {/* 3-Tier Microstructure Grid: Level 1 | Level 2 | Synthetic Level 3 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 text-xs">
        {/* Tier 1: Level 1 (L1) Top-of-Book & AggTrade */}
        <div className="ex-surface-inset rounded-lg p-3 space-y-2.5">
          <div className="flex items-center justify-between border-b border-[var(--ex-border)] pb-1.5">
            <span className="text-[11px] font-bold text-[var(--ex-text)]">
              01. Level 1 (bookTicker &amp; aggTrade)
            </span>
            <span className="text-[10px] text-[var(--ex-muted)] tabular-nums">
              Spread {l3.l1.spreadBps.toFixed(2)} bps
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <div className="text-[10px] text-[var(--ex-muted)]">Best Bid</div>
              <div className="text-sm font-black text-[var(--ex-long)] tabular-nums">
                ${formatPrice(l3.l1.bestBid, meta.decimals)}
              </div>
              <div className="text-[10px] text-[var(--ex-muted)] tabular-nums">
                Size: {l3.l1.bestBidQty.toLocaleString('en-US', {maximumFractionDigits: 2})}
              </div>
            </div>
            <div className="text-right">
              <div className="text-[10px] text-[var(--ex-muted)]">Best Ask</div>
              <div className="text-sm font-black text-[var(--ex-short)] tabular-nums">
                ${formatPrice(l3.l1.bestAsk, meta.decimals)}
              </div>
              <div className="text-[10px] text-[var(--ex-muted)] tabular-nums">
                Size: {l3.l1.bestAskQty.toLocaleString('en-US', {maximumFractionDigits: 2})}
              </div>
            </div>
          </div>

          <div className="border-t border-[var(--ex-border)] pt-2 flex items-center justify-between text-[11px]">
            <span className="text-[var(--ex-muted)]">Taker Delta (Buy/Sell)</span>
            <span
              className="font-black tabular-nums"
              style={{color: l3.takerDelta >= 0 ? 'var(--ex-long)' : 'var(--ex-short)'}}
            >
              {l3.takerDelta >= 0 ? '+' : ''}
              {l3.takerDelta.toLocaleString('en-US', {maximumFractionDigits: 1})}
            </span>
          </div>
          <div className="flex items-center justify-between text-[10px] text-[var(--ex-muted)] tabular-nums">
            <span>Buy Vol: {l3.takerBuyVol.toLocaleString('en-US', {maximumFractionDigits: 1})}</span>
            <span>Sell Vol: {l3.takerSellVol.toLocaleString('en-US', {maximumFractionDigits: 1})}</span>
          </div>
        </div>

        {/* Tier 2: Level 2 (L2) Resting Order Book Walls */}
        <div className="ex-surface-inset rounded-lg p-3 space-y-2.5">
          <div className="flex items-center justify-between border-b border-[var(--ex-border)] pb-1.5">
            <span className="text-[11px] font-bold text-[var(--ex-text)]">
              02. Level 2 Depth (depth@100ms)
            </span>
            <span className="text-[10px] text-[var(--ex-accent)] tabular-nums">
              Bid {bidBookPct}% / Ask {100 - bidBookPct}%
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <div className="text-[10px] text-[var(--ex-muted)]">Resting Bid Wall</div>
              <div className="text-sm font-black text-[var(--ex-long)] tabular-nums">
                ${formatPrice(l3.l2BidWallPrice, meta.decimals)}
              </div>
              <div className="text-[10px] text-[var(--ex-muted)] tabular-nums">
                Wall Qty: {l3.l2BidWallQty.toLocaleString('en-US', {maximumFractionDigits: 1})}
              </div>
            </div>
            <div className="text-right">
              <div className="text-[10px] text-[var(--ex-muted)]">Resting Ask Wall</div>
              <div className="text-sm font-black text-[var(--ex-short)] tabular-nums">
                ${formatPrice(l3.l2AskWallPrice, meta.decimals)}
              </div>
              <div className="text-[10px] text-[var(--ex-muted)] tabular-nums">
                Wall Qty: {l3.l2AskWallQty.toLocaleString('en-US', {maximumFractionDigits: 1})}
              </div>
            </div>
          </div>

          <div className="space-y-1 pt-1">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--ex-bg)] flex">
              <div
                className="h-full transition-all"
                style={{width: `${bidBookPct}%`, backgroundColor: 'var(--ex-long)'}}
              />
              <div
                className="h-full transition-all"
                style={{width: `${100 - bidBookPct}%`, backgroundColor: 'var(--ex-short)'}}
              />
            </div>
            <div className="flex items-center justify-between text-[10px] text-[var(--ex-muted)] tabular-nums">
              <span>Limit Adds: +{l3.addedLimitQty.toFixed(1)}</span>
              <span>Queue Sweep: {l3.sweepLevelsCount > 0 ? `${l3.sweepLevelsCount} lvls (${l3.queueDepletionSide})` : 'Balanced'}</span>
            </div>
          </div>
        </div>

        {/* Tier 3: Synthetic Level 3 (L3) Iceberg, Spoof & Imbalance */}
        <div className="ex-surface-inset rounded-lg p-3 space-y-2.5">
          <div className="flex items-center justify-between border-b border-[var(--ex-border)] pb-1.5">
            <span className="text-[11px] font-bold text-[var(--ex-text)]">
              03. Synthetic Level 3 Reconstruction
            </span>
            <Waves className="h-3.5 w-3.5 text-[var(--ex-accent)]" aria-hidden="true" />
          </div>

          <div className="space-y-1.5 text-[11px]">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[var(--ex-muted)]">Passive Absorption / Iceberg</span>
              <span
                className="font-bold tabular-nums"
                style={{
                  color: l3.absorptionDetected
                    ? l3.absorptionSide === 'BUY'
                      ? 'var(--ex-long)'
                      : 'var(--ex-short)'
                    : 'var(--ex-muted)',
                }}
              >
                {l3.absorptionDetected
                  ? `${l3.absorptionSide} (${l3.icebergReloadCount}x @ $${formatPrice(l3.icebergPrice ?? l3.l1.midPrice, meta.decimals)})`
                  : 'None Detected'}
              </span>
            </div>

            <div className="flex items-center justify-between gap-2">
              <span className="text-[var(--ex-muted)]">Spoofing / Unfilled Cancels</span>
              <span
                className="font-bold tabular-nums"
                style={{
                  color: l3.spoofingDetected ? '#F59E0B' : 'var(--ex-long)',
                }}
              >
                {l3.spoofingDetected
                  ? `${l3.opposingSpoofSide} Spoof (-${l3.cancelledSpoofQty.toFixed(1)})`
                  : 'Clean (0 Spoof Walls)'}
              </span>
            </div>

            <div className="pt-1 space-y-1">
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-[var(--ex-muted)]">L3 Micro-Imbalance Gauge</span>
                <span className="font-bold text-[var(--ex-text)] tabular-nums">
                  {l3.queueImbalanceScore > 0 ? `+${l3.queueImbalanceScore}` : l3.queueImbalanceScore} / 100
                </span>
              </div>
              <div className="relative h-1.5 w-full rounded-full bg-[var(--ex-bg)] overflow-hidden">
                <div className="absolute left-1/2 top-0 bottom-0 w-px bg-[var(--ex-border)] z-10" />
                <div
                  className="h-full transition-all duration-300"
                  style={{
                    width: `${scorePct}%`,
                    backgroundColor:
                      l3.queueImbalanceScore >= 25
                        ? 'var(--ex-long)'
                        : l3.queueImbalanceScore <= -25
                          ? 'var(--ex-short)'
                          : 'var(--ex-accent)',
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Strict Non-Negotiable MSNR + L3 Confluence AND-Gate */}
      <div
        data-testid="strict-confluence-gate"
        className="rounded-lg border p-3 space-y-2.5"
        style={{
          borderColor: gate.canEmitSignal
            ? 'rgba(var(--ex-long-rgb), 0.45)'
            : 'rgba(245, 158, 11, 0.35)',
          backgroundColor: gate.canEmitSignal
            ? 'rgba(var(--ex-long-rgb), 0.06)'
            : 'var(--ex-surface-inset)',
        }}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs font-black text-[var(--ex-text)]">
            {gate.canEmitSignal ? (
              <ShieldCheck className="h-4 w-4 text-[var(--ex-long)] shrink-0" aria-hidden="true" />
            ) : (
              <ShieldAlert className="h-4 w-4 text-amber-400 shrink-0" aria-hidden="true" />
            )}
            <span>STRICT CONFLUENCE GATEKEEPER (MSNR &amp; L3 AND-GATE)</span>
          </div>
          <span
            data-testid="confluence-gate-verdict"
            className="text-xs font-black"
            style={{
              color: gate.canEmitSignal ? 'var(--ex-long)' : '#F59E0B',
            }}
          >
            {gate.rejectionLabel}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 text-[11px]">
          {/* Gate 1: MSNR Structural */}
          <div className="rounded-md border border-[var(--ex-border)] bg-[var(--ex-surface)] p-2.5 space-y-1">
            <div className="flex items-center justify-between font-bold">
              <span className="text-[var(--ex-text)]">Gate 1: HTF MSNR + LTF Trigger</span>
              {gate.msnrValid ? (
                <span className="inline-flex items-center gap-1 text-[var(--ex-long)]">
                  <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>PASS</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-[var(--ex-short)]">
                  <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>BLOCKED</span>
                </span>
              )}
            </div>
            <div className="text-[10px] text-[var(--ex-muted)]">
              HTF Storyline: {gate.msnrDetails.htfStorylineValid ? 'OK' : 'Fail'} &middot; Fresh Tap: {gate.msnrDetails.freshLevelTapped ? 'OK' : 'None'} &middot; LTF Trigger: {gate.msnrDetails.ltfReactionConfirmed ? 'OK' : 'Wait'}
            </div>
          </div>

          {/* Gate 2: Real-Time Order-Flow & Synthetic L3 */}
          <div className="rounded-md border border-[var(--ex-border)] bg-[var(--ex-surface)] p-2.5 space-y-1">
            <div className="flex items-center justify-between font-bold">
              <span className="text-[var(--ex-text)]">Gate 2: Order-Flow &amp; L3</span>
              {gate.l3Confirmed ? (
                <span className="inline-flex items-center gap-1 text-[var(--ex-long)]">
                  <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>CONFIRMED</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-amber-400">
                  <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>WAIT L3</span>
                </span>
              )}
            </div>
            <div className="text-[10px] text-[var(--ex-muted)]">
              Iceberg:{' '}
              {gate.l3Details.absorptionAligned
                ? 'Aligned'
                : l3.absorptionDetected
                  ? `Opposing (${l3.absorptionSide})`
                  : 'Pending'}{' '}
              &middot; Spoof: {gate.l3Details.noOpposingSpoof ? 'Clear' : 'Blocked'} &middot; 300% Imb:{' '}
              {gate.l3Details.footprintImbalanceAligned ? 'Aligned' : 'None'}
            </div>
          </div>

          {/* Gate 3: Risk Guard & API Key Authorization */}
          <div className="rounded-md border border-[var(--ex-border)] bg-[var(--ex-surface)] p-2.5 space-y-1">
            <div className="flex items-center justify-between font-bold">
              <span className="text-[var(--ex-text)]">Gate 3: Risk &amp; API Vault</span>
              {hasVerifiedApiKey ? (
                <span className="inline-flex items-center gap-1 text-[var(--ex-long)]">
                  <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>ARMED</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-[var(--ex-muted)]">
                  <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>LOCKED</span>
                </span>
              )}
            </div>
            <div className="text-[10px] text-[var(--ex-muted)]">
              {gate.riskDetails
                ? `SL ${gate.riskDetails.slPercent.toFixed(2)}% (${gate.riskDetails.slGuardValid ? 'OK' : 'Out'}) · 1:${gate.riskDetails.riskRewardRatio.toFixed(2)} R:R`
                : hasVerifiedApiKey
                  ? 'Auto-execution permitted only when all 4 pillars pass'
                  : 'Read-only telemetry · Configure key in API & Settings'}
            </div>
          </div>
        </div>

        {/* 9-Point Institutional All-or-Nothing Checklist */}
        {Array.isArray(gate.checks) && gate.checks.length > 0 && (
          <div
            data-testid="institutional-checks-grid"
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5 pt-1 border-t border-[var(--ex-border)]"
          >
            {gate.checks.map((chk) => (
              <div
                key={chk.id}
                className={`rounded-md border px-2.5 py-1.5 flex items-start justify-between gap-2 text-[10px] ${
                  chk.passed
                    ? 'border-[rgba(var(--ex-long-rgb),0.3)] bg-[rgba(var(--ex-long-rgb),0.06)]'
                    : 'border-[var(--ex-border)] bg-[var(--ex-surface)]'
                }`}
              >
                <div className="min-w-0">
                  <div className="font-bold text-[var(--ex-text)] truncate">{chk.label}</div>
                  <div className="text-[9px] text-[var(--ex-muted)] truncate">{chk.detail}</div>
                </div>
                <span
                  className={`shrink-0 font-black ${
                    chk.passed ? 'text-[var(--ex-long)]' : 'text-amber-400'
                  }`}
                >
                  {chk.passed ? 'PASS' : 'HOLD'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Synthetic L3 Microstructure Tape */}
      {l3.recentEvents.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase text-[var(--ex-muted)]">
            <Activity className="h-3 w-3 text-[var(--ex-accent)]" aria-hidden="true" />
            <span>Recent Synthetic L3 Order-Flow Events</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5 text-[11px]">
            {l3.recentEvents.slice(0, 4).map((ev) => (
              <div
                key={ev.id}
                className="ex-surface-inset rounded-md px-2.5 py-1.5 flex items-center justify-between gap-2"
              >
                <span className="truncate text-[var(--ex-text)]">
                  <span
                    className="font-bold mr-1.5"
                    style={{
                      color:
                        ev.type === 'ICEBERG_ABSORPTION'
                          ? 'var(--ex-long)'
                          : ev.type === 'SPOOF_CANCEL'
                            ? '#F59E0B'
                            : 'var(--ex-accent)',
                    }}
                  >
                    [{ev.type.replace('_', ' ')}]
                  </span>
                  {ev.description}
                </span>
                <span className="text-[10px] text-[var(--ex-muted)] tabular-nums shrink-0">
                  {ev.confidence}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
};
