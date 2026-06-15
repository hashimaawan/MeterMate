/**
 * Zod request schema for UC6 — Billing Activity Digest (admin only).
 */
import { z } from 'zod';

export const digestRequestSchema = z.object({
  sessionId: z.string().min(1, 'sessionId is required').max(128),
  consultantId: z.string().trim().min(1, 'consultantId is required').max(80),
  windowDays: z.number().int().positive().max(365).default(30),
});

export type DigestRequest = z.infer<typeof digestRequestSchema>;
