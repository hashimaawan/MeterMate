/**
 * maxioService — one function per use case, wrapping the Maxio SDK and
 * normalizing results into MeterMate's own shapes. Throws `MaxioServiceError`
 * on failure. No Express/Slack imports → unit-testable in isolation.
 *
 * UC1 (Book & Subscribe) is implemented here; later UCs add their own functions.
 */
import {
  CollectionMethod,
  ComponentKind,
  CreateInvoiceStatus,
  InvoiceStatus,
} from '@maxio-com/advanced-billing-sdk';
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

export type PlanChangeTiming = 'prorate' | 'at-renewal';

/** Normalized proration preview (UC3 preview). */
export interface PlanChangePreview {
  targetHandle: string;
  proratedAdjustmentFormatted: string;
  chargeFormatted: string;
  creditAppliedFormatted: string;
  paymentDueFormatted: string;
  paymentDueInCents: number;
}

/** Normalized result of an applied plan change (UC3 commit). */
export interface PlanChangeResult {
  timing: PlanChangeTiming;
  oldPlanHandle: string;
  oldPlanName: string;
  newPlanHandle: string;
  newPlanName: string;
  state: string;
  prorated: boolean;
  /** Null means "effective immediately"; otherwise the effective date (ISO). */
  effectiveDate: string | null;
  manageUrl: string;
}

export interface PlanRef {
  handle: string;
  name: string;
}

/** Read the subscription's current product handle/name. */
export async function readSubscriptionPlan(subscriptionId: number): Promise<PlanRef> {
  try {
    const { result } = await maxio.subscriptions.readSubscription(subscriptionId);
    const product = result.subscription?.product;
    return {
      handle: product?.handle ?? 'unknown',
      name: product?.name ?? product?.handle ?? 'unknown',
    };
  } catch (err) {
    throw toMaxioServiceError(err, 'readSubscriptionPlan');
  }
}

/**
 * UC3 preview — compute the prorated cost of moving the subscription to the
 * target plan now. Uses `preservePeriod: true` so the preview reflects the same
 * prorated mechanism the "prorate now" commit applies (plan §UC3).
 */
export async function previewPlanChange(input: {
  subscriptionId: number;
  targetHandle: string;
}): Promise<PlanChangePreview> {
  try {
    log.info('Previewing plan change', {
      subscriptionId: input.subscriptionId,
      targetHandle: input.targetHandle,
    });

    const { result } = await maxio.subscriptionProducts.previewSubscriptionProductMigration(
      input.subscriptionId,
      {
        migration: {
          productHandle: input.targetHandle,
          preservePeriod: true,
          includeCoupons: true,
        },
      },
    );

    const preview = result.migration;
    return {
      targetHandle: input.targetHandle,
      proratedAdjustmentFormatted: formatCents(preview?.proratedAdjustmentInCents),
      chargeFormatted: formatCents(preview?.chargeInCents),
      creditAppliedFormatted: formatCents(preview?.creditAppliedInCents),
      paymentDueFormatted: formatCents(preview?.paymentDueInCents),
      paymentDueInCents: centsToNumber(preview?.paymentDueInCents),
    };
  } catch (err) {
    if (err instanceof MaxioServiceError) throw err;
    throw toMaxioServiceError(err, 'previewPlanChange');
  }
}

/**
 * UC3 commit — apply the plan change.
 *  - `prorate`    → migrate now with proration (preservePeriod: true).
 *  - `at-renewal` → schedule a non-prorated product change for the next renewal
 *                   via a delayed product change.
 */
