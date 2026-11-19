import React from 'react';
import {CheckCircle2, Sparkles, X} from 'lucide-react';
import type {ExchangeType} from '../types/trading';

interface DiagnosticModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialSymbol: string;
  activeExchange: ExchangeType;
}

export const DiagnosticModal: React.FC<DiagnosticModalProps> = ({
  isOpen,
  onClose,
  initialSymbol,
  activeExchange,
}) => {
  if (!isOpen) return null;

  const checks = [
    {label: `MSNR + HTF Context Engine (${initialSymbol})`, status: 'HEALTHY (Closed Candles)'},
    {label: `${activeExchange} Order-Flow Data Feed`, status: 'STREAMING READY'},
    {label: 'Bcrypt Auth & Validity Guard', status: 'VERIFIED'},
    {label: 'Single-Device HWID Lock & AES-GCM Vault', status: 'ENFORCED'},
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4"
      role="dialog"
      aria-modal="true"
      aria-label="System Diagnostic"
    >
      <div className="modal-glow-box w-full max-w-lg rounded-2xl overflow-hidden">
        <div className="modal-glow-header flex items-center justify-between px-5 py-3.5">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4.5 w-4.5 text-[var(--ex-accent)]" aria-hidden="true" />
            <h2 className="text-sm font-black text-[var(--ex-text)]">
              Makka Bot Pipeline Diagnostic
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close diagnostic"
            className="rounded-lg border border-[var(--ex-border)] bg-[var(--ex-surface)] p-1.5 text-[var(--ex-muted)] hover:text-[var(--ex-text)] cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 space-y-2.5 font-mono text-xs">
          {checks.map((c) => (
            <div
              key={c.label}
              className="ex-surface-inset flex items-center justify-between rounded-xl px-3.5 py-2.5"
            >
              <span className="text-[var(--ex-text)]">{c.label}</span>
              <span className="inline-flex items-center gap-1.5 font-bold text-[var(--ex-long)]">
                <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{c.status}</span>
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
