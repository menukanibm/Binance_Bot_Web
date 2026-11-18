import assert from 'node:assert/strict';
import test from 'node:test';
import {getModeResetPayload} from './database.ts';
import {
  DEFAULT_FIREBASE_RTDB_URL,
  encodeUsernameKey,
  getConfiguredRtdbUrl,
  normalizeRtdbUrl,
} from './firebaseRtdb.ts';

test('normalizeRtdbUrl strips trailing slashes and ignores placeholders', () => {
  assert.equal(normalizeRtdbUrl('https://YOUR-PROJECT-default-rtdb.firebaseio.com/'), null);
  assert.equal(normalizeRtdbUrl(''), null);
  assert.equal(
    normalizeRtdbUrl('https://makka-bot-default-rtdb.firebaseio.com///'),
    'https://makka-bot-default-rtdb.firebaseio.com',
  );
  assert.equal(
    normalizeRtdbUrl('https://binancebot-10adc-default-rtdb.asia-southeast1.firebasedatabase.app/'),
    'https://binancebot-10adc-default-rtdb.asia-southeast1.firebasedatabase.app',
  );
});

test('getConfiguredRtdbUrl defaults to the Asia Southeast1 Firebase RTDB endpoint', () => {
  assert.equal(
    getConfiguredRtdbUrl(),
    'https://binancebot-10adc-default-rtdb.asia-southeast1.firebasedatabase.app',
  );
  assert.equal(
    DEFAULT_FIREBASE_RTDB_URL,
    'https://binancebot-10adc-default-rtdb.asia-southeast1.firebasedatabase.app',
  );
});

test('encodeUsernameKey sanitizes forbidden Firebase key characters', () => {
  assert.equal(encodeUsernameKey('trader.alpha@domain'), 'trader_alpha%40domain');
  assert.equal(encodeUsernameKey(' Menuka '), 'Menuka');
});

test('getModeResetPayload resets $10,000 paper balance and mock trades to $0.00 in LIVE mode', () => {
  const liveReset = getModeResetPayload('LIVE');
  assert.equal(liveReset.accountBalance, 0);
  assert.equal(liveReset.currentPnL, 0);
  assert.equal(liveReset.openPosition, 'NONE');
  assert.deepEqual(liveReset.openPositions, []);
  assert.deepEqual(liveReset.closedPositions, []);
  assert.deepEqual(liveReset.signals, []);

  const paperReset = getModeResetPayload('PAPER');
  assert.equal(paperReset.accountBalance, 10000);
  assert.deepEqual(paperReset.openPositions, []);
  assert.deepEqual(paperReset.closedPositions, []);
});