export async function applyPlanChange(input: {
  subscriptionId: number;
  targetHandle: string;
  timing: PlanChangeTiming;
}): Promise<PlanChangeResult> {
  try {
    const oldPlan = await readSubscriptionPlan(input.subscriptionId);

    if (input.timing === 'prorate') {
      log.info('Applying prorated plan change', {
        subscriptionId: input.subscriptionId,
        targetHandle: input.targetHandle,
      });
      const { result } = await maxio.subscriptionProducts.migrateSubscriptionProduct(
        input.subscriptionId,
        {
          migration: {
            productHandle: input.targetHandle,
            preservePeriod: true,
            includeCoupons: true,
          },
        },
      );
      const sub = result.subscription;
      return {
        timing: 'prorate',
        oldPlanHandle: oldPlan.handle,
        oldPlanName: oldPlan.name,
        newPlanHandle: sub?.product?.handle ?? input.targetHandle,
        newPlanName: sub?.product?.name ?? input.targetHandle,
        state: sub?.state ?? 'unknown',
        prorated: true,
        effectiveDate: null, // immediate
        manageUrl: subscriptionManageUrl(input.subscriptionId),
      };
    }

    // at-renewal — delayed, non-prorated product change.
    log.info('Scheduling delayed plan change', {
      subscriptionId: input.subscriptionId,
      targetHandle: input.targetHandle,
    });
    const { result } = await maxio.subscriptions.updateSubscription(input.subscriptionId, {
      subscription: {
        productHandle: input.targetHandle,
        productChangeDelayed: true,
      },
    });
    const sub = result.subscription;
    return {
      timing: 'at-renewal',
      oldPlanHandle: oldPlan.handle,
      oldPlanName: oldPlan.name,
      newPlanHandle: sub?.nextProductHandle ?? input.targetHandle,
      newPlanName: sub?.nextProductHandle ?? input.targetHandle,
      state: sub?.state ?? 'unknown',
      prorated: false,
      effectiveDate: sub?.currentPeriodEndsAt ?? null,
      manageUrl: subscriptionManageUrl(input.subscriptionId),
    };
  } catch (err) {
    if (err instanceof MaxioServiceError) throw err;
    throw toMaxioServiceError(err, 'applyPlanChange');
  }
}

export type LifecycleAction = 'pause' | 'resume' | 'cancel' | 'reactivate';
export type CancelType = 'immediate' | 'end-of-period';

/** Normalized result of a UC4 lifecycle action. */
export interface LifecycleResult {
  action: LifecycleAction;
  cancelType: CancelType | null;
  previousState: string;
  newState: string;
  /** True when cancellation is scheduled for period end rather than immediate. */
  scheduled: boolean;
  /** Effective date for scheduled actions (ISO), else null (immediate). */
  effectiveDate: string | null;
  reason: string | null;
  manageUrl: string;
}

export interface LifecycleInput {
  subscriptionId: number;
  action: LifecycleAction;
  cancelType?: CancelType;
  /** Free-text reason; recorded as the cancellation message. */
  reason?: string;
}

/**
 * UC4 — dispatch a lifecycle action to its matching Maxio operation:
 *   pause  → place on hold        resume → resume on-hold
 *   cancel (immediate)            → cancel now
 *   cancel (end-of-period)        → delayed cancellation
 *   reactivate                    → reactivate a canceled subscription
 *
 * The supplied free-text reason is recorded as the cancellation message (we do
 * not send a Maxio `reason_code`, which must be a pre-defined site value).
 */
