import crypto from 'node:crypto';

const VAULT_SALT = 'makka-footprint-institutional-vault-v1';

export interface DecryptedExchangeCredentials {
  apiKey: string;
  apiSecret: string;
  ts: number;
}

export function getServerVaultSecret(): string {
  return (
    process.env.MAKKA_VAULT_SECRET?.trim() ||
    'makka-institutional-server-vault-default-v1'
  );
}

function deriveAes256Key(secretPassphrase: string): Buffer {
  return crypto.pbkdf2Sync(secretPassphrase, VAULT_SALT, 50_000, 32, 'sha256');
}

export function encryptExchangeKeysServer(
  apiKey: string,
  apiSecret: string,
  secretPassphrase = getServerVaultSecret(),
): string {
  const iv = crypto.randomBytes(12);
  const key = deriveAes256Key(secretPassphrase);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plaintext = JSON.stringify({
    apiKey: apiKey.trim(),
    apiSecret: apiSecret.trim(),
    ts: Date.now(),
  });
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `AES-256-GCM.${iv.toString('base64')}.${authTag.toString('base64')}.${encrypted.toString('base64')}`;
}

export function decryptExchangeKeysServer(
  encryptedPayload: string,
  secretPassphrase = getServerVaultSecret(),
): DecryptedExchangeCredentials {
  if (!encryptedPayload || typeof encryptedPayload !== 'string') {
    throw new Error('Missing encrypted API key payload');
  }

  if (encryptedPayload.startsWith('AES-256-GCM.')) {
    const parts = encryptedPayload.split('.');
    if (parts.length !== 4) {
      throw new Error('Malformed AES-256-GCM envelope');
    }
    const iv = Buffer.from(parts[1], 'base64');
    const authTag = Buffer.from(parts[2], 'base64');
    const ciphertext = Buffer.from(parts[3], 'base64');
    const key = deriveAes256Key(secretPassphrase);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    const parsed = JSON.parse(decrypted) as DecryptedExchangeCredentials;
    if (!parsed.apiKey || !parsed.apiSecret) {
      throw new Error('Decrypted key payload incomplete');
    }
    return parsed;
  }

  if (encryptedPayload.startsWith('LOCAL-ENC.')) {
    const raw = Buffer.from(encryptedPayload.slice('LOCAL-ENC.'.length), 'base64').toString('utf8');
    const parsed = JSON.parse(raw) as DecryptedExchangeCredentials;
    if (!parsed.apiKey || !parsed.apiSecret) {
      throw new Error('Decrypted local key payload incomplete');
    }
    return parsed;
  }

  throw new Error('Unsupported encrypted payload format');
}

export function maskApiKey(rawKey: string): string {
  const trimmed = rawKey.trim();
  if (trimmed.length <= 8) return '••••••••';
  return `${trimmed.slice(0, 4)}••••••••${trimmed.slice(-4)}`;
}
