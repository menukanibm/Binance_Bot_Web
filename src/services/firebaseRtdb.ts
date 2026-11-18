import type {
  FirebaseBotSettingsNode,
  FirebaseBotState,
  FirebaseExchangeKeyRecord,
  FirebaseLiveSignalsNode,
  FirebaseUserRecord,
} from '../types/trading.ts';

export const DEFAULT_FIREBASE_RTDB_URL =
  'https://binancebot-10adc-default-rtdb.asia-southeast1.firebasedatabase.app';

export function normalizeRtdbUrl(raw?: string | null): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const cleaned = raw.trim().replace(/\/+$/, '');
  if (!cleaned) return null;
  if (cleaned.includes('YOUR-PROJECT') || cleaned.includes('example')) return null;
  if (!/^https:\/\/[a-z0-9.-]+/i.test(cleaned)) return null;
  return cleaned;
}

export function getConfiguredRtdbUrl(): string {
  const envUrl =
    (import.meta as unknown as {env?: Record<string, string | undefined>}).env
      ?.VITE_FIREBASE_RTDB_URL || '';
  return normalizeRtdbUrl(envUrl) || DEFAULT_FIREBASE_RTDB_URL;
}

export function encodeUsernameKey(username: string): string {
  return encodeURIComponent(username.trim().replace(/[.#$/[\]]/g, '_'));
}

export async function readAllUsersFromRtdb(
  rtdbUrl: string,
): Promise<Record<string, FirebaseUserRecord> | null> {
  const base = normalizeRtdbUrl(rtdbUrl);
  if (!base) return null;
  const res = await fetch(`${base}/users.json`, {
    headers: {Accept: 'application/json'},
    signal: AbortSignal.timeout(4500),
  });
  if (!res.ok) throw new Error(`RTDB /users.json HTTP ${res.status}`);
  const data = (await res.json()) as Record<string, FirebaseUserRecord> | null;
  return data || {};
}

export async function readUserFromRtdb(
  rtdbUrl: string,
  username: string,
): Promise<FirebaseUserRecord | null> {
  const base = normalizeRtdbUrl(rtdbUrl);
  if (!base) return null;
  const key = encodeUsernameKey(username);
  const res = await fetch(`${base}/users/${key}.json`, {
    headers: {Accept: 'application/json'},
    signal: AbortSignal.timeout(4500),
  });
  if (!res.ok) throw new Error(`RTDB /users/${key}.json HTTP ${res.status}`);
  return (await res.json()) as FirebaseUserRecord | null;
}

export async function patchUserInRtdb(
  rtdbUrl: string,
  username: string,
  partial: Partial<FirebaseUserRecord>,
): Promise<void> {
  const base = normalizeRtdbUrl(rtdbUrl);
  if (!base) return;
  const key = encodeUsernameKey(username);
  const res = await fetch(`${base}/users/${key}.json`, {
    method: 'PATCH',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(partial),
    signal: AbortSignal.timeout(4500),
  });
  if (!res.ok) throw new Error(`RTDB PATCH /users/${key}.json HTTP ${res.status}`);
}

export async function readExchangeKeysFromRtdb(
  rtdbUrl: string,
  username: string,
): Promise<Record<string, FirebaseExchangeKeyRecord> | null> {
  const base = normalizeRtdbUrl(rtdbUrl);
  if (!base || !username.trim()) return null;
  const key = encodeUsernameKey(username);
  const res = await fetch(`${base}/users/${key}/exchangeKeys.json`, {
    headers: {Accept: 'application/json'},
    signal: AbortSignal.timeout(4500),
  });
  if (!res.ok) throw new Error(`RTDB /users/${key}/exchangeKeys.json HTTP ${res.status}`);
  return (await res.json()) as Record<string, FirebaseExchangeKeyRecord> | null;
}

export async function putExchangeKeyInRtdb(
  rtdbUrl: string,
  username: string,
  keyId: string,
  record: FirebaseExchangeKeyRecord,
): Promise<void> {
  const base = normalizeRtdbUrl(rtdbUrl);
  if (!base || !username.trim()) return;
  const userKey = encodeUsernameKey(username);
  const safeKeyId = encodeUsernameKey(keyId);
  const res = await fetch(`${base}/users/${userKey}/exchangeKeys/${safeKeyId}.json`, {
    method: 'PUT',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(record),
    signal: AbortSignal.timeout(4500),
  });
  if (!res.ok) {
    throw new Error(`RTDB PUT /users/${userKey}/exchangeKeys/${safeKeyId}.json HTTP ${res.status}`);
  }
}

export async function deleteExchangeKeyFromRtdb(
  rtdbUrl: string,
  username: string,
  keyId: string,
): Promise<void> {
  const base = normalizeRtdbUrl(rtdbUrl);
  if (!base || !username.trim()) return;
  const userKey = encodeUsernameKey(username);
  const safeKeyId = encodeUsernameKey(keyId);
  const res = await fetch(`${base}/users/${userKey}/exchangeKeys/${safeKeyId}.json`, {
    method: 'DELETE',
    signal: AbortSignal.timeout(4500),
  });
  if (!res.ok) {
    throw new Error(`RTDB DELETE /users/${userKey}/exchangeKeys/${safeKeyId}.json HTTP ${res.status}`);
  }
}

export async function readBotSettingsFromRtdb(
  rtdbUrl: string,
  username: string,
): Promise<Partial<FirebaseBotSettingsNode> | null> {
  const base = normalizeRtdbUrl(rtdbUrl);
  if (!base) return null;
  const key = encodeUsernameKey(username || 'admin');
  const res = await fetch(`${base}/bot_settings/${key}.json`, {
    headers: {Accept: 'application/json'},
    signal: AbortSignal.timeout(4500),
  });
  if (!res.ok) throw new Error(`RTDB /bot_settings/${key}.json HTTP ${res.status}`);
  return (await res.json()) as Partial<FirebaseBotSettingsNode> | null;
}

export async function patchBotSettingsInRtdb(
  rtdbUrl: string,
  username: string,
  partial: Partial<FirebaseBotSettingsNode>,
): Promise<void> {
  const base = normalizeRtdbUrl(rtdbUrl);
  if (!base) return;
  const key = encodeUsernameKey(username || 'admin');
  const res = await fetch(`${base}/bot_settings/${key}.json`, {
    method: 'PATCH',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({...partial, updatedAt: Date.now()}),
    signal: AbortSignal.timeout(4500),
  });
  if (!res.ok) throw new Error(`RTDB PATCH /bot_settings/${key}.json HTTP ${res.status}`);
}

export async function readLiveSignalsFromRtdb(
  rtdbUrl: string,
  username: string,
): Promise<Partial<FirebaseLiveSignalsNode> | null> {
  const base = normalizeRtdbUrl(rtdbUrl);
  if (!base) return null;
  const key = encodeUsernameKey(username || 'admin');
  const res = await fetch(`${base}/live_signals/${key}.json`, {
    headers: {Accept: 'application/json'},
    signal: AbortSignal.timeout(4500),
  });
  if (!res.ok) throw new Error(`RTDB /live_signals/${key}.json HTTP ${res.status}`);
  return (await res.json()) as Partial<FirebaseLiveSignalsNode> | null;
}

export async function patchLiveSignalsInRtdb(
  rtdbUrl: string,
  username: string,
  partial: Partial<FirebaseLiveSignalsNode>,
): Promise<void> {
  const base = normalizeRtdbUrl(rtdbUrl);
  if (!base) return;
  const key = encodeUsernameKey(username || 'admin');
  const res = await fetch(`${base}/live_signals/${key}.json`, {
    method: 'PATCH',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({...partial, updatedAt: Date.now()}),
    signal: AbortSignal.timeout(4500),
  });
  if (!res.ok) throw new Error(`RTDB PATCH /live_signals/${key}.json HTTP ${res.status}`);
}

export function subscribeLiveSignalsStream(
  rtdbUrl: string,
  username: string,
  onUpdate: (data: Partial<FirebaseLiveSignalsNode> | null) => void,
): () => void {
  if (typeof window === 'undefined' || typeof EventSource === 'undefined') {
    return () => {};
  }
  const base = normalizeRtdbUrl(rtdbUrl);
  if (!base || !username.trim()) return () => {};

  const key = encodeUsernameKey(username);
  const es = new EventSource(`${base}/live_signals/${key}.json`);

  const handleEvent = (ev: MessageEvent) => {
    try {
      const parsed = JSON.parse(ev.data) as {path?: string; data?: unknown};
      if (!parsed || parsed.data === null || parsed.data === undefined) return;
      if (parsed.path === '/' && typeof parsed.data === 'object') {
        onUpdate(parsed.data as Partial<FirebaseLiveSignalsNode>);
      } else if (typeof parsed.path === 'string' && parsed.path.length > 1) {
        const topField = parsed.path.replace(/^\/+/, '').split('/')[0];
        if (topField && topField === parsed.path.replace(/^\/+/, '')) {
          onUpdate({[topField]: parsed.data} as Partial<FirebaseLiveSignalsNode>);
        } else {
          void readLiveSignalsFromRtdb(base, username)
            .then((fresh) => {
              if (fresh) onUpdate(fresh);
            })
            .catch(() => null);
        }
      }
    } catch {
      // Ignore malformed keep-alive packets
    }
  };

  es.addEventListener('put', handleEvent as EventListener);
  es.addEventListener('patch', handleEvent as EventListener);

  return () => {
    es.close();
  };
}

export async function readBotStateFromRtdb(rtdbUrl: string): Promise<Partial<FirebaseBotState> | null> {
  const base = normalizeRtdbUrl(rtdbUrl);
  if (!base) return null;
  const res = await fetch(`${base}/botState.json`, {
    headers: {Accept: 'application/json'},
    signal: AbortSignal.timeout(4500),
  });
  if (!res.ok) throw new Error(`RTDB /botState.json HTTP ${res.status}`);
  return (await res.json()) as Partial<FirebaseBotState> | null;
}

export async function patchBotStateInRtdb(
  rtdbUrl: string,
  partial: Partial<FirebaseBotState>,
): Promise<void> {
  const base = normalizeRtdbUrl(rtdbUrl);
  if (!base) return;
  const res = await fetch(`${base}/botState.json`, {
    method: 'PATCH',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({...partial, updatedAt: Date.now()}),
    signal: AbortSignal.timeout(4500),
  });
  if (!res.ok) throw new Error(`RTDB PATCH /botState.json HTTP ${res.status}`);
}

export async function readActivePositionsFromRtdb(
  rtdbUrl: string,
  username: string,
): Promise<Partial<import('../types/trading.ts').FirebaseActivePositionsNode> | null> {
  const base = normalizeRtdbUrl(rtdbUrl);
  if (!base || !username.trim()) return null;
  const key = encodeUsernameKey(username);
  const res = await fetch(`${base}/active_positions/${key}.json`, {
    headers: {Accept: 'application/json'},
    signal: AbortSignal.timeout(4500),
  });
  if (!res.ok) throw new Error(`RTDB /active_positions/${key}.json HTTP ${res.status}`);
  return (await res.json()) as Partial<
    import('../types/trading.ts').FirebaseActivePositionsNode
  > | null;
}

export async function patchActivePositionsInRtdb(
  rtdbUrl: string,
  username: string,
  partial: Partial<import('../types/trading.ts').FirebaseActivePositionsNode>,
): Promise<void> {
  const base = normalizeRtdbUrl(rtdbUrl);
  if (!base || !username.trim()) return;
  const key = encodeUsernameKey(username);
  const res = await fetch(`${base}/active_positions/${key}.json`, {
    method: 'PATCH',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({...partial, updatedAt: Date.now()}),
    signal: AbortSignal.timeout(4500),
  });
  if (!res.ok) throw new Error(`RTDB PATCH /active_positions/${key}.json HTTP ${res.status}`);
}

export function subscribeActivePositionsStream(
  rtdbUrl: string,
  username: string,
  onUpdate: (
    data: Partial<import('../types/trading.ts').FirebaseActivePositionsNode> | null,
  ) => void,
): () => void {
  if (typeof window === 'undefined' || typeof EventSource === 'undefined') {
    return () => {};
  }
  const base = normalizeRtdbUrl(rtdbUrl);
  if (!base || !username.trim()) return () => {};

  const key = encodeUsernameKey(username);
  const es = new EventSource(`${base}/active_positions/${key}.json`);

  const handleEvent = (ev: MessageEvent) => {
    try {
      const parsed = JSON.parse(ev.data) as {path?: string; data?: unknown};
      if (!parsed || parsed.data === null || parsed.data === undefined) return;
      if (parsed.path === '/' && typeof parsed.data === 'object') {
        onUpdate(
          parsed.data as Partial<import('../types/trading.ts').FirebaseActivePositionsNode>,
        );
      } else if (typeof parsed.path === 'string' && parsed.path.length > 1) {
        void readActivePositionsFromRtdb(base, username)
          .then((fresh) => {
            if (fresh) onUpdate(fresh);
          })
          .catch(() => null);
      }
    } catch {
      // Ignore malformed keep-alive packets
    }
  };

  es.addEventListener('put', handleEvent as EventListener);
  es.addEventListener('patch', handleEvent as EventListener);

  return () => {
    es.close();
  };
}
