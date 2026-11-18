import React, {useState} from 'react';
import {Trash2, X} from 'lucide-react';

export type CleanupMode = 'UNEXECUTED_SIGNALS' | 'LOGS_ONLY' | 'ALL_HISTORY';

interface CleanupModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialMode: CleanupMode;
  openPositionsCount: number;
  closedPositionsCount: number;
  signalsCount: number;
  logsCount: number;
  onConfirmCleanup: (mode: CleanupMode) => void;
}

export const CleanupModal: React.FC<CleanupModalProps> = ({
  isOpen,
  onClose,
  initialMode,
  openPositionsCount,
  closedPositionsCount,
  signalsCount,
  logsCount,
  onConfirmCleanup,
}) => {
  const [mode, setMode] = useState<CleanupMode>(initialMode);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Terminal Cleanup"
    >
      <div className="modal-glow-box w-full max-w-md rounded-2xl overflow-hidden">
        <div className="modal-glow-header flex items-center justify-between px-5 py-3.5">
          <div className="flex items-center gap-2">
            <Trash2 className="h-4 w-4 text-amber-300" aria-hidden="true" />
            <h2 className="text-sm font-black glow-cyan">Clean Terminal Records</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close cleanup modal"
            className="rounded-lg border border-slate-700 bg-slate-900 p-1.5 text-slate-300 hover:text-white cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 space-y-3 font-mono text-xs">
          <p className="text-slate-300">
            Active Open Positions ({openPositionsCount}) are always preserved safely. Choose what to clear:
          </p>

          {[
            {
              key: 'UNEXECUTED_SIGNALS' as CleanupMode,
              title: `Clear Unexecuted Signals (${signalsCount} total)`,
            },
            {
              key: 'LOGS_ONLY' as CleanupMode,
              title: `Clear Engine Activity Stream (${logsCount} entries)`,
            },
            {
              key: 'ALL_HISTORY' as CleanupMode,
              title: `Clear Closed History (${closedPositionsCount}), Signals & Logs`,
            },
          ].map((opt) => (
            <label
              key={opt.key}
              className={`flex items-center gap-2.5 rounded-xl border p-3 cursor-pointer ${
                mode === opt.key
                  ? 'border-cyan-400 bg-cyan-500/15 text-white'
                  : 'border-slate-800 bg-[#06090f] text-slate-300'
              }`}
            >
              <input
                type="radio"
                name="cleanup-mode"
                checked={mode === opt.key}
                onChange={() => setMode(opt.key)}
              />
              <span>{opt.title}</span>
            </label>
          ))}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-700 bg-slate-900 px-3.5 py-2 text-slate-300 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                onConfirmCleanup(mode);
                onClose();
              }}
              className="rounded-lg border border-amber-400/60 bg-amber-500/20 px-4 py-2 font-bold text-amber-300 hover:bg-amber-500/30 cursor-pointer"
            >
              Confirm Cleanup
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
