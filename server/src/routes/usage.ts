/**
 * UC2 — Report Session Usage.  POST /api/usage
 *
 * Flow (plan UC2):
 *   validate → resolve existing transaction + its channel → post "recording" →
 *   maxioService.recordUsage (metered) → post "usage recorded" with the running
 *   period total → JSON.
 *
 * Reuses the transaction channel created by UC1 (no new channel). A missing /
 * expired transaction returns 409. Slack failures never block the response.
 */
import { Router, type Request, type Response } from 'express';
import { createLogger } from '../logger.js';
import { usageRequestSchema } from '../schemas/usage.js';
import { sessionStore } from '../stores/sessionStore.js';
import { transactionStore } from '../stores/transactionStore.js';
import { recordUsage } from '../services/maxioService.js';
import { MaxioServiceError } from '../maxioClient.js';
import { ensureTxnChannel, postBlocks } from '../services/slackService.js';
import {
  buildUsageRecording,
  buildUsageRecorded,
  buildFailure,
} from '../services/slack/blocks.js';

const log = createLogger('route:usage');

export const usageRouter = Router();

usageRouter.post('/usage', async (req: Request, res: Response) => {
  // 1. Validate before any external call.
  const parsed = usageRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      status: 'invalid',
      errors: parsed.error.issues.map((i) => ({
        field: i.path.join('.'),
        message: i.message,
      })),
    });
  }
  const input = parsed.data;

  // 2. Resolve the existing transaction for this pairing.
  const txn = transactionStore.get(input.txnRef);
  if (!txn) {
    return res.status(409).json({
      status: 'session_expired',
      error: 'Transaction not found or expired. Please start a new booking.',
    });
  }
  if (!txn.subscriptionId) {
    return res.status(400).json({
      status: 'invalid',
      errors: [
        { field: 'txnRef', message: 'This transaction has no active subscription yet.' },
      ],
    });
  }

  sessionStore.ensure(input.sessionId);

  // 3. Resolve/reuse the transaction channel and post the "recording" message.
  let channelId: string | null = txn.channelId;
  let channelName: string | null = txn.channelName;
  try {
    const channel = await ensureTxnChannel(txn);
    channelId = channel.channelId;
    channelName = channel.channelName;
    await postBlocks(
      channelId,
      buildUsageRecording({
        quantity: input.quantity,
        unit: 'units',
        componentLabel: input.componentHandle,
      }),
      'Recording usage',
    );
  } catch (err) {
    log.warn('ensureTxnChannel failed; continuing with billing', {
      txnId: txn.txnId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // 4. Record the usage via Maxio.
  try {
    const result = await recordUsage({
      subscriptionId: txn.subscriptionId,
      componentHandle: input.componentHandle,
      quantity: input.quantity,
      ...(input.memo ? { memo: input.memo } : {}),
    });

    sessionStore.recordResult(input.sessionId, txn.txnId, result);

    if (channelId) {
      await postBlocks(
        channelId,
        buildUsageRecorded({
          componentLabel: `${result.componentName} (${result.componentHandle})`,
          quantity: result.quantityRecorded,
          unit: result.unit,
          periodTotal: result.periodTotal,
        }),
        'Usage recorded',
      );
    }

    return res.status(200).json({
      status: 'ok',
      txnId: txn.txnId,
      channelId,
      channelName,
      usage: result,
    });
  } catch (err) {
    const reason =
      err instanceof MaxioServiceError
        ? err.detail
        : err instanceof Error
          ? err.message
          : String(err);

    transactionStore.update(txn.txnId, { lastError: reason });

    if (channelId) {
      await postBlocks(channelId, buildFailure({ useCase: 'Usage recording', reason }), 'Usage recording failed');
    }

    log.error('Usage recording failed', { txnId: txn.txnId, reason });
    return res.status(502).json({
      status: 'maxio_failed',
      txnId: txn.txnId,
      channelId,
      channelName,
      error: reason,
    });
  }
});
