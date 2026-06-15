/**
 * maxioService — one function per use case, wrapping the Maxio SDK and
 * normalizing results into MeterMate's own shapes. Throws `MaxioServiceError`
 * on failure. No Express/Slack imports → unit-testable in isolation.
 *
 * UC1 (Book & Subscribe) is implemented here; later UCs add their own functions.
 */
import { CollectionMethod, ComponentKind } from '@maxio-com/advanced-billing-sdk';
import { config } from '../config.js';
import { createLogger } from '../logger.js';
import { maxio, toMaxioServiceError, MaxioServiceError } from '../maxioClient.js';

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

/** Normalized result of a UC2 usage recording. */
export interface UsageResult {
  subscriptionId: number;
  componentHandle: string;
  componentName: string;
  unit: string;
  quantityRecorded: number;
  /** Running total of recorded usage for the current billing period. */
  periodTotal: number;
  memo: string | null;
}

export interface RecordUsageInput {
  subscriptionId: number;
  componentHandle: string;
  quantity: number;
  memo?: string;
}

/** UsageQuantity is `number | string`; coerce to a finite number. */
function toNumber(value: number | string | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * UC2 — record metered usage against a component on a subscription, then read
 * back the running period total from the provider's usage history.
 *
 * The service dispatches on the cached component kind (per plan §UC2). The
 * event-based path (`api-calls`) is deferred this phase — recording usage for
 * an event-based component requires an EBB metric that the SDK cannot create —
 * so it raises a clear, typed error rather than silently doing nothing.
 */
export async function recordUsage(input: RecordUsageInput): Promise<UsageResult> {
  try {
    // Resolve the component to learn its kind, name, and unit.
    const { result: componentResponse } = await maxio.components.findComponent(
      input.componentHandle,
    );
    const component = componentResponse.component;
    if (!component?.id) {
      throw new MaxioServiceError(
        'Component not found',
        404,
        `No component with handle "${input.componentHandle}"`,
      );
    }

    if (component.kind === ComponentKind.EventBasedComponent) {
      throw new MaxioServiceError(
        'Event-based usage recording is not enabled',
        null,
        `Component "${input.componentHandle}" is event-based; event recording is deferred this phase. Use a metered component (e.g. "consulting-minutes").`,
      );
    }

    const unit = component.unitName ?? 'unit';
    const componentName = component.name ?? input.componentHandle;

    log.info('Recording metered usage', {
      subscriptionId: input.subscriptionId,
      componentHandle: input.componentHandle,
      quantity: input.quantity,
    });

    // Record the usage. componentId accepts `handle:<handle>`.
    await maxio.subscriptionComponents.createUsage(
      input.subscriptionId,
      `handle:${input.componentHandle}`,
      {
        usage: {
          quantity: input.quantity,
          ...(input.memo ? { memo: input.memo } : {}),
        },
      },
    );

    const periodTotal = await readPeriodUsageTotal(
      input.subscriptionId,
      input.componentHandle,
    );

    return {
      subscriptionId: input.subscriptionId,
      componentHandle: input.componentHandle,
      componentName,
      unit,
      quantityRecorded: input.quantity,
      periodTotal,
      memo: input.memo ?? null,
    };
  } catch (err) {
    if (err instanceof MaxioServiceError) throw err;
    throw toMaxioServiceError(err, 'recordUsage');
  }
}

/**
 * Sum recorded usage for the component since the start of the subscription's
 * current billing period. Best-effort: if the period start can't be read, falls
 * back to summing all usages for the component.
 */
async function readPeriodUsageTotal(
  subscriptionId: number,
  componentHandle: string,
): Promise<number> {
  let sinceDate: string | undefined;
  try {
    const { result } = await maxio.subscriptions.readSubscription(subscriptionId);
    const periodStart = result.subscription?.currentPeriodStartedAt;
    if (periodStart) {
      // listUsages.sinceDate filters on created_at date (midnight granularity).
      sinceDate = periodStart.slice(0, 10);
    }
  } catch {
    // Non-fatal — proceed without a date filter.
  }

  const { result: usages } = await maxio.subscriptionComponents.listUsages({
    subscriptionIdOrReference: subscriptionId,
    componentId: `handle:${componentHandle}`,
    perPage: 200,
    ...(sinceDate ? { sinceDate } : {}),
  });

  return usages.reduce((sum, entry) => sum + toNumber(entry.usage?.quantity), 0);
}
