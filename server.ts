import 'dotenv/config';
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {WebSocket, WebSocketServer} from 'ws';
import type {ExchangeType, FirebaseExchangeKeyRecord} from './src/types/trading.ts';
import {
  deleteExchangeKeyFromRtdb,
  encodeUsernameKey,
  putExchangeKeyInRtdb,
  readExchangeKeysFromRtdb,
} from './src/services/firebaseRtdb.ts';
import {AutonomousExecutionEngine} from './server/autonomousEngine.ts';
import {
  purgeStaleFirebaseRecords,
  syncBotPositionsForUser,
  syncLiveWalletBalanceForUser,
} from './server/exchangePositions.ts';
import {syncHistoricalMarketData} from './server/historicalSync.ts';
import {marketIngestion} from './server/marketIngestion.ts';
import {marketScanner} from './server/marketScanner.ts';
import {encryptExchangeKeysServer, maskApiKey} from './server/vaultCrypto.ts';
import {
  executeSignedOrderForUser,
  getServerRtdbUrl,
  handleWebhookDispatch,
  type IncomingWebhookPayload,
} from './server/webhookEngine.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const autonomousEngine = new AutonomousExecutionEngine(marketIngestion);

export function createApp() {
  const app = express();
  app.use(express.json({limit: '1mb'}));

  app.get('/api/health', (_req, res) => {
    const snap = marketIngestion.getSnapshot();
    res.json({
      ok: true,
      service: 'makka-footprint-bot-engine',
      wsConnected: snap?.wsConnected ?? false,
      activeStream: marketIngestion.getActiveKey(),
      ticksBuffered: snap?.ticksBuffered ?? 0,
      timestamp: Date.now(),
    });
  });

  // Historical Data & Back-Sync Endpoint (Binance + MEXC Futures)
  app.get('/api/market/history', async (req, res) => {
    const symbol = String(req.query.symbol || 'BTCUSDT')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '');
    const interval = String(req.query.interval || '15m');
    const exchangeRaw = String(req.query.exchange || 'BINANCE').toUpperCase();
    const exchange: ExchangeType = exchangeRaw.includes('MEXC') ? 'MEXC' : 'BINANCE';

    try {
      const result = await syncHistoricalMarketData(symbol, exchange, interval);
      res.json({ok: true, ...result});
    } catch (err) {
      res.status(502).json({
        ok: false,
        error: `Historical sync failed: ${(err as Error).message}`,
      });
    }
  });

  // Switch Persistent WebSocket Stream + Trigger Immediate Historical Back-Sync
  app.post('/api/market/subscribe', async (req, res) => {
    const body = (req.body || {}) as {
      symbol?: string;
      interval?: string;
      exchange?: string;
      stopLossPercent?: number;
    };
    const symbol = String(body.symbol || 'BTCUSDT')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '');
    const interval = String(body.interval || '15m');
    const exchange: ExchangeType = String(body.exchange || 'BINANCE')
      .toUpperCase()
      .includes('MEXC')
      ? 'MEXC'
      : 'BINANCE';

    if (typeof body.stopLossPercent === 'number') {
      marketIngestion.setStopLossPercent(body.stopLossPercent);
    }

    try {
      marketScanner.lockOnSymbol(exchange, symbol);
      const snapshot = await marketIngestion.switchStream(exchange, symbol, interval);
      res.json({ok: true, snapshot});
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: `Stream switch failed: ${(err as Error).message}`,
      });
    }
  });

  // Step-by-Step Institutional Exchange Connection & All-Coin Perpetuals Discovery
  app.post('/api/exchange/connect', async (req, res) => {
    const body = (req.body || {}) as {
      exchange?: string;
      symbol?: string;
      interval?: string;
    };
    const exchange: ExchangeType = String(body.exchange || 'BINANCE')
      .toUpperCase()
      .includes('MEXC')
      ? 'MEXC'
      : 'BINANCE';
    const symbol = String(body.symbol || 'BTCUSDT')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '');
    const interval = String(body.interval || '15m');

    try {
      const [discovery, snapshot] = await Promise.all([
        marketScanner.connectAndDiscover(exchange, symbol),
        marketIngestion.switchStream(exchange, symbol, interval),
      ]);
      res.json({
        ok: true,
        telemetry: discovery.telemetry,
        pairs: discovery.pairs,
        filteredSetups: discovery.filteredSetups,
        snapshot,
      });
    } catch (err) {
      res.status(502).json({
        ok: false,
        error: `Exchange connection sequence failed: ${(err as Error).message}`,
      });
    }
  });

  // 2-Stage All-Coin Market Scanner State (Stage 1 Discovery + Stage 2 Deep Lock-On)
  app.get('/api/market/scanner', async (req, res) => {
    const exchange: ExchangeType = String(req.query.exchange || 'BINANCE')
      .toUpperCase()
      .includes('MEXC')
      ? 'MEXC'
      : 'BINANCE';

    try {
      const state = marketScanner.getScannerState(exchange);
      if (state.pairs.length === 0) {
        const discovered = await marketScanner.connectAndDiscover(exchange, 'BTCUSDT');
        res.json({
          ok: true,
          telemetry: discovered.telemetry,
          pairs: discovered.pairs,
          stage2Symbols: discovered.telemetry.stage2Symbols,
          filteredSetups: discovered.filteredSetups,
        });
        return;
      }
      res.json({ok: true, ...state});
    } catch (err) {
      res.status(502).json({
        ok: false,
        error: `Scanner fetch failed: ${(err as Error).message}`,
      });
    }
  });

  // Stage 2 Deep L1/L2/Synthetic L3 Lock-On
  app.post('/api/market/lockon', async (req, res) => {
    const body = (req.body || {}) as {
      exchange?: string;
      symbol?: string;
      interval?: string;
    };
    const exchange: ExchangeType = String(body.exchange || 'BINANCE')
      .toUpperCase()
      .includes('MEXC')
      ? 'MEXC'
      : 'BINANCE';
    const symbol = String(body.symbol || 'BTCUSDT')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '');
    const interval = String(body.interval || '15m');

    try {
      const stage2Symbols = marketScanner.lockOnSymbol(exchange, symbol);
      const snapshot = await marketIngestion.switchStream(exchange, symbol, interval);
      res.json({ok: true, stage2Symbols, snapshot});
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: `Stage 2 lock-on failed: ${(err as Error).message}`,
      });
    }
  });

  // Autonomous Engine Evaluation & Zero-Click Execution Trigger
  app.post('/api/engine/evaluate', async (req, res) => {
    const body = (req.body || {}) as {
      username?: string;
      forceDispatch?: boolean;
      slPercentOverride?: number;
    };
    try {
      const result = await autonomousEngine.evaluateAndExecute({
        targetUsername: body.username?.trim() || undefined,
        forceDispatch: Boolean(body.forceDispatch),
        slPercentOverride: body.slPercentOverride,
      });
      res.json({ok: true, ...result});
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: `Autonomous evaluation failed: ${(err as Error).message}`,
      });
    }
  });

  // Persistent Exchange Keys Vault: /users/{username}/exchangeKeys
  app.get('/api/vault/keys', async (req, res) => {
    const username = String(req.query.username || '').trim();
    if (!username) {
      res.status(400).json({ok: false, error: 'Missing username query parameter'});
      return;
    }

    try {
      const rtdbUrl = getServerRtdbUrl();
      const keysMap = await readExchangeKeysFromRtdb(rtdbUrl, username);
      const keys = keysMap ? Object.values(keysMap).filter(Boolean) : [];
      res.json({
        ok: true,
        hasKeys: keys.length > 0,
        keys,
      });
    } catch (err) {
      res.status(502).json({
        ok: false,
        error: `Failed to read exchange keys: ${(err as Error).message}`,
      });
    }
  });

  app.post('/api/vault/keys', async (req, res) => {
    const body = (req.body || {}) as {
      username?: string;
      venue?: FirebaseExchangeKeyRecord['venue'];
      label?: string;
      apiKey?: string;
      apiSecret?: string;
    };

    const username = String(body.username || '').trim();
    const venue = body.venue || 'Binance Futures';
    const apiKey = String(body.apiKey || '').trim();
    const apiSecret = String(body.apiSecret || '').trim();

    if (!username || !apiKey || !apiSecret) {
      res.status(400).json({
        ok: false,
        error: 'Username, Exchange API Key, and API Secret are required.',
      });
      return;
    }

    try {
      const rtdbUrl = getServerRtdbUrl();
      const exchange: ExchangeType = venue.toUpperCase().includes('MEXC') ? 'MEXC' : 'BINANCE';
      const id = exchange;
      const record: FirebaseExchangeKeyRecord = {
        id,
        venue,
        exchange,
        label: String(body.label || venue).trim() || venue,
        maskedKey: maskApiKey(apiKey),
        encryptedPayload: encryptExchangeKeysServer(apiKey, apiSecret),
        autoTradeEnabled: true,
        updatedAt: new Date().toISOString(),
      };

      // Write to canonical /users/{username}/exchangeKeys/{activeExchange} node & clean legacy alias
      await putExchangeKeyInRtdb(rtdbUrl, username, id, record);
      await deleteExchangeKeyFromRtdb(rtdbUrl, username, `key-${exchange.toLowerCase()}`).catch(
        () => null,
      );

      const userKey = encodeUsernameKey(username);
      await fetch(`${rtdbUrl}/bot_settings/${userKey}.json`, {
        method: 'PATCH',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          autoTrade: true,
          activeExchange: exchange,
          tradingMode: 'LIVE',
          updatedAt: Date.now(),
        }),
        signal: AbortSignal.timeout(4500),
      }).catch(() => null);

      // Immediately fetch real live exchange USDT balance & margin using the newly stored encrypted key
      const wallet = await syncLiveWalletBalanceForUser({username, exchange, rtdbUrl}).catch(
        () => null,
      );

      res.json({
        ok: true,
        record,
        wallet,
      });
    } catch (err) {
      res.status(502).json({
        ok: false,
        error: `Failed to encrypt & store API key: ${(err as Error).message}`,
      });
    }
  });

  app.delete('/api/vault/keys/:id', async (req, res) => {
    const username = String(req.query.username || '').trim();
    const keyId = String(req.params.id || '').trim();
    if (!username || !keyId) {
      res.status(400).json({ok: false, error: 'Username and key ID are required.'});
      return;
    }

    try {
      const rtdbUrl = getServerRtdbUrl();
      await deleteExchangeKeyFromRtdb(rtdbUrl, username, keyId);
      res.json({ok: true});
    } catch (err) {
      res.status(502).json({
        ok: false,
        error: `Failed to remove API key: ${(err as Error).message}`,
      });
    }
  });

  // 100% Automated Zero-Intervention MSNR / TradingView Webhook Receiver
  app.post('/api/webhook', async (req, res) => {
    const payload = (req.body || {}) as IncomingWebhookPayload;
    const configuredSecret = process.env.WEBHOOK_SECRET?.trim();
    if (configuredSecret) {
      const headerSecret = String(req.headers['x-webhook-secret'] || '').trim();
      const bodySecret = String(payload.secret || '').trim();
      if (headerSecret !== configuredSecret && bodySecret !== configuredSecret) {
        res.status(401).json({ok: false, error: 'Unauthorized webhook secret'});
        return;
      }
    }

    try {
      const dispatch = await handleWebhookDispatch(payload, {validateLivePrice: true});
      res.json(dispatch);
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: `Webhook execution failed: ${(err as Error).message}`,
      });
    }
  });

  // Live Exchange Wallet Balance & Available Margin Sync (Binance / MEXC Real USDT Balance)
  app.post('/api/exchange/wallet', async (req, res) => {
    const body = (req.body || {}) as {
      username?: string;
      exchange?: string;
    };
    const username = String(body.username || '').trim();
    if (!username) {
      res.status(400).json({ok: false, error: 'Missing username'});
      return;
    }
    const exchange: ExchangeType = String(body.exchange || 'BINANCE')
      .toUpperCase()
      .includes('MEXC')
      ? 'MEXC'
      : 'BINANCE';

    try {
      const wallet = await syncLiveWalletBalanceForUser({username, exchange});
      res.json(wallet);
    } catch (err) {
      res.status(500).json({
        ok: false,
        connected: false,
        exchange,
        asset: 'USDT',
        totalWalletBalance: 0,
        availableBalance: 0,
        unrealizedPnl: 0,
        error: `Live wallet sync failed: ${(err as Error).message}`,
        syncedAt: Date.now(),
      });
    }
  });

  // Firebase Stale / Unexecuted Records Auto-Cleanup
  app.post('/api/firebase/cleanup', async (req, res) => {
    const body = (req.body || {}) as {
      username?: string;
      sessionStartedAt?: number;
    };
    const username = String(body.username || '').trim();
    if (!username) {
      res.status(400).json({ok: false, error: 'Missing username'});
      return;
    }
    try {
      const result = await purgeStaleFirebaseRecords({
        username,
        sessionStartedAt: body.sessionStartedAt,
      });
      res.json(result);
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: `Firebase cleanup failed: ${(err as Error).message}`,
      });
    }
  });

  // Strict Bot-Only Position Isolation Sync (ignores manual exchange positions)
  app.post('/api/exchange/sync-positions', async (req, res) => {
    const body = (req.body || {}) as {
      username?: string;
      exchange?: string;
    };
    const username = String(body.username || '').trim();
    if (!username) {
      res.status(400).json({ok: false, error: 'Missing username'});
      return;
    }
    const exchange: ExchangeType = String(body.exchange || 'BINANCE')
      .toUpperCase()
      .includes('MEXC')
      ? 'MEXC'
      : 'BINANCE';

    try {
      const result = await syncBotPositionsForUser({username, exchange});
      res.json(result);
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: `Exchange position sync failed: ${(err as Error).message}`,
      });
    }
  });

  // Signed Futures Order Execution / Close / Leverage Update (routed exclusively via Fixie SOCKS5 when configured)
  app.post('/api/exchange/order', async (req, res) => {
    const body = (req.body || {}) as {
      username?: string;
      exchange?: string;
      action?: 'OPEN' | 'CLOSE' | 'SET_LEVERAGE';
      symbol?: string;
      side?: 'LONG' | 'SHORT';
      orderType?: 'MARKET' | 'LIMIT';
      quantity?: number;
      price?: number;
      leverage?: number;
      syncLeverage?: boolean;
    };
    const username = String(body.username || '').trim();
    const symbol = String(body.symbol || '').trim();
    if (!username || !symbol) {
      res.status(400).json({ok: false, error: 'Username and symbol are required.'});
      return;
    }
    const exchange: ExchangeType = String(body.exchange || 'BINANCE')
      .toUpperCase()
      .includes('MEXC')
      ? 'MEXC'
      : 'BINANCE';
    const action: 'OPEN' | 'CLOSE' | 'SET_LEVERAGE' =
      body.action === 'CLOSE' || body.action === 'SET_LEVERAGE' ? body.action : 'OPEN';

    try {
      const result = await executeSignedOrderForUser({
        username,
        exchange,
        action,
        symbol,
        side: body.side,
        orderType: body.orderType,
        quantity: body.quantity,
        price: body.price,
        leverage: body.leverage,
        syncLeverage: body.syncLeverage,
      });
      res.status(result.ok ? 200 : 400).json(result);
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: `Signed Futures action failed: ${(err as Error).message}`,
      });
    }
  });

  return app;
}

