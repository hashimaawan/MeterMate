/**
 * UC1 — Book & Subscribe.  POST /api/book
 *
 * Flow (plan §1.5 / UC1):
 *   validate → create/resolve transaction → ensureTxnChannel (started) →
 *   maxioService.createSubscription → post completion (or failure) → JSON.
 *
 * Failure isolation (plan §6): a Slack failure never blocks the response; a
 * Maxio failure posts a failure block, marks the txn failed, and returns
 * `maxio_failed` — billing is the source of truth.
 */
import { Router, type Request, type Response } from 'express';
import { createLogger } from '../logger.js';
import { config } from '../config.js';
import { bookRequestSchema } from '../schemas/book.js';
import { sessionStore } from '../stores/sessionStore.js';
import { transactionStore } from '../stores/transactionStore.js';
import { createSubscription } from '../services/maxioService.js';
import { MaxioServiceError } from '../maxioClient.js';
import { ensureTxnChannel, postBlocks } from '../services/slackService.js';
import {
  buildBookingStarted,
  buildSubscriptionActive,
  buildFailure,
} from '../services/slack/blocks.js';

const log = createLogger('route:book');

export const bookRouter = Router();

bookRouter.post('/book', async (req: Request, res: Response) => {
  // 1. Validate before any external call.
  const parsed = bookRequestSchema.safeParse(req.body);
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

  // Resolve the consultant label (must be a known/seeded consultant).
  const consultant = config.consultants.find((c) => c.id === input.consultantId);
  if (!consultant) {
    return res.status(400).json({
      status: 'invalid',
      errors: [{ field: 'consultantId', message: 'Unknown consultant' }],
    });
  }

  // 2. Create or reuse the transaction record for this consultant↔client pair.
  const txn = transactionStore.ensurePairing({
    consultantId: consultant.id,
    consultantName: consultant.name,
    clientEmail: input.email,
    clientName: `${input.firstName} ${input.lastName}`.trim(),
    type: 'subscription',
  });
  sessionStore.ensure(input.sessionId);

  // 3. Ensure the private channel exists (create + invite, or reuse) and post
  //    the "started" narrative. Slack failures here are tolerated (try/catch).
  let channelId: string | null = null;
  let channelName: string | null = null;
  try {
    const channel = await ensureTxnChannel(txn);
    channelId = channel.channelId;
    channelName = channel.channelName;
    await postBlocks(
      channelId,
      buildBookingStarted(input.productHandle),
      'Booking started',
    );
  } catch (err) {
    // Channel creation failed entirely — log and continue; billing still runs.
    log.warn('ensureTxnChannel failed; continuing with billing', {
      txnId: txn.txnId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // 4. Drive the Maxio billing operation.
  try {
    const result = await createSubscription({
      firstName: input.firstName,
      lastName: input.lastName,
      email: input.email,
      productHandle: input.productHandle,
      collectionMethod: input.collectionMethod,
      ...(input.couponCode ? { couponCode: input.couponCode } : {}),
    });

    // 5. Success → update stores + post completion.
    transactionStore.update(txn.txnId, {
      state: 'completed',
      subscriptionId: result.subscriptionId,
      customerId: result.customerId,
      lastError: null,
    });
    sessionStore.recordResult(input.sessionId, txn.txnId, result);

    if (channelId) {
      await postBlocks(
        channelId,
        buildSubscriptionActive({
          customerName: result.customerName,
          customerEmail: result.customerEmail,
          planLabel: `${result.planName} (${result.mrrFormatted}/mo)`,
          mrr: `${result.mrrFormatted} / month`,
          state: result.state,
          nextAssessmentAt: result.nextAssessmentAt,
          manageUrl: result.manageUrl,
        }),
        'Subscription active',
      );
    }

    return res.status(200).json({
      status: 'ok',
      txnId: txn.txnId,
      channelId,
      channelName,
      subscription: result,
    });
  } catch (err) {
    // 6. Failure → mark txn failed, post failure block, return maxio_failed.
    const reason =
      err instanceof MaxioServiceError
        ? err.detail
        : err instanceof Error
          ? err.message
          : String(err);

    transactionStore.update(txn.txnId, { state: 'failed', lastError: reason });

    if (channelId) {
      await postBlocks(
        channelId,
        buildFailure({ useCase: 'Booking', reason }),
        'Booking failed',
      );
    }

    log.error('Booking failed', { txnId: txn.txnId, reason });
    return res.status(502).json({
      status: 'maxio_failed',
      txnId: txn.txnId,
      channelId,
      channelName,
      error: reason,
    });
  }
});
