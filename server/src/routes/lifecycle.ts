/**
 * UC4 — Lifecycle Control (pause / resume / cancel / reactivate).
 *   POST /api/lifecycle
 *
 * Resolves the existing transaction + channel, posts an in-progress message,
 * dispatches to the matching Maxio lifecycle operation, then posts the state
 * transition. Slack failures never block the billing result (plan §6).
 */
import { Router, type Request, type Response } from 'express';
import { createLogger } from '../logger.js';
import { lifecycleRequestSchema } from '../schemas/lifecycle.js';
import { sessionStore } from '../stores/sessionStore.js';
import { transactionStore } from '../stores/transactionStore.js';
import { lifecycleAction, type CancelType } from '../services/maxioService.js';
import { MaxioServiceError } from '../maxioClient.js';
import { ensureTxnChannel, postBlocks } from '../services/slackService.js';
import {
  buildLifecycleInProgress,
  buildLifecycleDone,
  buildFailure,
} from '../services/slack/blocks.js';

const log = createLogger('route:lifecycle');

export const lifecycleRouter = Router();

lifecycleRouter.post('/lifecycle', async (req: Request, res: Response) => {
  const parsed = lifecycleRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      status: 'invalid',
      errors: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
    });
  }
  const input = parsed.data;

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
      errors: [{ field: 'txnRef', message: 'This transaction has no active subscription yet.' }],
    });
  }

  sessionStore.ensure(input.sessionId);

  const actionLabel =
    input.action === 'cancel' && input.cancelType === 'end-of-period'
      ? 'cancel (at period end)'
      : input.action;

  // Resolve/reuse the channel and post the in-progress message (non-fatal).
  let channelId: string | null = txn.channelId;
  let channelName: string | null = txn.channelName;
  try {
    const channel = await ensureTxnChannel(txn);
    channelId = channel.channelId;
    channelName = channel.channelName;
    await postBlocks(channelId, buildLifecycleInProgress(actionLabel), `${actionLabel} in progress`);
  } catch (err) {
    log.warn('ensureTxnChannel failed during lifecycle; continuing', {
      txnId: txn.txnId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  try {
    const result = await lifecycleAction({
      subscriptionId: txn.subscriptionId,
      action: input.action,
      ...(input.cancelType ? { cancelType: input.cancelType as CancelType } : {}),
      ...(input.reasonCode ? { reason: input.reasonCode } : {}),
    });

    transactionStore.update(txn.txnId, { type: 'lifecycle', lastError: null });
    sessionStore.recordResult(input.sessionId, txn.txnId, result);

    const transition = `${result.previousState} → ${result.newState}${result.scheduled ? ' (scheduled)' : ''}`;
    const effective = result.effectiveDate
      ? new Date(result.effectiveDate).toISOString().slice(0, 10)
      : 'Immediately';

    if (channelId) {
      await postBlocks(
        channelId,
        buildLifecycleDone({
          transition,
          reason: result.reason,
          effective,
          manageUrl: result.manageUrl,
        }),
        'Lifecycle updated',
      );
    }

    return res.status(200).json({
      status: 'ok',
      txnId: txn.txnId,
      channelId,
      channelName,
      lifecycle: result,
    });
  } catch (err) {
    const reason = err instanceof MaxioServiceError ? err.detail : err instanceof Error ? err.message : String(err);
    transactionStore.update(txn.txnId, { lastError: reason });
    if (channelId) {
      await postBlocks(channelId, buildFailure({ useCase: `Lifecycle (${actionLabel})`, reason }), 'Lifecycle failed');
    }
    log.error('Lifecycle action failed', { txnId: txn.txnId, reason });
    return res.status(502).json({ status: 'maxio_failed', txnId: txn.txnId, channelId, channelName, error: reason });
  }
});
