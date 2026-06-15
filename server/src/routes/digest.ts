/**
 * UC6 — Billing Activity Digest (admin only).  POST /api/digest
 *
 * Per-consultant, not per-transaction. Scopes the consultant's subscriptions via
 * the transaction store (consultant is a MeterMate label), aggregates live Maxio
 * figures, posts to the configured digest channel (if any), and returns the
 * digest for the admin UI.
 */
import { Router, type Request, type Response } from 'express';
import { createLogger } from '../logger.js';
import { config } from '../config.js';
import { adminGuard } from '../auth.js';
import { digestRequestSchema } from '../schemas/digest.js';
import { sessionStore } from '../stores/sessionStore.js';
import { transactionStore } from '../stores/transactionStore.js';
import { buildDigest } from '../services/maxioService.js';
import { MaxioServiceError } from '../maxioClient.js';
import { postDigest } from '../services/slackService.js';
import { buildDigest as buildDigestBlocks } from '../services/slack/blocks.js';

const log = createLogger('route:digest');

export const digestRouter = Router();

digestRouter.post('/digest', adminGuard, async (req: Request, res: Response) => {
  const parsed = digestRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      status: 'invalid',
      errors: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
    });
  }
  const input = parsed.data;

  const consultant = config.consultants.find((c) => c.id === input.consultantId);
  if (!consultant) {
    return res.status(400).json({
      status: 'invalid',
      errors: [{ field: 'consultantId', message: 'Unknown consultant' }],
    });
  }

  sessionStore.ensure(input.sessionId);

  // Scope to this consultant's tracked subscriptions (unique ids).
  const subscriptionIds = [
    ...new Set(
      transactionStore
        .listByConsultant(consultant.id)
        .map((t) => t.subscriptionId)
        .filter((id): id is number => id !== null),
    ),
  ];

  try {
    const aggregate = await buildDigest({ subscriptionIds, windowDays: input.windowDays });

    const blocks = buildDigestBlocks({
      consultantName: consultant.name,
      windowDays: input.windowDays,
      activeCount: aggregate.activeCount,
      mrr: aggregate.mrrFormatted,
      newSignups: aggregate.newSignups,
      churn: aggregate.churn,
      openInvoices: aggregate.openInvoices,
      outstanding: aggregate.outstandingFormatted,
    });
    const postedChannel = await postDigest(blocks);

    const digest = {
      consultantId: consultant.id,
      consultantName: consultant.name,
      windowDays: input.windowDays,
      ...aggregate,
      postedToChannel: postedChannel,
      note:
        'Reporting data is for reconciliation, not real-time confirmation; counts may lag live state slightly. Scope is limited to subscriptions created in this server session.',
    };

    return res.status(200).json({ status: 'ok', digest });
  } catch (err) {
    const reason = err instanceof MaxioServiceError ? err.detail : err instanceof Error ? err.message : String(err);
    log.error('Digest build failed', { consultantId: consultant.id, reason });
    return res.status(502).json({ status: 'maxio_failed', error: reason });
  }
});
