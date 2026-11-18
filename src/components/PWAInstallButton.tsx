import React, {useState} from 'react';
import {Download, Share, X} from 'lucide-react';
import {usePWAInstall} from '../hooks/usePWAInstall';

interface PWAInstallButtonProps {
  compact?: boolean;
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({compact = false}) => {
  const {isInstallable, isInstalled, isIOS, install} = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={install}
        className="inline-flex items-center gap-2 rounded-lg border border-[#00f0ff]/40 bg-[#00f0ff]/10 px-3 py-2 text-xs font-semibold text-[#00f0ff] transition-colors hover:bg-[#00f0ff]/20 whitespace-nowrap shrink-0 min-h-[40px] cursor-pointer"
        aria-label="Install Makka Footprint Bot App"
      >
        <Download className="h-3.5 w-3.5" aria-hidden="true" />
        <span>{compact ? 'Install' : 'Install App'}</span>
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          className="inline-flex items-center gap-2 rounded-lg border border-[#1e293b] bg-[#0d131a] px-3 py-2 text-xs font-medium text-slate-200 transition-colors hover:border-[#00f0ff]/40 hover:text-[#00f0ff] whitespace-nowrap shrink-0 min-h-[40px] cursor-pointer"
          aria-label="Install App on iOS Safari"
        >
          <Share className="h-3.5 w-3.5" aria-hidden="true" />
          <span>{compact ? 'Add App' : 'Add to Home'}</span>
        </button>

        {showIOSGuide && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ios-install-title"
          >
            <div className="w-full max-w-sm rounded-xl border border-[#1e293b] bg-[#0d131a] p-6">
              <div className="flex items-center justify-between gap-4">
                <h3 id="ios-install-title" className="text-base font-semibold glow-cyan">
                  Install on iOS Safari
                </h3>
                <button
                  type="button"
                  onClick={() => setShowIOSGuide(false)}
                  aria-label="Close iOS install instructions"
                  className="flex h-10 w-10 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-800 hover:text-slate-100 cursor-pointer"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
              <ol className="mt-4 space-y-2.5 text-sm text-slate-300">
                <li>1. Tap the Share icon in the Safari toolbar.</li>
                <li>2. Scroll down and select Add to Home Screen.</li>
                <li>3. Launch Makka Bot from your Home Screen in standalone mode.</li>
              </ol>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="mt-5 w-full rounded-lg border border-[#1e293b] bg-[#06090e] py-2.5 text-sm font-medium text-slate-200 hover:border-[#00f0ff]/40 cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};
