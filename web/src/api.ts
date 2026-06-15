/**
 * Typed fetch wrappers. Shapes mirror the backend contract verified in Postman
 * for UC1 (POST /api/book) plus the meta endpoints feeding the form's dropdowns.
 */
import { getSessionId } from './session';
import { basicAuthHeader, type AdminCredentials } from './adminAuth';

export interface Consultant {
  id: string;
  name: string;
}

export interface Product {
  handle: string;
  name: string;
  priceFormatted: string;
  priceInCents: number;
}

export interface Component {
  handle: string;
  name: string;
  unitName: string;
  priceFormatted: string;
  kind: string;
}

export type CollectionMethod = 'automatic' | 'remittance';

export interface BookRequest {
  firstName: string;
  lastName: string;
  email: string;
  consultantId: string;
  productHandle: string;
  collectionMethod: CollectionMethod;
  couponCode?: string;
}

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

export interface BookOk {
  status: 'ok';
  txnId: string;
  channelId: string | null;
  channelName: string | null;
  subscription: SubscriptionResult;
}

export interface FieldError {
  field: string;
  message: string;
}

export interface BookInvalid {
  status: 'invalid';
  errors: FieldError[];
}

export interface BookMaxioFailed {
  status: 'maxio_failed';
  txnId: string;
  channelId: string | null;
  channelName: string | null;
  error: string;
}

export type BookResponse = BookOk | BookInvalid | BookMaxioFailed;

export interface UsageRequest {
  txnRef: string;
  componentHandle: string;
  quantity: number;
  memo?: string;
}

export interface UsageResult {
  subscriptionId: number;
  componentHandle: string;
  componentName: string;
  unit: string;
  quantityRecorded: number;
  periodTotal: number;
  memo: string | null;
}

export interface UsageOk {
  status: 'ok';
  txnId: string;
  channelId: string | null;
  channelName: string | null;
  usage: UsageResult;
}

export interface UsageInvalid {
  status: 'invalid';
  errors: FieldError[];
}

export interface UsageSessionExpired {
  status: 'session_expired';
  error: string;
}

export interface UsageMaxioFailed {
  status: 'maxio_failed';
  txnId: string;
  channelId: string | null;
  channelName: string | null;
  error: string;
}

export type UsageResponse = UsageOk | UsageInvalid | UsageSessionExpired | UsageMaxioFailed;

export type PlanChangeTiming = 'prorate' | 'at-renewal';

export interface PlanChangePreview {
  targetHandle: string;
  proratedAdjustmentFormatted: string;
  chargeFormatted: string;
  creditAppliedFormatted: string;
  paymentDueFormatted: string;
  paymentDueInCents: number;
  currentPlanHandle: string;
  currentPlanName: string;
}

export interface PreviewOk {
  status: 'ok';
  txnId: string;
  channelId: string | null;
  channelName: string | null;
  preview: PlanChangePreview;
}

export interface PlanChangeResultData {
  timing: PlanChangeTiming;
  oldPlanHandle: string;
  oldPlanName: string;
  newPlanHandle: string;
  newPlanName: string;
  state: string;
  prorated: boolean;
  effectiveDate: string | null;
  manageUrl: string;
}

export interface PlanChangeOk {
  status: 'ok';
  txnId: string;
  channelId: string | null;
  channelName: string | null;
  planChange: PlanChangeResultData;
}

interface DiscriminatedFailures {
  invalid: { status: 'invalid'; errors: FieldError[] };
  sessionExpired: { status: 'session_expired'; error: string };
  maxioFailed: { status: 'maxio_failed'; error: string; channelName?: string | null };
}

export type PreviewResponse =
  | PreviewOk
  | DiscriminatedFailures['invalid']
  | DiscriminatedFailures['sessionExpired']
  | DiscriminatedFailures['maxioFailed'];

export type PlanChangeResponse =
  | PlanChangeOk
  | DiscriminatedFailures['invalid']
  | DiscriminatedFailures['sessionExpired']
  | DiscriminatedFailures['maxioFailed'];

/** Thrown for transport/unexpected errors so the UI can show a single message. */
export class ApiError extends Error {}

async function parseJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError(`Unexpected non-JSON response (HTTP ${res.status})`);
  }
}

export async function fetchConsultants(): Promise<Consultant[]> {
  const res = await fetch('/api/consultants');
  const body = (await parseJson(res)) as { status?: string; consultants?: Consultant[] };
  if (!res.ok || body.status !== 'ok' || !body.consultants) {
    throw new ApiError('Failed to load consultants');
  }
  return body.consultants;
}

export async function fetchProducts(): Promise<Product[]> {
  const res = await fetch('/api/products');
  const body = (await parseJson(res)) as { status?: string; products?: Product[]; error?: string };
  if (!res.ok || body.status !== 'ok' || !body.products) {
    throw new ApiError(body.error ?? 'Failed to load products');
  }
  return body.products;
}

export async function fetchComponents(): Promise<Component[]> {
  const res = await fetch('/api/components');
  const body = (await parseJson(res)) as { status?: string; components?: Component[] };
  if (!res.ok || body.status !== 'ok' || !body.components) {
    throw new ApiError('Failed to load components');
  }
  return body.components;
}

/**
 * Submit a booking. Returns the discriminated response for ok/invalid/
 * maxio_failed; throws ApiError only for genuine transport failures.
 */
