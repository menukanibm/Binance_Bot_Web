import React, {useEffect, useMemo, useRef, useState} from 'react';
import {
  CheckCircle2,
  KeyRound,
  Lock,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react';
import {db} from '../services/database';
import type {
  ApiKeyRecord,
  BotSettings,
  BotStatus,
  ExchangeType,
  ExchangeWalletBalance,
} from '../types/trading';
import {
  filterApiKeysForExchange,
  getExchangeThemeMeta,
  getExchangeVaultVenue,
} from '../utils/exchangeTheme';
import {ExchangeBrandLogo} from './ExchangeLogos';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  username: string;
  activeExchange: ExchangeType;
  settings: BotSettings;
  status: BotStatus;
  apiKeys: ApiKeyRecord[];
  onSaveSettings: (partial: Partial<BotSettings>) => void;
  onSaveApiKey: (record: ApiKeyRecord) => void;
  onRemoveApiKey: (id: string) => void;
  onWalletSynced?: (wallet: ExchangeWalletBalance) => void;
  onOpenDiagnostic: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  username,
  activeExchange,
  settings,
  apiKeys,
  onSaveSettings,
  onRemoveApiKey,
  onWalletSynced,
  onOpenDiagnostic,
}) => {
  const boundVenue = getExchangeVaultVenue(activeExchange);
  const themeMeta = getExchangeThemeMeta(activeExchange);
  const exchangeApiKeys = useMemo(
    () => filterApiKeysForExchange(apiKeys, activeExchange),
    [apiKeys, activeExchange],
  );

  const [label, setLabel] = useState(`${boundVenue} Primary Key`);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [apiSecretInput, setApiSecretInput] = useState('');
  const [vaultFeedback, setVaultFeedback] = useState<string | null>(null);
  const [vaultError, setVaultError] = useState<string | null>(null);
  const [isCheckingVault, setIsCheckingVault] = useState(false);
  const [isSavingVault, setIsSavingVault] = useState(false);
  const [isEditingKeys, setIsEditingKeys] = useState(false);
  const onWalletSyncedRef = useRef(onWalletSynced);

  useEffect(() => {
    onWalletSyncedRef.current = onWalletSynced;
  }, [onWalletSynced]);

  // Sync default key label when active login exchange changes
  useEffect(() => {
    setLabel(`${boundVenue} Primary Key`);
  }, [boundVenue]);

  // Check Firebase RTDB /users/{username}/exchangeKeys once on modal open
  useEffect(() => {
    if (!username || !isOpen) return;
    let active = true;
    setIsCheckingVault(true);
    void db
      .syncExchangeKeysFromRtdb(username)
      .then((keys) => {
        if (!active) return;
        const matching = filterApiKeysForExchange(keys, activeExchange);
        setIsEditingKeys(matching.length === 0);
        if (matching.length > 0) {
          void db.syncLiveWalletFromBackend(username, activeExchange).then((wallet) => {
            if (active && onWalletSyncedRef.current) onWalletSyncedRef.current(wallet);
          });
        }
      })
      .finally(() => {
        if (active) setIsCheckingVault(false);
      });
    return () => {
      active = false;
    };
  }, [username, isOpen, activeExchange]);

  // Keep form visibility synchronized when keys are added/removed
  useEffect(() => {
    if (exchangeApiKeys.length === 0 && !isCheckingVault) {
      setIsEditingKeys(true);
    }
  }, [exchangeApiKeys.length, isCheckingVault]);

  if (!isOpen) return null;

  const hasSavedKeys = exchangeApiKeys.length > 0;
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
      venue: boundVenue,
      label: label.trim() || boundVenue,
      apiKey: apiKeyInput.trim(),
      apiSecret: apiSecretInput.trim(),
    });
    setIsSavingVault(false);

    if (!result.ok) {
      setVaultError(result.error || 'Failed to store encrypted API credentials.');
      return;
    }

    if (result.wallet && onWalletSynced) {
      onWalletSynced(result.wallet);
    }

    setApiKeyInput('');
    setApiSecretInput('');
    setIsEditingKeys(false);
    setVaultFeedback(
      result.wallet?.connected && result.wallet?.ok
        ? `Encrypted ${boundVenue} credentials stored & live balance synced ($${result.wallet.totalWalletBalance.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})} USDT).`
        : `Encrypted ${boundVenue} credentials stored in Firebase AES-256-GCM Vault.`,
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-label="API Vault and Risk Configuration"
    >
      <div
        data-testid="api-vault-modal"
        className="w-full max-w-2xl rounded-2xl bg-[#0F172A] border border-[#334155] shadow-[0_24px_64px_rgba(0,0,0,0.7)] overflow-hidden max-h-[90vh] flex flex-col"
        style={{borderTop: `3px solid ${themeMeta.primaryAccent}`}}
      >
        {/* Modal Header (Neutral Slate Base + Bound Venue Status) */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 bg-[#0B1220] border-b border-[#334155]">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#1E293B] border border-[#334155]">
              <KeyRound className="h-4.5 w-4.5 text-[#F8FAFC]" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-bold tracking-tight text-[#F8FAFC]">
                API Vault &amp; Risk Configuration
              </h2>
              <div
                data-testid="vault-connected-venue"
                className="mt-0.5 flex items-center gap-1.5 text-xs font-mono text-[#94A3B8]"
              >
                <ExchangeBrandLogo exchange={activeExchange} className="h-3.5 w-3.5 shrink-0" />
                <span>Connected Venue:</span>
                <span className="font-bold" style={{color: themeMeta.primaryAccent}}>
                  {boundVenue}
                </span>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close settings modal"
            className="rounded-lg border border-[#334155] bg-[#1E293B] p-2 text-[#818CF8] hover:bg-[#818CF8]/15 hover:border-[#818CF8]/50 hover:text-[#F8FAFC] transition cursor-pointer"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto space-y-5">
          {/* SECTION 1: AMBER / GOLD ACCENT (#F59E0B) — RISK CONFIGURATION */}
          <section
            aria-label="Risk Configuration"
            className="rounded-xl bg-[#1E293B] border border-[#334155] p-5 space-y-4"
          >
            <div className="flex items-center justify-between gap-2 pb-3 border-b border-[#334155]">
              <div className="flex items-center gap-2">
                <SlidersHorizontal className="h-4 w-4 text-[#F59E0B]" aria-hidden="true" />
                <h3 className="text-sm font-bold text-[#F59E0B]">
                  Risk Configuration
                </h3>
              </div>
              <span className="text-xs font-mono text-[#94A3B8]">
                Position sizing &amp; margin guardrails
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 font-mono">
              <label className="space-y-1.5">
                <span className="block text-xs font-medium text-[#94A3B8]">
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
                  className="w-full h-[42px] rounded-[8px] bg-[#0B1220] border border-[#334155] px-3 text-sm font-semibold text-[#F8FAFC] tabular-nums focus:outline-none focus:border-[#F59E0B] focus:ring-2 focus:ring-[#F59E0B]/25 transition"
                />
              </label>

              <label className="space-y-1.5">
                <span className="block text-xs font-medium text-[#94A3B8]">
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
                  className="w-full h-[42px] rounded-[8px] bg-[#0B1220] border border-[#334155] px-3 text-sm font-semibold text-[#F8FAFC] tabular-nums focus:outline-none focus:border-[#F59E0B] focus:ring-2 focus:ring-[#F59E0B]/25 transition"
                />
              </label>

              <label className="space-y-1.5">
                <span className="block text-xs font-medium text-[#94A3B8]">
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
                  className="w-full h-[42px] rounded-[8px] bg-[#0B1220] border border-[#334155] px-3 text-sm font-semibold text-[#F8FAFC] tabular-nums focus:outline-none focus:border-[#F59E0B] focus:ring-2 focus:ring-[#F59E0B]/25 transition"
                />
              </label>

              <label className="space-y-1.5">
                <span className="block text-xs font-medium text-[#94A3B8]">
                  Margin Mode
                </span>
                <select
                  value={settings.marginMode}
                  onChange={(e) =>
                    onSaveSettings({marginMode: e.target.value as 'ISOLATED' | 'CROSS'})
                  }
                  className="w-full h-[42px] rounded-[8px] bg-[#0B1220] border border-[#334155] px-3 text-sm font-semibold text-[#F8FAFC] focus:outline-none focus:border-[#F59E0B] focus:ring-2 focus:ring-[#F59E0B]/25 cursor-pointer transition"
                >
                  <option value="ISOLATED">ISOLATED</option>
                  <option value="CROSS">CROSS</option>
                </select>
              </label>
            </div>
          </section>

          {/* SECTION 2: EMERALD GREEN ACCENT (#10B981) — ENCRYPTED EXCHANGE API KEY VAULT */}
          <section
            aria-label="Encrypted Exchange API Key Vault"
            className="rounded-xl bg-[#1E293B] border border-[#334155] p-5 space-y-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[#334155]">
              <div className="flex items-center gap-2">
                <Lock className="h-4 w-4 text-[#10B981]" aria-hidden="true" />
                <h3 className="text-sm font-bold text-[#10B981]">
                  Encrypted Exchange API Key Vault (AES-256-GCM)
                </h3>
              </div>

              {isCheckingVault ? (
                <span className="inline-flex items-center gap-1.5 text-xs font-mono text-[#94A3B8]">
                  <RefreshCw className="h-3.5 w-3.5 animate-spin text-[#818CF8]" aria-hidden="true" />
                  Checking Vault...
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-md bg-[#0B1220] border border-[#334155] px-2.5 py-1 text-xs font-mono text-[#F8FAFC]">
                  <ExchangeBrandLogo exchange={activeExchange} className="h-3.5 w-3.5" />
                  <span>{boundVenue}</span>
                </span>
              )}
            </div>

            {showSuccessCard ? (
              <div className="space-y-4">
                {/* Clean High-Contrast Emerald Keys Active Card */}
                <div
                  data-testid="vault-keys-active-card"
                  className="rounded-xl border border-[#10B981]/50 bg-[#10B981]/10 p-4 space-y-3"
                >
                  <div className="flex items-start gap-3">
                    <CheckCircle2
                      className="h-5 w-5 text-[#10B981] shrink-0 mt-0.5"
                      aria-hidden="true"
                    />
                    <div className="space-y-1">
                      <h4 className="text-sm font-bold text-[#F8FAFC]">
                        API Keys configured and secured. Auto-Trading is Active.
                      </h4>
                      <p className="text-xs leading-relaxed text-[#CBD5E1]">
                        Your {boundVenue} keys are AES-256-GCM encrypted in Firebase. You do not need to keep the web app or desktop EXE open — the backend continuously uses these stored keys for automated execution.
                      </p>
                    </div>
                  </div>

                  <div className="space-y-2 pt-1">
                    {exchangeApiKeys.map((k) => (
                      <div
                        key={k.id}
                        className="flex items-center justify-between rounded-lg border border-[#334155] bg-[#0B1220] px-3.5 py-2.5 font-mono text-xs"
                      >
                        <div className="flex flex-wrap items-center gap-2.5">
                          <ExchangeBrandLogo exchange={activeExchange} className="h-4 w-4" />
                          <span className="font-bold text-[#F8FAFC]">{k.venue}</span>
                          <span className="text-[#94A3B8]">{k.maskedKey}</span>
                          <span className="text-[11px] font-semibold text-[#10B981]">
                            &middot; AES-256 Cloud Synced
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            void db.removeExchangeKeyViaBackend(username, k.id);
                            onRemoveApiKey(k.id);
                          }}
                          className="rounded-md p-1.5 text-[#94A3B8] hover:text-rose-400 hover:bg-rose-500/10 cursor-pointer transition"
                          aria-label={`Remove ${k.venue} key`}
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                {vaultFeedback && (
                  <p className="text-xs font-semibold text-[#10B981]">{vaultFeedback}</p>
                )}

                <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setVaultFeedback(null);
                      setVaultError(null);
                      setIsEditingKeys(true);
                    }}
                    className="rounded-[8px] border border-[#818CF8]/45 bg-[#818CF8]/10 hover:bg-[#818CF8]/20 px-4 py-2 text-xs font-semibold text-[#818CF8] hover:text-[#F8FAFC] transition cursor-pointer"
                  >
                    Update API Keys
                  </button>
                  <button
                    type="button"
                    onClick={onOpenDiagnostic}
                    className="text-xs font-semibold text-[#818CF8] hover:text-[#A5B4FC] hover:underline cursor-pointer transition"
                  >
                    Run Diagnostic Check &rarr;
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleSaveVaultKey} className="space-y-4">
                <p className="text-xs text-[#94A3B8] leading-relaxed">
                  Credentials saved here are locked exclusively to <strong className="text-[#F8FAFC]">{boundVenue}</strong> and encrypted with AES-256-GCM before storage in Firebase for 24/7 automated execution.
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Read-Only Locked Venue Display (NO DROPDOWN) */}
                  <div className="space-y-1.5">
                    <span className="block text-xs font-medium text-[#94A3B8]">
                      Connected Venue (Session Locked)
                    </span>
                    <div
                      data-testid="vault-readonly-venue-field"
                      className="flex items-center justify-between h-[42px] rounded-[8px] bg-[#0B1220] border border-[#334155] px-3 text-sm font-mono font-semibold text-[#F8FAFC]"
                    >
                      <span className="inline-flex items-center gap-2 truncate">
                        <ExchangeBrandLogo exchange={activeExchange} className="h-4 w-4 shrink-0" />
                        <span className="truncate">{boundVenue}</span>
                      </span>
                      <span className="text-[11px] font-medium text-[#94A3B8] shrink-0">
                        Read-only
                      </span>
                    </div>
                  </div>

                  <label className="space-y-1.5">
                    <span className="block text-xs font-medium text-[#94A3B8]">
                      Key Label
                    </span>
                    <input
                      type="text"
                      value={label}
                      onChange={(e) => setLabel(e.target.value)}
                      placeholder="e.g. Primary Execution Key"
                      className="w-full h-[42px] rounded-[8px] bg-[#0B1220] border border-[#334155] px-3 text-sm font-mono text-[#F8FAFC] placeholder:text-[#64748B] focus:outline-none focus:border-[#10B981] focus:ring-2 focus:ring-[#10B981]/25 transition"
                    />
                  </label>

                  <label className="space-y-1.5">
                    <span className="block text-xs font-medium text-[#94A3B8]">
                      Exchange API Key
                    </span>
                    <input
                      type="text"
                      value={apiKeyInput}
                      onChange={(e) => setApiKeyInput(e.target.value)}
                      placeholder={`Paste ${boundVenue} API Key`}
                      className="w-full h-[42px] rounded-[8px] bg-[#0B1220] border border-[#334155] px-3 text-sm font-mono text-[#F8FAFC] placeholder:text-[#64748B] focus:outline-none focus:border-[#10B981] focus:ring-2 focus:ring-[#10B981]/25 transition"
                    />
                  </label>

                  <label className="space-y-1.5">
                    <span className="block text-xs font-medium text-[#94A3B8]">
                      API Secret
                    </span>
                    <input
                      type="password"
                      value={apiSecretInput}
                      onChange={(e) => setApiSecretInput(e.target.value)}
                      placeholder="Paste API Secret"
                      className="w-full h-[42px] rounded-[8px] bg-[#0B1220] border border-[#334155] px-3 text-sm font-mono text-[#F8FAFC] placeholder:text-[#64748B] focus:outline-none focus:border-[#10B981] focus:ring-2 focus:ring-[#10B981]/25 transition"
                    />
                  </label>
                </div>

                {vaultError && (
                  <p className="text-xs font-semibold text-rose-400">{vaultError}</p>
                )}
                {vaultFeedback && (
                  <p className="text-xs font-semibold text-[#10B981]">{vaultFeedback}</p>
                )}

                <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-[#334155]/70">
                  <div className="flex items-center gap-2.5">
                    <button
                      type="submit"
                      disabled={isSavingVault}
                      className="inline-flex items-center gap-2 h-[42px] rounded-[8px] bg-[#10B981] hover:bg-[#059669] px-5 text-xs font-bold text-[#042118] transition cursor-pointer disabled:opacity-60 whitespace-nowrap"
                    >
                      <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                      <span>{isSavingVault ? 'Encrypting...' : 'Encrypt & Store Key'}</span>
                    </button>

                    {hasSavedKeys && (
                      <button
                        type="button"
                        onClick={() => setIsEditingKeys(false)}
                        className="h-[42px] rounded-[8px] border border-[#334155] bg-[#0F172A] px-4 text-xs font-semibold text-[#818CF8] hover:border-[#818CF8]/50 hover:bg-[#818CF8]/10 transition cursor-pointer"
                      >
                        Cancel
                      </button>
                    )}
                  </div>

                  {/* SECTION 3: SOFT INDIGO / VIOLET ACCENT (#818CF8) — DIAGNOSTICS */}
                  <button
                    type="button"
                    onClick={onOpenDiagnostic}
                    className="inline-flex items-center gap-1 rounded-[8px] px-3 py-2 text-xs font-semibold text-[#818CF8] hover:text-[#A5B4FC] hover:bg-[#818CF8]/10 transition cursor-pointer whitespace-nowrap"
                  >
                    <span>Run Diagnostic Check &rarr;</span>
                  </button>
                </div>
              </form>
            )}
          </section>
        </div>
      </div>
    </div>
  );
};
