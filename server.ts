import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import type {ExchangeType, FirebaseExchangeKeyRecord} from './src/types/trading.ts';
import {
  deleteExchangeKeyFromRtdb,
  encodeUsernameKey,
  putExchangeKeyInRtdb,
  readExchangeKeysFromRtdb,
} from './src/services/firebaseRtdb.ts';
import {encryptExchangeKeysServer, maskApiKey} from './server/vaultCrypto.ts';
import {
  getServerRtdbUrl,
  handleWebhookDispatch,
  type IncomingWebhookPayload,
} from './server/webhookEngine.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function createApp() {
  const app = express();
  app.use(express.json({limit: '1mb'}));

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      service: 'makka-footprint-bot-engine',
      timestamp: Date.now(),
    });
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
      const id = `key-${exchange.toLowerCase()}`;
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

      await putExchangeKeyInRtdb(rtdbUrl, username, id, record);

      // Ensure headless auto-trade preference is initialized on /bot_settings/{username}
      const userKey = encodeUsernameKey(username);
      await fetch(`${rtdbUrl}/bot_settings/${userKey}.json`, {
        method: 'PATCH',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          autoTrade: true,
          activeExchange: exchange,
          updatedAt: Date.now(),
        }),
        signal: AbortSignal.timeout(4500),
      }).catch(() => null);

      res.json({
        ok: true,
        record,
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
      const dispatch = await handleWebhookDispatch(payload);
      res.json(dispatch);
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: `Webhook execution failed: ${(err as Error).message}`,
      });
    }
  });

  return app;
}

async function startServer() {
  const app = createApp();
  const port = Number(process.env.PORT) || 3000;
  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    const {createServer: createViteServer} = await import('vite');
    const vite = await createViteServer({
      server: {middlewareMode: true},
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(`Makka Footprint Bot server listening on http://0.0.0.0:${port}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