export async function postBook(input: BookRequest): Promise<BookResponse> {
  let res: Response;
  try {
    res = await fetch('/api/book', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: getSessionId(), ...input }),
    });
  } catch (err) {
    throw new ApiError(err instanceof Error ? err.message : 'Network error');
  }

  const body = (await parseJson(res)) as Partial<BookResponse> & { status?: string };

  if (body.status === 'ok' || body.status === 'invalid' || body.status === 'maxio_failed') {
    return body as BookResponse;
  }
  throw new ApiError(`Unexpected response from server (HTTP ${res.status})`);
}

/**
 * Record usage (UC2). Returns the discriminated response for
 * ok/invalid/session_expired/maxio_failed; throws ApiError on transport errors.
 */
export async function postUsage(input: UsageRequest): Promise<UsageResponse> {
  let res: Response;
  try {
    res = await fetch('/api/usage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: getSessionId(), ...input }),
    });
  } catch (err) {
    throw new ApiError(err instanceof Error ? err.message : 'Network error');
  }

  const body = (await parseJson(res)) as Partial<UsageResponse> & { status?: string };

  if (
    body.status === 'ok' ||
    body.status === 'invalid' ||
    body.status === 'session_expired' ||
    body.status === 'maxio_failed'
  ) {
    return body as UsageResponse;
  }
  throw new ApiError(`Unexpected response from server (HTTP ${res.status})`);
}

const KNOWN_STATUSES = ['ok', 'invalid', 'session_expired', 'maxio_failed'] as const;

async function postDiscriminated<T extends { status: string }>(
  url: string,
  payload: Record<string, unknown>,
  extraHeaders?: Record<string, string>,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(extraHeaders ?? {}) },
      body: JSON.stringify({ sessionId: getSessionId(), ...payload }),
    });
  } catch (err) {
    throw new ApiError(err instanceof Error ? err.message : 'Network error');
  }
  const body = (await parseJson(res)) as { status?: string };
  if (body.status && (KNOWN_STATUSES as readonly string[]).includes(body.status)) {
    return body as T;
  }
  throw new ApiError(`Unexpected response from server (HTTP ${res.status})`);
}

/** Validate admin credentials against the guarded check endpoint. */
export async function checkAdmin(creds: AdminCredentials): Promise<boolean> {
  try {
    const res = await fetch('/api/admin/check', {
      headers: { Authorization: basicAuthHeader(creds) },
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function postPlanChangePreview(input: {
  txnRef: string;
  targetHandle: string;
}): Promise<PreviewResponse> {
  return postDiscriminated<PreviewResponse>('/api/plan-change/preview', input);
}

export function postPlanChange(input: {
  txnRef: string;
  targetHandle: string;
  timing: PlanChangeTiming;
}): Promise<PlanChangeResponse> {
  return postDiscriminated<PlanChangeResponse>('/api/plan-change', input);
}

export type LifecycleAction = 'pause' | 'resume' | 'cancel' | 'reactivate';
export type CancelType = 'immediate' | 'end-of-period';

export interface LifecycleResultData {
  action: LifecycleAction;
  cancelType: CancelType | null;
  previousState: string;
  newState: string;
  scheduled: boolean;
  effectiveDate: string | null;
  reason: string | null;
  manageUrl: string;
}

export interface LifecycleOk {
  status: 'ok';
  txnId: string;
  channelId: string | null;
  channelName: string | null;
  lifecycle: LifecycleResultData;
}

export type LifecycleResponse =
  | LifecycleOk
  | DiscriminatedFailures['invalid']
  | DiscriminatedFailures['sessionExpired']
  | DiscriminatedFailures['maxioFailed'];

export function postLifecycle(input: {
  txnRef: string;
  action: LifecycleAction;
  cancelType?: CancelType;
  reasonCode?: string;
}): Promise<LifecycleResponse> {
  return postDiscriminated<LifecycleResponse>('/api/lifecycle', input);
}

export interface InvoiceLineItem {
  title: string;
  quantity: number;
  unitPrice: number;
}

export interface InvoiceResultData {
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

export interface InvoiceOk {
  status: 'ok';
  txnId: string;
  channelId: string | null;
  channelName: string | null;
  invoice: InvoiceResultData;
}

export type InvoiceResponse =
  | InvoiceOk
  | DiscriminatedFailures['invalid']
  | DiscriminatedFailures['sessionExpired']
  | DiscriminatedFailures['maxioFailed'];

export function postInvoice(
  input: {
    txnRef: string;
    lineItems: InvoiceLineItem[];
    memo?: string;
    sendEmail: boolean;
  },
  creds: AdminCredentials,
): Promise<InvoiceResponse> {
  return postDiscriminated<InvoiceResponse>('/api/invoices', input, {
    Authorization: basicAuthHeader(creds),
  });
}

export interface DigestData {
  consultantId: string;
  consultantName: string;
  windowDays: number;
  totalTracked: number;
  activeCount: number;
  mrrFormatted: string;
  newSignups: number;
  churn: number;
  openInvoices: number;
  outstandingFormatted: string;
  postedToChannel: string | null;
  note: string;
}

export interface DigestOk {
  status: 'ok';
  digest: DigestData;
}

export type DigestResponse =
  | DigestOk
  | DiscriminatedFailures['invalid']
  | DiscriminatedFailures['maxioFailed'];

export function postDigest(
  input: { consultantId: string; windowDays: number },
  creds: AdminCredentials,
): Promise<DigestResponse> {
  return postDiscriminated<DigestResponse>('/api/digest', input, {
    Authorization: basicAuthHeader(creds),
  });
}
