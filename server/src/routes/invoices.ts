/**
 * UC5 — Invoice Issue + Send (admin only).  POST /api/invoices
 *
 * Guarded by `adminGuard`. Resolves the transaction + channel, posts an
 * "issuing" message, creates → issues → (optionally) emails an ad-hoc invoice,
 * then posts the issued invoice with a "Pay Invoice" button. Slack failures
 * never block the billing result (plan §6).
 */
import { Router, type Request, type Response } from 'express';
import { createLogger } from '../logger.js';
import { adminGuard } from '../auth.js';
import { invoiceRequestSchema } from '../schemas/invoices.js';
import { sessionStore } from '../stores/sessionStore.js';
import { transactionStore } from '../stores/transactionStore.js';
import { issueAndSendInvoice } from '../services/maxioService.js';
import { MaxioServiceError } from '../maxioClient.js';
import { ensureTxnChannel, postBlocks } from '../services/slackService.js';
import {
  buildInvoiceIssuing,
  buildInvoiceIssued,
  buildFailure,
} from '../services/slack/blocks.js';

const log = createLogger('route:invoices');

export const invoicesRouter = Router();

invoicesRouter.post('/invoices', adminGuard, async (req: Request, res: Response) => {
  const parsed = invoiceRequestSchema.safeParse(req.body);
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

  let channelId: string | null = txn.channelId;
  let channelName: string | null = txn.channelName;
  try {
    const channel = await ensureTxnChannel(txn);
    channelId = channel.channelId;
    channelName = channel.channelName;
    await postBlocks(channelId, buildInvoiceIssuing(), 'Issuing invoice');
  } catch (err) {
    log.warn('ensureTxnChannel failed during invoice; continuing', {
      txnId: txn.txnId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  try {
    const result = await issueAndSendInvoice({
      subscriptionId: txn.subscriptionId,
      lineItems: input.lineItems,
      ...(input.memo ? { memo: input.memo } : {}),
      sendEmail: input.sendEmail,
      recipientEmail: txn.clientEmail,
    });

    transactionStore.update(txn.txnId, { type: 'invoice', lastError: null });
    sessionStore.recordResult(input.sessionId, txn.txnId, result);

    if (channelId) {
      await postBlocks(
        channelId,
        buildInvoiceIssued({
          number: result.number,
          amountDue: result.dueAmountFormatted,
          dueDate: result.dueDate,
          emailed: result.emailed,
          payUrl: result.publicUrl,
        }),
        'Invoice issued',
      );
    }

    return res.status(200).json({
      status: 'ok',
      txnId: txn.txnId,
      channelId,
      channelName,
      invoice: result,
    });
  } catch (err) {
    const reason = err instanceof MaxioServiceError ? err.detail : err instanceof Error ? err.message : String(err);
    transactionStore.update(txn.txnId, { lastError: reason });
    if (channelId) {
      await postBlocks(channelId, buildFailure({ useCase: 'Invoice', reason }), 'Invoice failed');
    }
    log.error('Invoice issue failed', { txnId: txn.txnId, reason });
    return res.status(502).json({ status: 'maxio_failed', txnId: txn.txnId, channelId, channelName, error: reason });
  }
});