function attachMarketWebSocket(httpServer: http.Server): void {
  const wss = new WebSocketServer({noServer: true});

  const broadcast = (event: string, data: unknown) => {
    if (wss.clients.size === 0) return;
    const frame = JSON.stringify({event, data, ts: Date.now()});
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(frame);
      }
    }
  };

  let lastTickEmit = 0;
  marketIngestion.on('tick', (payload: {snapshot: unknown}) => {
    const now = Date.now();
    if (now - lastTickEmit < 250) return;
    lastTickEmit = now;
    broadcast('market:snapshot', payload.snapshot);
  });
  marketIngestion.on('snapshot', (snapshot: unknown) => {
    broadcast('market:snapshot', snapshot);
  });
  marketIngestion.on('analysis', (payload: {snapshot: unknown}) => {
    broadcast('market:snapshot', payload.snapshot);
  });
  marketIngestion.on('filtered', (filteredSignal: unknown) => {
    broadcast('signal:filtered', filteredSignal);
  });
  autonomousEngine.on('execution', (dispatch: unknown) => {
    broadcast('execution:auto', dispatch);
  });

  wss.on('connection', (socket) => {
    const snap = marketIngestion.getSnapshot();
    if (snap) {
      socket.send(JSON.stringify({event: 'market:snapshot', data: snap, ts: Date.now()}));
    }
    socket.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as {
          action?: string;
          symbol?: string;
          interval?: string;
          exchange?: ExchangeType;
        };
        if (msg.action === 'subscribe' && msg.symbol && msg.interval && msg.exchange) {
          void marketIngestion.switchStream(msg.exchange, msg.symbol, msg.interval);
        }
      } catch {
        // Ignore invalid WS messages
      }
    });
  });

  httpServer.on('upgrade', (request, socket, head) => {
    const urlPath = (request.url || '').split('?')[0];
    if (urlPath === '/ws/market') {
      wss.handleUpgrade(request, socket, head, (wsClient) => {
        wss.emit('connection', wsClient, request);
      });
    } else {
      socket.destroy();
    }
  });
}

