/**
 * Zod request schemas for UC3 — Plan Change.
 *   - preview: prorated cost of moving to the target plan (always prorated).
 *   - commit:  apply the change with the chosen timing.
 */
import { z } from 'zod';

export const planChangePreviewSchema = z.object({
  sessionId: z.string().min(1, 'sessionId is required').max(128),
  txnRef: z.string().min(1, 'txnRef is required').max(128),
  targetHandle: z.string().trim().min(1, 'targetHandle is required').max(120),
});

export const planChangeSchema = planChangePreviewSchema.extend({
  timing: z.enum(['prorate', 'at-renewal']),
});

export type PlanChangePreviewRequest = z.infer<typeof planChangePreviewSchema>;
export type PlanChangeRequest = z.infer<typeof planChangeSchema>;
