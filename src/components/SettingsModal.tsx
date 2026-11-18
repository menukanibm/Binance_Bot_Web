import React, {useEffect, useState} from 'react';
import {
  CheckCircle2,
  KeyRound,
  Lock,
  RefreshCw,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import {db} from '../services/database';
import type {ApiKeyRecord, BotSettings, BotStatus} from '../types/trading';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  username: string;
  settings: BotSettings;
  status: BotStatus;
  apiKeys: ApiKeyRecord[];
  onSaveSettings: (partial: Partial<BotSettings>) => void;
  onSaveApiKey: (record: ApiKeyRecord) => void;
  onRemoveApiKey: (id: string) => void;
  onOpenDiagnostic: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  username,
  settings,
  apiKeys,
  onSaveSettings,
  onRemoveApiKey,
  onOpenDiagnostic,
}) => {
  const [venue, setVenue] = useState<ApiKeyRecord['venue']>('Binance Futures');
  const [label, setLabel] = useState('Primary Execution Key');
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [apiSecretInput, setApiSecretInput] = useState('');
  const [vaultFeedback, setVaultFeedback] = useState<string | null>(null);
  const [vaultError, setVaultError] = useState<string | null>(null);
  const [isCheckingVault, setIsCheckingVault] = useState(false);
  const [isSavingVault, setIsSavingVault] = useState(false);
  const [isEditingKeys, setIsEditingKeys] = useState(false);

  // Check Firebase RTDB /users/{username}/exchangeKeys on mount and modal open
  useEffect(() => {
    if (!username) return;
    let active = true;
    setIsCheckingVault(true);
    void db
      .syncExchangeKeysFromRtdb(username)
      .then((keys) => {
        if (!active) return;
        setIsEditingKeys(keys.length === 0);
      })
      .finally(() => {
        if (active) setIsCheckingVault(false);
      });
    return () => {
      active = false;
    };
  }, [username, isOpen]);

  // Keep form visibility synchronized when keys are added/removed
  useEffect(() => {
    if (apiKeys.length === 0 && !isCheckingVault) {
      setIsEditingKeys(true);
    }
  }, [apiKeys.length, isCheckingVault]);

  if (!isOpen) return null;

  const hasSavedKeys = apiKeys.length > 0;
  const showSuccessCard = hasSavedKeys && !isEditingKeys;

  const handleSaveVaultKey = async (e: React.FormEvent) => {
    e.preventDefault();
    setVaultError(null);
    setVaultFeedback(null);

    if (!apiKeyInput.trim() || !apiSecretInput.trim()) {
      setVaultError('Enter both Exchange API Key and API Secret before encrypting.');
      return;
    }

    setIsSavingVault(true);
    const result = await db.saveExchangeKeyViaBackend({
      username,
      venue,
      label: label.trim() || venue,
      apiKey: apiKeyInput.trim(),
      apiSecret: apiSecretInput.trim(),
    });
    setIsSavingVault(false);

    if (!result.ok) {
      setVaultError(result.error || 'Failed to store encrypted API credentials.');
      return;
    }

    setApiKeyInput('');
    setApiSecretInput('');
    setIsEditingKeys(false);
    setVaultFeedback(`Encrypted ${venue} credentials stored in Firebase AES-256-GCM Vault.`);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4"
      role="dialog"
      aria-modal="true"
      aria-label="API Management and Risk Settings"
    >
      <div className="vault-modal-box w-full max-w-2xl rounded-2xl overflow-hidden max-h-[90vh] flex flex-col">
        <div className="modal-glow-header flex items-center justify-between px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <KeyRound
              className="h-4.5 w-4.5 text-cyan-300 drop-shadow-[0_0_8px_rgba(0,240,255,0.9)]"
              aria-hidden="true"
            />
            <h2 className="text-sm sm:text-base font-black tracking-wide glow-intense-cyan">
              API Vault &amp; Risk Configuration
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close settings modal"
            className="vault-input-glow rounded-lg p-1.5 text-cyan-200 hover:text-white cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-5 font-mono text-xs">
          {/* Trading Risk & Margin Defaults */}
          <div className="vault-section-card grid grid-cols-2 sm:grid-cols-4 gap-3 rounded-xl p-4">
            <label className="space-y-1.5">
              <span className="block text-[10px] font-bold uppercase tracking-wider glow-intense-cyan">
                Leverage
              </span>
              <input
                type="number"
                min={1}
                max={100}
                value={settings.leverage}
                onChange={(e) =>
                  onSaveSettings({leverage: Math.max(1, Number(e.target.value) || 10)})
                }
                className="vault-input-glow w-full rounded-lg px-2.5 py-1.5 font-black glow-intense-cyan"
              />
            </label>
            <label className="space-y-1.5">
              <span className="block text-[10px] font-bold uppercase tracking-wider glow-intense-cyan">
                Risk %
              </span>
              <input
                type="number"
                min={0.5}
                max={5}
                step={0.5}
                value={settings.riskPercentage}
                onChange={(e) =>
                  onSaveSettings({riskPercentage: Number(e.target.value) || 2})
                }
                className="vault-input-glow w-full rounded-lg px-2.5 py-1.5 font-black glow-intense-cyan"
              />
            </label>
            <label className="space-y-1.5">
              <span className="block text-[10px] font-bold uppercase tracking-wider glow-intense-cyan">
                Min R:R Target
              </span>
              <input
                type="number"
                min={1.5}
                max={5}
                step={0.1}
                value={settings.minRiskReward}
                onChange={(e) =>
                  onSaveSettings({minRiskReward: Number(e.target.value) || 2})
                }
                className="vault-input-glow w-full rounded-lg px-2.5 py-1.5 font-black glow-intense-emerald"
              />
            </label>
            <label className="space-y-1.5">
              <span className="block text-[10px] font-bold uppercase tracking-wider glow-intense-cyan">
                Margin Mode
              </span>
              <select
                value={settings.marginMode}
                onChange={(e) =>
                  onSaveSettings({marginMode: e.target.value as 'ISOLATED' | 'CROSS'})
                }
                className="vault-input-glow w-full rounded-lg px-2.5 py-1.5 font-black glow-intense-cyan cursor-pointer"
              >
                <option value="ISOLATED">ISOLATED</option>
                <option value="CROSS">CROSS</option>
              </select>
            </label>
          </div>

          {/* Persistent "Save Once and Forget" Encrypted API Key Vault */}
          <div className="vault-section-card rounded-xl p-4 space-y-3.5">
            <div className="flex items-center justify-between border-b border-cyan-500/25 pb-2.5">
              <div className="flex items-center gap-2 font-black tracking-wide glow-intense-emerald">
                <Lock
                  className="h-4 w-4 drop-shadow-[0_0_8px_rgba(16,185,129,0.85)]"
                  aria-hidden="true"
                />
                <span>Encrypted Exchange API Key Vault (AES-256-GCM)</span>
              </div>
              {isCheckingVault && (
                <span className="inline-flex items-center gap-1 text-[10px] text-cyan-300">
                  <RefreshCw className="h-3 w-3 animate-spin" aria-hidden="true" />
                  Checking Vault...
                </span>
              )}
            </div>

            {showSuccessCard ? (
              <div className="space-y-4">
                {/* Glowing Neon Green Keys Active Card */}
                <div
                  data-testid="vault-keys-active-card"
                  className="rounded-xl border border-emerald-400/70 bg-emerald-950/35 p-4 shadow-[0_0_24px_rgba(16,185,129,0.35),inset_0_0_16px_rgba(16,185,129,0.14)] space-y-3"
                >
                  <div className="flex items-start gap-3">
                    <CheckCircle2
                      className="h-5 w-5 text-emerald-300 shrink-0 mt-0.5 drop-shadow-[0_0_8px_rgba(16,185,129,0.9)]"
                      aria-hidden="true"
                    />
                    <div className="space-y-1.5">
                      <h3 className="text-sm font-black glow-intense-emerald">
                        API Keys configured and secured. Auto-Trading is Active.
                      </h3>
                      <p className="text-[11px] leading-relaxed text-emerald-100/90">
                        Your keys are AES-256 encrypted in Firebase. You do not need to keep the web app or desktop EXE open — our backend server continuously uses these stored keys for 100% automated trading.
                      </p>
                    </div>
                  </div>

                  {/* Masked Key Badges */}
                  <div className="space-y-1.5 pt-1">
                    {apiKeys.map((k) => (
                      <div
                        key={k.id}
                        className="flex items-center justify-between rounded-lg border border-emerald-500/35 bg-[#060d14]/90 px-3 py-2"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-black glow-intense-cyan">{k.venue}</span>
                          <span className="text-emerald-200/90">{k.maskedKey}</span>
                          <span className="rounded px-1.5 py-0.5 text-[9px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                            AES-256 CLOUD SYNCED
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            void db.removeExchangeKeyViaBackend(username, k.id);
                            onRemoveApiKey(k.id);
                          }}
                          className="text-slate-400 hover:text-rose-400 cursor-pointer"
                          aria-label={`Remove ${k.venue} key`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                {vaultFeedback && <p className="font-bold glow-intense-emerald">{vaultFeedback}</p>}

                <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setVaultFeedback(null);
                      setVaultError(null);
                      setIsEditingKeys(true);
                    }}
                    className="rounded-lg border border-cyan-500/45 bg-cyan-500/10 hover:bg-cyan-500/20 px-3.5 py-1.5 text-[11px] font-bold text-cyan-200 transition cursor-pointer"
                  >
                    Update API Keys
                  </button>
                  <button
                    type="button"
                    onClick={onOpenDiagnostic}
                    className="font-bold glow-intense-cyan hover:underline cursor-pointer"
                  >
                    Run Diagnostic Check &rarr;
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleSaveVaultKey} className="space-y-3.5">
                <p className="text-[11px] text-cyan-100/80 leading-relaxed">
                  Save your exchange keys once. They are encrypted with AES-256-GCM and stored in Firebase so automated webhook &amp; MSNR trades execute 24/7 even when this browser or EXE is closed.
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="space-y-1">
                    <span className="block text-[10px] font-bold uppercase tracking-wider glow-intense-cyan">
                      Exchange Venue
                    </span>
                    <select
                      value={venue}
                      onChange={(e) => setVenue(e.target.value as ApiKeyRecord['venue'])}
                      className="vault-input-glow w-full rounded-lg px-3 py-2 font-bold glow-intense-cyan cursor-pointer"
                    >
                      <option value="Binance Futures">Binance Futures</option>
                      <option value="MEXC Futures">MEXC Futures</option>
                      <option value="Coinglass OrderFlow">Coinglass OrderFlow</option>
                      <option value="MetaTrader 5 Bridge">MetaTrader 5 Bridge</option>
                    </select>
                  </label>

                  <label className="space-y-1">
                    <span className="block text-[10px] font-bold uppercase tracking-wider glow-intense-cyan">
                      Key Label
                    </span>
                    <input
                      type="text"
                      value={label}
                      onChange={(e) => setLabel(e.target.value)}
                      placeholder="Key Label"
                      className="vault-input-glow w-full rounded-lg px-3 py-2 font-bold text-cyan-100 placeholder:text-slate-500"
                    />
                  </label>

                  <label className="space-y-1">
                    <span className="block text-[10px] font-bold uppercase tracking-wider glow-intense-cyan">
                      Exchange API Key
                    </span>
                    <input
                      type="text"
                      value={apiKeyInput}
                      onChange={(e) => setApiKeyInput(e.target.value)}
                      placeholder="Paste Exchange API Key"
                      className="vault-input-glow w-full rounded-lg px-3 py-2 font-bold text-cyan-100 placeholder:text-slate-500"
                    />
                  </label>

                  <label className="space-y-1">
                    <span className="block text-[10px] font-bold uppercase tracking-wider glow-intense-cyan">
                      API Secret
                    </span>
                    <input
                      type="password"
                      value={apiSecretInput}
                      onChange={(e) => setApiSecretInput(e.target.value)}
                      placeholder="Paste API Secret"
                      className="vault-input-glow w-full rounded-lg px-3 py-2 font-bold text-cyan-100 placeholder:text-slate-500"
                    />
                  </label>
                </div>

                {vaultError && <p className="font-bold glow-rose">{vaultError}</p>}
                {vaultFeedback && <p className="font-bold glow-intense-emerald">{vaultFeedback}</p>}

                <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                  <div className="flex items-center gap-2">
                    <button
                      type="submit"
                      disabled={isSavingVault}
                      className="vault-btn-glow inline-flex items-center gap-1.5 rounded-lg px-4 py-2 font-black cursor-pointer disabled:opacity-60"
                    >
                      <ShieldCheck className="h-4 w-4 text-cyan-200" aria-hidden="true" />
                      <span>{isSavingVault ? 'Encrypting...' : 'Encrypt & Store Key'}</span>
                    </button>
                    {hasSavedKeys && (
                      <button
                        type="button"
                        onClick={() => setIsEditingKeys(false)}
                        className="rounded-lg border border-slate-700 bg-slate-800/80 px-3 py-2 text-[11px] font-bold text-slate-300 hover:text-white cursor-pointer"
                      >
                        Cancel
                      </button>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={onOpenDiagnostic}
                    className="font-bold glow-intense-cyan hover:underline cursor-pointer"
                  >
                    Run Diagnostic Check &rarr;
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
