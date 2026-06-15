/**
 * Typed fetch wrappers. Shapes mirror the backend contract verified in Postman
 * for UC1 (POST /api/book) plus the meta endpoints feeding the form's dropdowns.
 */
import { getSessionId } from './session';

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