async function startServer() {
  const app = createApp();
  const port = Number(process.env.PORT) || 3000;
  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    process.env.DISABLE_HMR = 'true';
    const {createServer: createViteServer} = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
        ws: false,
      },
      appType: 'spa',
    });

    // Serve clean no-op /@vite/client shim while HMR is disabled so Vite 8 emits 0 WS errors.
    app.get('/@vite/client', (_req, res) => {
      res.type('application/javascript').send(`const sheetsMap = new Map();
export function updateStyle(id, content) {
  let style = sheetsMap.get(id);
  if (!style) {
    style = document.createElement('style');
    style.setAttribute('type', 'text/css');
    style.setAttribute('data-vite-dev-id', id);
    style.textContent = content;
    document.head.appendChild(style);
    sheetsMap.set(id, style);
  } else {
    style.textContent = content;
  }
}
export function removeStyle(id) {
  const style = sheetsMap.get(id);
  if (style) {
    document.head.removeChild(style);
    sheetsMap.delete(id);
  }
}
export function createHotContext() {
  return {
    data: {},
    accept() {},
    acceptExports() {},
    dispose() {},
    prune() {},
    decline() {},
    invalidate() {},
    on() {},
    off() {},
    send() {},
  };
}
export function injectQuery(url) {
  return url;
}
`);
    });

    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const httpServer = http.createServer(app);
  attachMarketWebSocket(httpServer);

  autonomousEngine.start();
  void marketIngestion.initialize('BINANCE', 'BTCUSDT', '15m');

  httpServer.listen(port, '0.0.0.0', () => {
    console.log(`Makka Footprint Bot server listening on http://0.0.0.0:${port}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
