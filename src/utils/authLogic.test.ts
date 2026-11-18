import assert from 'node:assert/strict';
import test from 'node:test';
import type {UserAccount} from '../types/trading';
import {
  calculateExpiryDateFromDuration,
  hashPassword,
  isAccountExpired,
  validateActiveSession,
  validateLoginAccess,
  verifyPassword,
} from './authLogic.ts';

const hashedSecret = hashPassword('Secret#123');

const baseTrader: UserAccount = {
  id: 'usr-1',
  username: 'trader_one',
  passwordHash: hashedSecret,
  role: 'trader',
  isActive: true,
  expiryDate: '2027-06-30',
  deviceId: null,
  createdAt: '2026-01-01T00:00:00.000Z',
};

test('password hashing uses bcrypt and verifies plaintext without storing it', () => {
  assert.ok(hashedSecret.startsWith('$2'));
  assert.notEqual(hashedSecret, 'Secret#123');
  assert.equal('password' in baseTrader, false);
  assert.equal(verifyPassword('Secret#123', hashedSecret), true);
  assert.equal(verifyPassword('WrongPass', hashedSecret), false);
});

test('duration calculator computes 1M, 3M, 6M, and 1Y expiry dates cleanly', () => {
  const start = new Date('2026-01-31T00:00:00Z');
  assert.equal(calculateExpiryDateFromDuration('1M', start), '2026-02-28');
  assert.equal(calculateExpiryDateFromDuration('3M', start), '2026-04-30');
  assert.equal(calculateExpiryDateFromDuration('6M', start), '2026-07-31');
  assert.equal(calculateExpiryDateFromDuration('1Y', start), '2027-01-31');
});

test('first login on unbound trader binds deviceId', () => {
  const now = new Date('2026-11-18T10:00:00Z');
  const res = validateLoginAccess(baseTrader, 'Secret#123', 'DEV-AAA-111', now);
  assert.equal(res.ok, true);
  assert.equal(res.shouldBindDevice, true);
});

test('login from mismatched device is blocked with exact lock message', () => {
  const now = new Date('2026-11-18T10:00:00Z');
  const lockedUser: UserAccount = {
    ...baseTrader,
    deviceId: 'WIN-68814084-287C0B95',
  };
  const res = validateLoginAccess(lockedUser, 'Secret#123', 'DEV-OTHER-222', now);
  assert.equal(res.ok, false);
  assert.equal(res.code, 'DEVICE_LOCKED');
  assert.equal(
    res.message,
    'Device Locked. This account is registered to another device.',
  );
});

test('expired account is denied with exact expiry message', () => {
  const now = new Date('2026-11-18T10:00:00Z');
  const expiredUser: UserAccount = {
    ...baseTrader,
    expiryDate: '2026-11-17',
  };
  const res = validateLoginAccess(expiredUser, 'Secret#123', 'DEV-AAA-111', now);
  assert.equal(res.ok, false);
  assert.equal(res.code, 'ACCOUNT_EXPIRED');
  assert.equal(res.message, 'Account Expired. Please contact Admin.');
});

test('supports ISO-8601 expiry timestamps from EXE registry', () => {
  const now = new Date('2026-11-18T10:00:00Z');
  assert.equal(isAccountExpired('2026-12-18T09:29:25.073Z', now), false);
  assert.equal(isAccountExpired('2025-12-18T09:29:25.073Z', now), true);
});

test('real-time session check terminates suspended, expired, or reset sessions with exact messages', () => {
  const now = new Date('2026-11-18T10:00:00Z');
  const suspended = validateActiveSession(
    {...baseTrader, deviceId: 'DEV-AAA-111', isActive: false},
    'DEV-AAA-111',
    now,
  );
  assert.equal(suspended.valid, false);

  const expired = validateActiveSession(
    {...baseTrader, deviceId: 'DEV-AAA-111', expiryDate: '2026-11-01'},
    'DEV-AAA-111',
    now,
  );
  assert.equal(expired.valid, false);
  assert.equal(expired.reason, 'Account Expired. Please contact Admin.');

  const reset = validateActiveSession(
    {...baseTrader, deviceId: null},
    'DEV-AAA-111',
    now,
  );
  assert.equal(reset.valid, false);
  assert.equal(reset.reason, 'Device Locked. This account is registered to another device.');
});
