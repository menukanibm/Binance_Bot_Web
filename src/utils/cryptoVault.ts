// Client-side AES-GCM vault helper for API Key Management Modal
const VAULT_SECRET_SALT = 'makka-footprint-institutional-vault-v1';

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

async function deriveKey(passphrase: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await window.crypto.subtle.importKey(
    'raw',
    enc.encode(passphrase),
    {name: 'PBKDF2'},
    false,
    ['deriveKey'],
  );
  return window.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: enc.encode(VAULT_SECRET_SALT),
      iterations: 50000,
      hash: 'SHA-256',
    },
    keyMaterial,
    {name: 'AES-GCM', length: 256},
    false,
    ['encrypt'],
  );
}

export async function encryptApiSecret(
  apiKey: string,
  apiSecret: string,
  deviceId: string,
): Promise<string> {
  const payload = JSON.stringify({apiKey, apiSecret, ts: Date.now()});

  if (typeof window !== 'undefined' && window.crypto?.subtle) {
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(deviceId);
    const encrypted = await window.crypto.subtle.encrypt(
      {name: 'AES-GCM', iv},
      key,
      new TextEncoder().encode(payload),
    );
    return `AES-GCM.${toBase64(iv)}.${toBase64(new Uint8Array(encrypted))}`;
  }

  // Fallback obfuscated envelope for non-HTTPS local test runners
  return `LOCAL-ENC.${toBase64(new TextEncoder().encode(payload))}`;
}

export function maskApiKey(rawKey: string): string {
  const trimmed = rawKey.trim();
  if (trimmed.length <= 8) return '••••••••';
  return `${trimmed.slice(0, 4)}••••••••${trimmed.slice(-4)}`;
}
