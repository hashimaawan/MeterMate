/**
 * Meta/support routes:
 *   GET /api/health      — liveness + dependency snapshot
 *   GET /api/products    — plan dropdown (live from Maxio)
 *   GET /api/consultants — consultant dropdown (seeded from env)
 */
import { Router, type Request, type Response } from 'express';
import { config } from '../config.js';
import { createLogger } from '../logger.js';
import { sessionStore } from '../stores/sessionStore.js';
import { transactionStore } from '../stores/transactionStore.js';
import { listPlans } from '../services/maxioService.js';
import { slackHealthCheck } from '../services/slackService.js';
import { METERED_COMPONENTS, formatUnitPrice } from '../catalog.js';
import { adminGuard } from '../auth.js';

const log = createLogger('route:meta');

export const metaRouter = Router();

metaRouter.get('/health', async (_req: Request, res: Response) => {
  let slackOk = false;
  try {
    slackOk = await slackHealthCheck();
  } catch (err) {
    log.warn('Slack health check threw', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
  res.status(200).json({
    status: 'ok',
    sessions: sessionStore.size(),
    transactions: transactionStore.size(),
    maxioSite: config.maxio.siteSubdomain,
    slackOk,
  });
});

metaRouter.get('/products', async (_req: Request, res: Response) => {
  try {
    const plans = await listPlans();
    res.status(200).json({ status: 'ok', products: plans });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    log.error('Failed to list products', { reason });
    res.status(502).json({ status: 'maxio_failed', error: reason });
  }
});

metaRouter.get('/components', (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    components: METERED_COMPONENTS.map((c) => ({
      handle: c.handle,
      name: c.name,
      unitName: c.unitName,
      priceFormatted: formatUnitPrice(c),
      kind: 'metered',
    })),
  });
});

/** Admin credential check — used by the SPA's admin login gate. */
metaRouter.get('/admin/check', adminGuard, (_req: Request, res: Response) => {
  res.status(200).json({ status: 'ok' });
});

metaRouter.get('/consultants', (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    consultants: config.consultants.map((c) => ({ id: c.id, name: c.name })),
  });
});
