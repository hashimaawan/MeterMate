/**
 * maxioService — one function per use case, wrapping the Maxio SDK and
 * normalizing results into MeterMate's own shapes. Throws `MaxioServiceError`
 * on failure. No Express/Slack imports → unit-testable in isolation.
 *
 * UC1 (Book & Subscribe) is implemented here; later UCs add their own functions.
 */
import { CollectionMethod } from '@maxio-com/advanced-billing-sdk';
import { config } from '../config.js';
import { createLogger } from '../logger.js';
import { maxio, toMaxioServiceError } from '../maxioClient.js';

const log = createLogger('maxioService');

/** Normalized plan, used for the `/api/products` dropdown. */
export interface PlanSummary {
  handle: string;
  name: string;
  priceFormatted: string;
  priceInCents: number;
}

/** Normalized result of a UC1 subscription creation. */
export interface SubscriptionResult {
  subscriptionId: number;
  customerId: number | null;
  customerName: string;
  customerEmail: string;
  planHandle: string;
  planName: string;
  mrrFormatted: string;
  state: string;
  nextAssessmentAt: string | null;
  manageUrl: string;
}

export interface CreateSubscriptionInput {
  firstName: string;
  lastName: string;
  email: string;
  productHandle: string;
  collectionMethod: 'automatic' | 'remittance';
  couponCode?: string;
}

/** Cents (bigint) → "$99.00". */
function formatCents(cents: bigint | number | null | undefined): string {
  if (cents === null || cents === undefined) return '$0.00';
  const n = typeof cents === 'bigint' ? Number(cents) : cents;
  return `$${(n / 100).toFixed(2)}`;
}

function centsToNumber(cents: bigint | number | null | undefined): number {
  if (cents === null || cents === undefined) return 0;
  return typeof cents === 'bigint' ? Number(cents) : cents;
}

/** Admin-facing Maxio URL for a subscription ("View in Maxio"). */
function subscriptionManageUrl(subscriptionId: number): string {
  return `https://${config.maxio.siteSubdomain}.chargify.com/subscriptions/${subscriptionId}`;
}

/**
 * UC1 — create a subscription, creating the customer inline from the submitted
 * name/email. The email doubles as the customer `reference` so a retried form
 * reuses the same customer instead of duplicating it (idempotency seam).
 */
export async function createSubscription(
  input: CreateSubscriptionInput,
): Promise<SubscriptionResult> {
  const collectionMethod =
    input.collectionMethod === 'automatic'
      ? CollectionMethod.Automatic
      : CollectionMethod.Remittance;

  try {
    log.info('Creating subscription', {
      productHandle: input.productHandle,
      collectionMethod: input.collectionMethod,
      hasCoupon: Boolean(input.couponCode),
    });

    const { result } = await maxio.subscriptions.createSubscription({
      subscription: {
        productHandle: input.productHandle,
        paymentCollectionMethod: collectionMethod,
        customerAttributes: {
          firstName: input.firstName,
          lastName: input.lastName,
          email: input.email,
          reference: input.email.trim().toLowerCase(),
        },
        ...(input.couponCode ? { couponCode: input.couponCode } : {}),
      },
    });

    const sub = result.subscription;
    if (!sub?.id) {
      throw new Error('Maxio returned a subscription with no id');
    }

    const planName = sub.product?.name ?? input.productHandle;
    const priceInCents = sub.product?.priceInCents ?? sub.productPriceInCents;

    const normalized: SubscriptionResult = {
      subscriptionId: sub.id,
      customerId: sub.customer?.id ?? null,
      customerName:
        `${sub.customer?.firstName ?? input.firstName} ${sub.customer?.lastName ?? input.lastName}`.trim(),
      customerEmail: sub.customer?.email ?? input.email,
      planHandle: sub.product?.handle ?? input.productHandle,
      planName,
      mrrFormatted: formatCents(priceInCents),
      state: sub.state ?? 'unknown',
      nextAssessmentAt: sub.nextAssessmentAt ?? null,
      manageUrl: subscriptionManageUrl(sub.id),
    };

    log.info('Subscription created', {
      subscriptionId: normalized.subscriptionId,
      state: normalized.state,
    });
    return normalized;
  } catch (err) {
    throw toMaxioServiceError(err, 'createSubscription');
  }
}

/**
 * List active products for the plan dropdown. Filtered to the configured
 * product family's recurring plans (handles like `basic`/`pro`).
 */
export async function listPlans(): Promise<PlanSummary[]> {
  try {
    const { result } = await maxio.products.listProducts({ perPage: 200 });
    const plans: PlanSummary[] = [];
    for (const entry of result) {
      const product = entry.product;
      if (!product?.handle) continue;
      if (product.archivedAt) continue;
      plans.push({
        handle: product.handle,
        name: product.name ?? product.handle,
        priceFormatted: formatCents(product.priceInCents),
        priceInCents: centsToNumber(product.priceInCents),
      });
    }
    return plans.sort((a, b) => a.priceInCents - b.priceInCents);
  } catch (err) {
    throw toMaxioServiceError(err, 'listPlans');
  }
}
