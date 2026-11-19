import React, {useState} from 'react';
import {Check, Copy, Send, Webhook} from 'lucide-react';
import {db} from '../services/database';
import type {BotStatus, FootprintSignalAnalysis} from '../types/trading';

interface WebhookIntegrationProps {
  username: string;
  status: BotStatus;
  selectedSymbol: string;
  analysis: FootprintSignalAnalysis | null;
}

export const WebhookIntegration: React.FC<WebhookIntegrationProps> = ({
  username,
  status,
  selectedSymbol,
  analysis,
}) => {
  const [copiedPayload, setCopiedPayload] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [isDispatching, setIsDispatching] = useState(false);
  const [dispatchStatus, setDispatchStatus] = useState<string | null>(null);

  const origin =
    typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin
      : 'https://your-deployment.vercel.app';
  const webhookUrl = `${origin}/api/webhook`;

  const payloadObj = {
    source: 'MAKKA_FOOTPRINT_BOT',
    username,
    exchange: status.activeExchange,
    symbol: selectedSymbol,
    strategy: 'MSNR_L3_AUTONOMOUS',
    side: analysis?.bias || 'LONG',
    orderType: 'MARKET',
    entryPrice: analysis?.entryPrice ?? 94060,
    stopLoss: analysis?.stopLoss ?? 93589.7,
    takeProfit: analysis?.takeProfit ?? 95000.6,
    riskRewardRatio: analysis?.riskRewardRatio ?? 2.0,
  };
  const payload = JSON.stringify(payloadObj, null, 2);

  const handleCopyPayload = () => {
    navigator.clipboard?.writeText(payload);
    setCopiedPayload(true);
    window.setTimeout(() => setCopiedPayload(false), 2000);
  };

  const handleCopyUrl = () => {
    navigator.clipboard?.writeText(webhookUrl);
    setCopiedUrl(true);
    window.setTimeout(() => setCopiedUrl(false), 2000);
  };

  const handleTriggerAutoTradeWebhook = async () => {
    setIsDispatching(true);
    setDispatchStatus(null);
    try {
      const res = await fetch('/api/webhook', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: payload,
      });
      const json = (await res.json()) as {
        ok?: boolean;
        executedCount?: number;
        results?: Array<{username: string; status: string; reason: string; mode: string}>;
        error?: string;
      };
      if (!res.ok || !json.ok) {
        setDispatchStatus(`Webhook error: ${json.error || `HTTP ${res.status}`}`);
      } else {
        const mine = json.results?.find(
          (r) => r.username.toLowerCase() === username.toLowerCase(),
        );
        if (mine) {
          setDispatchStatus(`[${mine.mode} • ${mine.status}] ${mine.reason}`);
        } else {
          setDispatchStatus(
            `Webhook dispatched: ${json.executedCount ?? 0} account(s) executed.`,
          );
        }
        await db.syncFromRtdb();
      }
    } catch (err) {
      setDispatchStatus(`Webhook dispatch failed: ${(err as Error).message}`);
    } finally {
      setIsDispatching(false);
    }
  };

  return (
    <div className="cyber-card rounded-xl overflow-hidden shadow-lg">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-cyan-500/25 bg-[#070b14] px-4 py-3">
        <div className="flex items-center gap-2">
          <Webhook className="h-4 w-4 text-cyan-400" aria-hidden="true" />
          <h3 className="text-xs font-black font-mono uppercase tracking-wider glow-heading-cyan">
            Zero-Intervention Auto-Trade Webhook Bridge
          </h3>
        </div>
        <span className="text-[10px] font-mono font-bold glow-emerald">
          POST /api/webhook • 24/7 Headless Execution
        </span>
      </div>

      <div className="p-4 space-y-3.5 font-mono text-xs">
        <p className="text-slate-300 leading-relaxed">
          Incoming MSNR &amp; TradingView signals bypass manual confirmation, decrypt stored Firebase AES-256 keys in server memory, and execute Long/Short orders automatically with instant RTDB dashboard sync.
        </p>

        {/* Live Webhook Endpoint URL */}
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-cyan-500/35 bg-[#06090f] px-3 py-2.5">
          <div className="truncate text-[11px] font-bold glow-intense-cyan">{webhookUrl}</div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCopyUrl}
              className="inline-flex items-center gap-1 rounded-lg border border-cyan-500/40 bg-cyan-500/15 px-2.5 py-1 text-[10px] font-bold text-cyan-200 hover:bg-cyan-500/25 cursor-pointer"
            >
              {copiedUrl ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
              <span>{copiedUrl ? 'URL Copied' : 'Copy URL'}</span>
            </button>
            <button
              type="button"
              onClick={handleTriggerAutoTradeWebhook}
              disabled={isDispatching}
              className="vault-btn-glow inline-flex items-center gap-1.5 rounded-lg px-3 py-1 text-[10px] font-black cursor-pointer disabled:opacity-60"
            >
              <Send className="h-3 w-3" aria-hidden="true" />
              <span>{isDispatching ? 'Executing...' : 'Trigger Auto-Trade Webhook'}</span>
            </button>
          </div>
        </div>

        {dispatchStatus && (
          <div className="rounded-lg border border-emerald-500/45 bg-emerald-950/35 px-3 py-2 text-[11px] font-bold glow-intense-emerald">
            {dispatchStatus}
          </div>
        )}

        <div className="relative rounded-xl border border-slate-800 bg-[#06090f] p-3">
          <button
            type="button"
            onClick={handleCopyPayload}
            className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-lg border border-cyan-500/40 bg-cyan-500/15 px-2.5 py-1 text-[10px] font-bold text-cyan-200 hover:bg-cyan-500/25 cursor-pointer"
          >
            {copiedPayload ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
            <span>{copiedPayload ? 'Copied' : 'Copy JSON'}</span>
          </button>
          <pre className="overflow-x-auto text-[11px] text-cyan-200 leading-relaxed pr-24">
            {payload}
          </pre>
        </div>
      </div>
    </div>
  );
};
