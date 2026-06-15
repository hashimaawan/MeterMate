/**
 * Zod request schema for UC4 — Lifecycle Control. `cancelType` is required only
 * when the action is `cancel`; the refinement enforces that.
 */
import { z } from 'zod';

export const lifecycleRequestSchema = z
  .object({
    sessionId: z.string().min(1, 'sessionId is required').max(128),
    txnRef: z.string().min(1, 'txnRef is required').max(128),
    action: z.enum(['pause', 'resume', 'cancel', 'reactivate']),
    cancelType: z.enum(['immediate', 'end-of-period']).optional(),
    reasonCode: z.string().trim().max(255).optional(),
  })
  .refine((data) => data.action !== 'cancel' || data.cancelType !== undefined, {
    message: 'cancelType is required when action is "cancel"',
    path: ['cancelType'],
  });

export type LifecycleRequest = z.infer<typeof lifecycleRequestSchema>;
