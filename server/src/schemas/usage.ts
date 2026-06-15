/**
 * Zod request schema for UC2 — Report Session Usage. Validates before any
 * Maxio/Slack call (plan AC-18).
 */
import { z } from 'zod';

export const usageRequestSchema = z.object({
  sessionId: z.string().min(1, 'sessionId is required').max(128),
  txnRef: z.string().min(1, 'txnRef is required').max(128),
  componentHandle: z.string().trim().min(1, 'componentHandle is required').max(120),
  // Fractional quantities are allowed by some components; require a positive value.
  quantity: z
    .number({ invalid_type_error: 'quantity must be a number' })
    .positive('quantity must be greater than 0')
    .finite('quantity must be finite'),
  memo: z.string().trim().max(255).optional(),
  // Accepted for event-based components (deferred); ignored for metered usage.
  timestamp: z.string().datetime({ message: 'timestamp must be ISO-8601' }).optional(),
});

export type UsageRequest = z.infer<typeof usageRequestSchema>;
