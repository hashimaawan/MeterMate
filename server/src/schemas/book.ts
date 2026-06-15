/**
 * Zod request schema for UC1 — Book & Subscribe. Invalid input is rejected with
 * a 400 before any Maxio/Slack call (plan AC-18).
 */
import { z } from 'zod';

export const bookRequestSchema = z.object({
  sessionId: z.string().min(1, 'sessionId is required').max(128),
  firstName: z.string().trim().min(1, 'firstName is required').max(80),
  lastName: z.string().trim().min(1, 'lastName is required').max(80),
  email: z.string().trim().email('a valid client email is required').max(200),
  consultantId: z.string().trim().min(1, 'consultantId is required').max(80),
  productHandle: z.string().trim().min(1, 'productHandle is required').max(120),
  collectionMethod: z.enum(['automatic', 'remittance']),
  couponCode: z.string().trim().min(1).max(80).optional(),
});

export type BookRequest = z.infer<typeof bookRequestSchema>;