export async function lifecycleAction(input: LifecycleInput): Promise<LifecycleResult> {
  try {
    const before = await maxio.subscriptions.readSubscription(input.subscriptionId);
    const previousState = String(before.result.subscription?.state ?? 'unknown');

    log.info('Lifecycle action', {
      subscriptionId: input.subscriptionId,
      action: input.action,
      cancelType: input.cancelType,
    });

    const base = {
      action: input.action,
      cancelType: input.cancelType ?? null,
      previousState,
      reason: input.reason ?? null,
      manageUrl: subscriptionManageUrl(input.subscriptionId),
    };

    switch (input.action) {
      case 'pause': {
        const { result } = await maxio.subscriptionStatus.pauseSubscription(input.subscriptionId);
        return {
          ...base,
          newState: String(result.subscription?.state ?? 'on_hold'),
          scheduled: false,
          effectiveDate: null,
        };
      }
      case 'resume': {
        const { result } = await maxio.subscriptionStatus.resumeSubscription(input.subscriptionId);
        return {
          ...base,
          newState: String(result.subscription?.state ?? 'active'),
          scheduled: false,
          effectiveDate: null,
        };
      }
      case 'reactivate': {
        const { result } = await maxio.subscriptionStatus.reactivateSubscription(
          input.subscriptionId,
        );
        return {
          ...base,
          newState: String(result.subscription?.state ?? 'active'),
          scheduled: false,
          effectiveDate: null,
        };
      }
      case 'cancel': {
        if (input.cancelType === 'end-of-period') {
          // Delayed cancellation returns only a message; read back state/date.
          await maxio.subscriptionStatus.initiateDelayedCancellation(input.subscriptionId, {
            subscription: {
              cancelAtEndOfPeriod: true,
              ...(input.reason ? { cancellationMessage: input.reason } : {}),
            },
          });
          const after = await maxio.subscriptions.readSubscription(input.subscriptionId);
          const sub = after.result.subscription;
          return {
            ...base,
            newState: String(sub?.state ?? previousState),
            scheduled: true,
            effectiveDate: sub?.delayedCancelAt ?? sub?.currentPeriodEndsAt ?? null,
          };
        }
        // Immediate cancellation.
        const { result } = await maxio.subscriptionStatus.cancelSubscription(input.subscriptionId, {
          subscription: {
            cancelAtEndOfPeriod: false,
            ...(input.reason ? { cancellationMessage: input.reason } : {}),
          },
        });
        return {
          ...base,
          newState: String(result.subscription?.state ?? 'canceled'),
          scheduled: false,
          effectiveDate: null,
        };
      }
      default: {
        // Exhaustiveness guard — unreachable for the typed union.
        const never: never = input.action;
        throw new MaxioServiceError('Unknown lifecycle action', null, String(never));
      }
    }
  } catch (err) {
    if (err instanceof MaxioServiceError) throw err;
    throw toMaxioServiceError(err, 'lifecycleAction');
  }
}

export interface InvoiceLineItem {
  title: string;
  quantity: number;
  unitPrice: number;
}

/** Normalized result of a UC5 invoice issue+send. */
export interface InvoiceResult {
  uid: string;
  number: string;
  status: string;
  totalAmountFormatted: string;
  dueAmountFormatted: string;
  dueDate: string | null;
  issueDate: string | null;
  publicUrl: string | null;
  emailed: boolean;
}

export interface IssueInvoiceInput {
  subscriptionId: number;
  lineItems: InvoiceLineItem[];
  memo?: string;
  sendEmail: boolean;
  /** Recipient for the emailed invoice (the client's email). */
  recipientEmail?: string;
}

function formatAmountString(amount: string | null | undefined): string {
  if (!amount) return '$0.00';
  const n = Number(amount);
  return Number.isFinite(n) ? `$${n.toFixed(2)}` : `$${amount}`;
}

/**
 * UC5 — create an ad-hoc invoice for the subscription from line items, issue it,
 * and optionally email it to the customer. Returns the issued invoice's amount
 * due, due date, status, and hosted public payment URL.
 *
 * Created as a draft, then explicitly issued, so the create→issue→send steps are
 * distinct and observable (per plan §UC5).
 */
