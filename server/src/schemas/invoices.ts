/**
 * Zod request schema for UC5 — Invoice Issue + Send (admin only).
 * At least one line item is required so the issued invoice is always valid.
 */
import { z } from 'zod';

const lineItemSchema = z.object({
  title: z.string().trim().min(1, 'line item title is required').max(255),
  quantity: z.number().positive('quantity must be greater than 0').finite(),
  unitPrice: z.number().nonnegative('unitPrice must be >= 0').finite(),
});

export const invoiceRequestSchema = z.object({
  sessionId: z.string().min(1, 'sessionId is required').max(128),
  txnRef: z.string().min(1, 'txnRef is required').max(128),
  lineItems: z.array(lineItemSchema).min(1, 'at least one line item is required').max(50),
  memo: z.string().trim().max(500).optional(),
  sendEmail: z.boolean().default(false),
});

export type InvoiceRequest = z.infer<typeof invoiceRequestSchema>;
