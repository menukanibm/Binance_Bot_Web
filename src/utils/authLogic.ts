import bcrypt from 'bcryptjs';
import type {UserAccount} from '../types/trading';

export type AuthFailureCode =
  | 'INVALID_CREDENTIALS'
  | 'ACCOUNT_SUSPENDED'
  | 'ACCOUNT_EXPIRED'
  | 'DEVICE_LOCKED';

export type AccountDurationOption = '1M' | '3M' | '6M' | '1Y';

export interface LoginValidationResult {
  ok: boolean;
  code?: AuthFailureCode;
  message?: string;
  shouldBindDevice?: boolean;
}

export function hashPassword(plainPassword: string): string {
  const salt = bcrypt.genSaltSync(10);
  return bcrypt.hashSync(plainPassword, salt);
}

export function verifyPassword(plainPassword: string, passwordHash: string): boolean {
  if (!plainPassword || !passwordHash) return false;
  try {
    return bcrypt.compareSync(plainPassword, passwordHash);
  } catch {
    return false;
  }
}

export function durationToMonths(duration: AccountDurationOption): number {
  switch (duration) {
    case '1M':
      return 1;
    case '3M':
      return 3;
    case '6M':
      return 6;
    case '1Y':
      return 12;
  }
}

export function calculateExpiryDateFromDuration(
  duration: AccountDurationOption,
  fromDate: Date = new Date(),
): string {
  const months = durationToMonths(duration);
  const year = fromDate.getUTCFullYear();
  const month = fromDate.getUTCMonth();
  const day = fromDate.getUTCDate();
  const targetMonthIndex = month + months;
  const maxDayInTargetMonth = new Date(Date.UTC(year, targetMonthIndex + 1, 0)).getUTCDate();
  const clampedDay = Math.min(day, maxDayInTargetMonth);
  const expiry = new Date(Date.UTC(year, targetMonthIndex, clampedDay));
  return expiry.toISOString().slice(0, 10);
}

export function getEffectiveDeviceId(
  user: Pick<UserAccount, 'deviceId' | 'boundedDeviceId'>,
): string | null {
  const raw = user.deviceId ?? user.boundedDeviceId ?? null;
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function isAccountExpired(expiryDate: string, now: Date = new Date()): boolean {
  if (!expiryDate) return true;
  const trimmed = expiryDate.trim();
  // Support both YYYY-MM-DD and full ISO-8601 timestamps from EXE users-registry.json
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(trimmed)
    ? Date.parse(`${trimmed}T23:59:59.999Z`)
    : Date.parse(trimmed);
  if (Number.isNaN(parsed)) return true;
  return now.getTime() > parsed;
}

export function validateLoginAccess(
  user: UserAccount | undefined,
  passwordAttempt: string,
  currentDeviceId: string,
  now: Date = new Date(),
): LoginValidationResult {
  if (!user || !user.passwordHash || !verifyPassword(passwordAttempt, user.passwordHash)) {
    return {
      ok: false,
      code: 'INVALID_CREDENTIALS',
      message: 'Invalid credentials. Contact Makka Admin for account access.',
    };
  }

  if (!user.isActive) {
    return {
      ok: false,
      code: 'ACCOUNT_SUSPENDED',
      message: 'Account Suspended: Your terminal access has been disabled by Makka Admin.',
    };
  }

  if (isAccountExpired(user.expiryDate, now)) {
    return {
      ok: false,
      code: 'ACCOUNT_EXPIRED',
      message: 'Account Expired. Please contact Admin.',
    };
  }

  // Master Admin is unrestricted across Desktop EXE & Mobile/Web PWA
  if (user.role === 'admin') {
    return {
      ok: true,
      shouldBindDevice: false,
    };
  }

  const boundId = getEffectiveDeviceId(user);
  if (!boundId) {
    return {
      ok: true,
      shouldBindDevice: true,
    };
  }

  if (boundId !== currentDeviceId) {
    return {
      ok: false,
      code: 'DEVICE_LOCKED',
      message: 'Device Locked. This account is registered to another device.',
    };
  }

  return {
    ok: true,
    shouldBindDevice: false,
  };
}

export function validateActiveSession(
  user: UserAccount | undefined,
  sessionDeviceId: string,
  now: Date = new Date(),
): {valid: boolean; reason?: string} {
  if (!user) {
    return {valid: false, reason: 'Account removed by Makka Admin.'};
  }
  if (!user.isActive) {
    return {valid: false, reason: 'Access suspended by Makka Admin.'};
  }
  if (isAccountExpired(user.expiryDate, now)) {
    return {valid: false, reason: 'Account Expired. Please contact Admin.'};
  }
  const boundId = getEffectiveDeviceId(user);
  if (user.role !== 'admin' && boundId !== sessionDeviceId) {
    return {
      valid: false,
      reason: 'Device Locked. This account is registered to another device.',
    };
  }
  return {valid: true};
}

const DEVICE_STORAGE_KEY = 'makka_device_fingerprint_v1';

function hashString(input: string, seed = 2166136261): string {
  let h = seed >>> 0;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).toUpperCase().padStart(8, '0');
}

export function computeStableBrowserFingerprint(): string {
  if (typeof window === 'undefined') {
    return 'DEV-SSR-00000000';
  }
  const nav = window.navigator;
  const scr = window.screen;
  const primarySignals = [
    nav?.userAgent || 'unknown',
    nav?.language || 'en',
    Array.isArray(nav?.languages) ? nav.languages.join(',') : '',
    `${scr?.width || 0}x${scr?.height || 0}`,
    String(scr?.colorDepth || 24),
    String(window.devicePixelRatio || 1),
    String(nav?.hardwareConcurrency || 4),
    String(nav?.maxTouchPoints || 0),
    Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  ].join('|');

  const secondarySignals = [
    (nav as Navigator & {userAgentData?: {platform?: string}})?.userAgentData?.platform ||
      nav?.platform ||
      'unknown',
    nav?.vendor || '',
    String((nav as Navigator & {deviceMemory?: number})?.deviceMemory || ''),
    `${scr?.availWidth || 0}x${scr?.availHeight || 0}`,
  ].join('|');

  const h1 = hashString(primarySignals, 2166136261);
  const h2 = hashString(`${primarySignals}::${secondarySignals}`, 0x811c9dc5 ^ 0x9e3779b9).slice(
    0,
    4,
  );
  return `DEV-${h1}-${h2}`;
}

export function getOrCreateDeviceId(): string {
  if (typeof window === 'undefined') {
    return 'DEV-SSR-00000000';
  }
  try {
    const existing = window.localStorage.getItem(DEVICE_STORAGE_KEY);
    if (existing && (existing.startsWith('DEV-') || existing.startsWith('WIN-'))) {
      return existing;
    }
  } catch {
    // Ignore storage read restrictions and fall back to deterministic fingerprint
  }
  const id = computeStableBrowserFingerprint();
  try {
    window.localStorage.setItem(DEVICE_STORAGE_KEY, id);
  } catch {
    // Ignore quota/privacy storage write restrictions
  }
  return id;
}
