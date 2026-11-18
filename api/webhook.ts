import type {IncomingWebhookPayload} from '../server/webhookEngine.ts';
import {handleWebhookDispatch} from '../server/webhookEngine.ts';

interface VercelLikeRequest {
  method?: string;
  body?: unknown;
  headers?: Record<string, string | string[] | undefined>;
}

interface VercelLikeResponse {
  status: (code: number) => VercelLikeResponse;
  json: (payload: unknown) => void;
}

export default async function handler(req: VercelLikeRequest, res: VercelLikeResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ok: false, error: 'Method Not Allowed. Send POST.'});
    return;
  }

  const payload = ((typeof req.body === 'string' ? JSON.parse(req.body) : req.body) ||
    {}) as IncomingWebhookPayload;

  const configuredSecret = process.env.WEBHOOK_SECRET?.trim();
  if (configuredSecret) {
    const headerSecretRaw = req.headers?.['x-webhook-secret'];
    const headerSecret = Array.isArray(headerSecretRaw)
      ? headerSecretRaw[0]
      : String(headerSecretRaw || '');
    const bodySecret = String(payload.secret || '');
    if (headerSecret.trim() !== configuredSecret && bodySecret.trim() !== configuredSecret) {
      res.status(401).json({ok: false, error: 'Unauthorized webhook secret'});
      return;
    }
  }

  try {
    const dispatch = await handleWebhookDispatch(payload);
    res.status(200).json(dispatch);
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: `Webhook execution failed: ${(err as Error).message}`,
    });
  }
}
