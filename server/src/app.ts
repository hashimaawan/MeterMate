/**
 * Express application factory. Kept separate from `index.ts` so tests can mount
 * the app with supertest without starting a listening server.
 */
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import { createLogger } from './logger.js';
import { metaRouter } from './routes/meta.js';
import { bookRouter } from './routes/book.js';
import { usageRouter } from './routes/usage.js';
import { planChangeRouter } from './routes/planChange.js';
import { lifecycleRouter } from './routes/lifecycle.js';
import { invoicesRouter } from './routes/invoices.js';

const log = createLogger('app');

export function createApp(): Express {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: '256kb' }));

  // Mount API routes under /api.
  app.use('/api', metaRouter);
  app.use('/api', bookRouter);
  app.use('/api', usageRouter);
  app.use('/api', planChangeRouter);
  app.use('/api', lifecycleRouter);
  app.use('/api', invoicesRouter);

  // 404 for unknown API routes.
  app.use('/api', (_req: Request, res: Response) => {
    res.status(404).json({ status: 'invalid', error: 'Not found' });
  });

  // Centralized error handler — catches malformed JSON and unexpected throws.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err && typeof err === 'object' && 'type' in err && (err as { type?: string }).type === 'entity.parse.failed') {
      res.status(400).json({ status: 'invalid', error: 'Malformed JSON body' });
      return;
    }
    log.error('Unhandled error', { error: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ status: 'invalid', error: 'Internal server error' });
  });

  return app;
}