export async function issueAndSendInvoice(input: IssueInvoiceInput): Promise<InvoiceResult> {
  try {
    log.info('Creating ad-hoc invoice', {
      subscriptionId: input.subscriptionId,
      lineItemCount: input.lineItems.length,
      sendEmail: input.sendEmail,
    });

    const { result: created } = await maxio.invoices.createInvoice(input.subscriptionId, {
      invoice: {
        status: CreateInvoiceStatus.Draft,
        lineItems: input.lineItems.map((li) => ({
          title: li.title,
          quantity: li.quantity,
          unitPrice: li.unitPrice,
        })),
        ...(input.memo ? { memo: input.memo } : {}),
      },
    });

    const uid = created.invoice?.uid;
    if (!uid) throw new Error('Maxio returned an invoice with no uid');

    // Issue the draft so it becomes a real, payable invoice with a public URL.
    const { result: issued } = await maxio.invoices.issueInvoice(uid);

    let emailed = false;
    if (input.sendEmail) {
      await maxio.invoices.sendInvoice(uid, {
        ...(input.recipientEmail ? { recipientEmails: [input.recipientEmail] } : {}),
      });
      emailed = true;
      log.info('Invoice emailed', { uid });
    }

    return {
      uid,
      number: issued.number ?? uid,
      status: String(issued.status ?? 'open'),
      totalAmountFormatted: formatAmountString(issued.totalAmount),
      dueAmountFormatted: formatAmountString(issued.dueAmount),
      dueDate: issued.dueDate ?? null,
      issueDate: issued.issueDate ?? null,
      publicUrl: issued.publicUrl ?? null,
      emailed,
    };
  } catch (err) {
    if (err instanceof MaxioServiceError) throw err;
    throw toMaxioServiceError(err, 'issueAndSendInvoice');
  }
}

/** Aggregated billing figures for a UC6 digest (one consultant's scope). */
export interface DigestAggregate {
  totalTracked: number;
  activeCount: number;
  mrrFormatted: string;
  newSignups: number;
  churn: number;
  openInvoices: number;
  outstandingFormatted: string;
}

/**
 * UC6 — aggregate live Maxio figures for a set of subscriptions (the caller
 * scopes them to a consultant via the transaction store, since "consultant" is
 * a MeterMate label, not a Maxio entity). Reads each subscription's live state
 * and its open invoices. Reconciliation data, not real-time confirmation.
 */
export async function buildDigest(input: {
  subscriptionIds: number[];
  windowDays: number;
}): Promise<DigestAggregate> {
  try {
    const cutoff = Date.now() - input.windowDays * 24 * 60 * 60 * 1000;
    const ACTIVE_STATES = new Set(['active', 'trialing', 'assessing']);

    let activeCount = 0;
    let mrrCents = 0;
    let newSignups = 0;
    let churn = 0;
    let openInvoices = 0;
    let outstandingCents = 0;

    for (const subscriptionId of input.subscriptionIds) {
      const { result } = await maxio.subscriptions.readSubscription(subscriptionId);
      const sub = result.subscription;
      if (!sub) continue;

      const state = String(sub.state ?? '');
      if (ACTIVE_STATES.has(state)) {
        activeCount += 1;
        mrrCents += centsToNumber(sub.product?.priceInCents ?? sub.productPriceInCents);
      }
      if (sub.createdAt && Date.parse(sub.createdAt) >= cutoff) newSignups += 1;
      if (state === 'canceled' && sub.canceledAt && Date.parse(sub.canceledAt) >= cutoff) {
        churn += 1;
      }

      // Open invoices for this subscription (outstanding balance).
      const { result: invoiceList } = await maxio.invoices.listInvoices({
        subscriptionId,
        status: InvoiceStatus.Open,
        perPage: 200,
      });
      for (const inv of invoiceList.invoices ?? []) {
        openInvoices += 1;
        outstandingCents += Math.round(Number(inv.dueAmount ?? '0') * 100);
      }
    }

    return {
      totalTracked: input.subscriptionIds.length,
      activeCount,
      mrrFormatted: formatCents(mrrCents),
      newSignups,
      churn,
      openInvoices,
      outstandingFormatted: formatCents(outstandingCents),
    };
  } catch (err) {
    if (err instanceof MaxioServiceError) throw err;
    throw toMaxioServiceError(err, 'buildDigest');
  }
}
