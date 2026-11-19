import test from 'node:test';
import assert from 'node:assert/strict';
import {
  filterApiKeysForExchange,
  getExchangeThemeAttr,
  getExchangeThemeMeta,
  getExchangeVaultVenue,
} from './exchangeTheme';
import type {ApiKeyRecord} from '../types/trading';

test('getExchangeThemeMeta returns exact Binance Pro palette and venue metadata', () => {
  const meta = getExchangeThemeMeta('BINANCE');
  assert.equal(meta.themeKey, 'binance');
  assert.equal(meta.headerBadge, 'BINANCE USD-M');
  assert.equal(meta.venueName, 'Binance Futures');
  assert.equal(meta.primaryAccent, '#F0B90B');
  assert.equal(meta.baseBg, '#0B0E11');
  assert.equal(meta.surfaceBg, '#181A20');
  assert.equal(meta.borderColor, '#2B3139');
  assert.equal(meta.longColor, '#0ECB81');
  assert.equal(meta.shortColor, '#F6465D');
  assert.equal(getExchangeThemeAttr('BINANCE'), 'binance');
  assert.equal(getExchangeVaultVenue('BINANCE'), 'Binance Futures');
});

test('getExchangeThemeMeta returns exact MEXC Pro palette and venue metadata', () => {
  const meta = getExchangeThemeMeta('MEXC');
  assert.equal(meta.themeKey, 'mexc');
  assert.equal(meta.headerBadge, 'MEXC FUTURES');
  assert.equal(meta.venueName, 'MEXC Futures');
  assert.equal(meta.primaryAccent, '#00B8FF');
  assert.equal(meta.baseBg, '#0B1018');
  assert.equal(meta.surfaceBg, '#131A26');
  assert.equal(meta.borderColor, '#1E293B');
  assert.equal(meta.longColor, '#16B979');
  assert.equal(meta.shortColor, '#F23645');
  assert.equal(getExchangeThemeAttr('MEXC'), 'mexc');
  assert.equal(getExchangeVaultVenue('MEXC'), 'MEXC Futures');
});

test('filterApiKeysForExchange isolates vault keys strictly to active login exchange', () => {
  const keys: ApiKeyRecord[] = [
    {
      id: 'k1',
      venue: 'Binance Futures',
      label: 'Primary Binance',
      maskedKey: 'bn01...9921',
      encryptedPayload: 'aes256:enc1',
      updatedAt: '2026-11-18T00:00:00Z',
    },
    {
      id: 'k2',
      venue: 'MEXC Futures',
      label: 'Primary MEXC',
      maskedKey: 'mx02...4410',
      encryptedPayload: 'aes256:enc2',
      updatedAt: '2026-11-18T00:00:00Z',
    },
    {
      id: 'k3',
      venue: 'Coinglass OrderFlow',
      label: 'Legacy CG',
      maskedKey: 'cg...0001',
      encryptedPayload: 'aes256:enc3',
      updatedAt: '2026-11-18T00:00:00Z',
    },
  ];

  const binanceKeys = filterApiKeysForExchange(keys, 'BINANCE');
  assert.equal(binanceKeys.length, 1);
  assert.equal(binanceKeys[0].id, 'k1');

  const mexcKeys = filterApiKeysForExchange(keys, 'MEXC');
  assert.equal(mexcKeys.length, 1);
  assert.equal(mexcKeys[0].id, 'k2');
});
