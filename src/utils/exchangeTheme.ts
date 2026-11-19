import type {ApiKeyRecord, ExchangeType} from '../types/trading';

export type ExchangeThemeKey = 'binance' | 'mexc';

export interface ExchangeThemeMeta {
  exchange: ExchangeType;
  themeKey: ExchangeThemeKey;
  headerBadge: 'BINANCE USD-M' | 'MEXC FUTURES';
  venueName: Extract<ApiKeyRecord['venue'], 'Binance Futures' | 'MEXC Futures'>;
  displayName: 'Binance' | 'MEXC';
  primaryAccent: '#F0B90B' | '#00B8FF';
  primaryAccentHover: '#FCD535' | '#38BDF8';
  baseBg: '#0B0E11' | '#0B1018';
  surfaceBg: '#181A20' | '#131A26';
  borderColor: '#2B3139' | '#1E293B';
  longColor: '#0ECB81' | '#16B979';
  shortColor: '#F6465D' | '#F23645';
}

const BINANCE_META: ExchangeThemeMeta = {
  exchange: 'BINANCE',
  themeKey: 'binance',
  headerBadge: 'BINANCE USD-M',
  venueName: 'Binance Futures',
  displayName: 'Binance',
  primaryAccent: '#F0B90B',
  primaryAccentHover: '#FCD535',
  baseBg: '#0B0E11',
  surfaceBg: '#181A20',
  borderColor: '#2B3139',
  longColor: '#0ECB81',
  shortColor: '#F6465D',
};

const MEXC_META: ExchangeThemeMeta = {
  exchange: 'MEXC',
  themeKey: 'mexc',
  headerBadge: 'MEXC FUTURES',
  venueName: 'MEXC Futures',
  displayName: 'MEXC',
  primaryAccent: '#00B8FF',
  primaryAccentHover: '#38BDF8',
  baseBg: '#0B1018',
  surfaceBg: '#131A26',
  borderColor: '#1E293B',
  longColor: '#16B979',
  shortColor: '#F23645',
};

export function getExchangeThemeMeta(exchange: ExchangeType): ExchangeThemeMeta {
  return exchange === 'MEXC' ? MEXC_META : BINANCE_META;
}

export function getExchangeThemeAttr(exchange: ExchangeType): ExchangeThemeKey {
  return getExchangeThemeMeta(exchange).themeKey;
}

export function getExchangeVaultVenue(
  exchange: ExchangeType,
): Extract<ApiKeyRecord['venue'], 'Binance Futures' | 'MEXC Futures'> {
  return getExchangeThemeMeta(exchange).venueName;
}

export function filterApiKeysForExchange(
  apiKeys: ApiKeyRecord[],
  exchange: ExchangeType,
): ApiKeyRecord[] {
  const target = exchange.toUpperCase();
  return apiKeys.filter((k) => (k.venue || '').toUpperCase().includes(target));
}
