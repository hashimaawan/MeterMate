/**
 * UC3 — Plan Change (Upgrade / Downgrade with Proration Preview).
 *   POST /api/plan-change/preview   → prorated cost preview (no change applied)
 *   POST /api/plan-change           → apply (prorate now | schedule at renewal)
 *
 * Both resolve the existing transaction + its channel, post a narrative message,
 * and isolate Slack failures from the billing result (plan §6).
 */
import { Router, type Request, type Response } from 'express';
import { createLogger } from '../logger.js';
import { planChangePreviewSchema, planChangeSchema } from '../schemas/planChange.js';
import { sessionStore } from '../stores/sessionStore.js';
import { transactionStore } from '../stores/transactionStore.js';
import {
  previewPlanChange,
  applyPlanChange,
  readSubscriptionPlan,
} from '../services/maxioService.js';
import { MaxioServiceError } from '../maxioClient.js';
import { ensureTxnChannel, postBlocks } from '../services/slackService.js';
import {
  buildPlanChangePreview,
  buildPlanChanged,
  buildFailure,
} from '../services/slack/blocks.js';
import type { TransactionRecord } from '../types.js';

const log = createLogger('route:planChange');

export const planChangeRouter = Router();

/** Resolve a transaction that must exist and carry an active subscription. */
function resolveTxn(
  txnRef: string,
):
  | { ok: true; txn: TransactionRecord }
  | { ok: false; code: 409 | 400; body: Record<string, unknown> } {
  const txn = transactionStore.get(txnRef);
  if (!txn) {
    return {
      ok: false,
      code: 409,
      body: {
        status: 'session_expired',
        error: 'Transaction not found or expired. Please start a new booking.',
      },
    };
  }
  if (!txn.subscriptionId) {
    return {
      ok: false,
      code: 400,
      body: {
        status: 'invalid',
        errors: [{ field: 'txnRef', message: 'This transaction has no active subscription yet.' }],
      },
    };
  }
  return { ok: true, txn };
}

planChangeRouter.post('/plan-change/preview', async (req: Request, res: Response) => {
  const parsed = planChangePreviewSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      status: 'invalid',
      errors: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
    });
  }
  const input = parsed.data;

  const resolved = resolveTxn(input.txnRef);
  if (!resolved.ok) return res.status(resolved.code).json(resolved.body);
  const txn = resolved.txn;
  const subscriptionId = txn.subscriptionId as number;

  sessionStore.ensure(input.sessionId);

  try {
    const [oldPlan, preview] = await Promise.all([
      readSubscriptionPlan(subscriptionId),
      previewPlanChange({ subscriptionId, targetHandle: input.targetHandle }),
    ]);

    // Resolve/reuse channel and post the preview narrative (non-fatal).
    let channelId: string | null = txn.channelId;
    let channelName: string | null = txn.channelName;
    try {
      const channel = await ensureTxnChannel(txn);
      channelId = channel.channelId;
      channelName = channel.channelName;
      await postBlocks(
        channelId,
        buildPlanChangePreview({
          oldPlanLabel: oldPlan.name,
          newPlanLabel: input.targetHandle,
          paymentDue: preview.paymentDueFormatted,
          proratedAdjustment: preview.proratedAdjustmentFormatted,
          credit: preview.creditAppliedFormatted,
        }),
        'Plan change preview',
      );
    } catch (err) {
      log.warn('ensureTxnChannel failed during preview; continuing', {
        txnId: txn.txnId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    return res.status(200).json({
      status: 'ok',
      txnId: txn.txnId,
      channelId,
      channelName,
      preview: { ...preview, currentPlanHandle: oldPlan.handle, currentPlanName: oldPlan.name },
    });
  } catch (err) {
    const reason = err instanceof MaxioServiceError ? err.detail : err instanceof Error ? err.message : String(err);
    log.error('Plan change preview failed', { txnId: txn.txnId, reason });
    return res.status(502).json({ status: 'maxio_failed', txnId: txn.txnId, error: reason });
  }
});

planChangeRouter.post('/plan-change', async (req: Request, res: Response) => {
  const parsed = planChangeSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      status: 'invalid',
      errors: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
    });
  }
  const input = parsed.data;

  const resolved = resolveTxn(input.txnRef);
  if (!resolved.ok) return res.status(resolved.code).json(resolved.body);
  const txn = resolved.txn;
  const subscriptionId = txn.subscriptionId as number;

  sessionStore.ensure(input.sessionId);

  // Resolve/reuse the channel up front so failure messages have somewhere to go.
  let channelId: string | null = txn.channelId;
  let channelName: string | null = txn.channelName;
  try {
    const channel = await ensureTxnChannel(txn);
    channelId = channel.channelId;
    channelName = channel.channelName;
  } catch (err) {
    log.warn('ensureTxnChannel failed during plan change; continuing', {
      txnId: txn.txnId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  try {
    const result = await applyPlanChange({
      subscriptionId,
      targetHandle: input.targetHandle,
      timing: input.timing,
    });

    transactionStore.update(txn.txnId, { type: 'plan-change', lastError: null });
    sessionStore.recordResult(input.sessionId, txn.txnId, result);

    const effectiveLabel = result.effectiveDate
      ? new Date(result.effectiveDate).toISOString().slice(0, 10)
      : 'Immediately';

    if (channelId) {
      await postBlocks(
        channelId,
        buildPlanChanged({
          oldPlanLabel: result.oldPlanName,
          newPlanLabel: result.newPlanName,
          prorated: result.prorated,
          effective: effectiveLabel,
          manageUrl: result.manageUrl,
        }),
        'Plan changed',
      );
    }

    return res.status(200).json({
      status: 'ok',
      txnId: txn.txnId,
      channelId,
      channelName,
      planChange: result,
    });
  } catch (err) {
    const reason = err instanceof MaxioServiceError ? err.detail : err instanceof Error ? err.message : String(err);
    transactionStore.update(txn.txnId, { lastError: reason });
    if (channelId) {
      await postBlocks(channelId, buildFailure({ useCase: 'Plan change', reason }), 'Plan change failed');
    }
    log.error('Plan change failed', { txnId: txn.txnId, reason });
    return res.status(502).json({ status: 'maxio_failed', txnId: txn.txnId, channelId, channelName, error: reason });
  }
});
