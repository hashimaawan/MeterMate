/**
 * Singleton Maxio Advanced Billing SDK client + lazily-constructed controllers.
 *
 * Auth is HTTP Basic: the API key is the username, `x` the password, scoped to
 * a site subdomain and US/EU environment (per Maxio docs). Nothing outside this
 * module knows the SDK's client shape; services receive ready-made controllers.
 */
import {
  Client,
  Environment,
  SubscriptionsController,
  SubscriptionComponentsController,
  SubscriptionProductsController,
  ProductsController,
  ProductFamiliesController,
  ComponentsController,
  type ApiError,
} from '@maxio-com/advanced-billing-sdk';
import { config } from './config.js';
import { createLogger } from './logger.js';

const log = createLogger('maxioClient');

const client = new Client({
  basicAuthCredentials: {
    username: config.maxio.apiKey,
    // Maxio Basic auth: API key as username, literal "x" as password.
    password: 'x',
  },
  site: config.maxio.siteSubdomain,
  environment: config.maxio.environment === 'EU' ? Environment.EU : Environment.US,
  timeout: 30_000,
});

log.info('Maxio client configured', {
  site: config.maxio.siteSubdomain,
  environment: config.maxio.environment,
});

export const maxio = {
  client,
  subscriptions: new SubscriptionsController(client),
  subscriptionComponents: new SubscriptionComponentsController(client),
  subscriptionProducts: new SubscriptionProductsController(client),
  products: new ProductsController(client),
  productFamilies: new ProductFamiliesController(client),
  components: new ComponentsController(client),
};

/**
 * Typed error thrown by `maxioService` functions so routes can map billing
 * failures to a `maxio_failed` status without importing SDK internals.
 */
export class MaxioServiceError extends Error {
  readonly statusCode: number | null;
  readonly detail: string;

  constructor(message: string, statusCode: number | null, detail: string) {
    super(message);
    this.name = 'MaxioServiceError';
    this.statusCode = statusCode;
    this.detail = detail;
  }
}

/** Narrowing guard for the SDK's ApiError (which extends Error). */
function isApiError(err: unknown): err is ApiError {
  return (
    err instanceof Error &&
    typeof (err as Partial<ApiError>).statusCode === 'number'
  );
}

/**
 * Convert any thrown value from an SDK call into a clean `MaxioServiceError`,
 * extracting the most useful human-readable detail Maxio returned.
 */
export function toMaxioServiceError(err: unknown, operation: string): MaxioServiceError {
  if (isApiError(err)) {
    const statusCode = err.statusCode;
    let detail = err.message || `HTTP ${statusCode}`;

    // Maxio returns errors as { errors: [...] } or { errors: { field: [...] } }.
    const result = (err as ApiError).result as unknown;
    const extracted = extractErrorMessages(result);
    if (extracted) detail = extracted;
    else if (typeof (err as ApiError).body === 'string' && (err as ApiError).body) {
      detail = (err as ApiError).body as string;
    }

    log.error(`Maxio ${operation} failed`, { statusCode, detail });
    return new MaxioServiceError(`Maxio ${operation} failed`, statusCode, detail);
  }

  const detail = err instanceof Error ? err.message : String(err);
  log.error(`Maxio ${operation} failed (non-API error)`, { detail });
  return new MaxioServiceError(`Maxio ${operation} failed`, null, detail);
}

function extractErrorMessages(result: unknown): string | null {
  if (!result || typeof result !== 'object') return null;
  const maybeErrors = (result as Record<string, unknown>).errors;
  if (Array.isArray(maybeErrors)) {
    return maybeErrors.map((e) => String(e)).join('; ');
  }
  if (maybeErrors && typeof maybeErrors === 'object') {
    return Object.entries(maybeErrors as Record<string, unknown>)
      .map(([field, msgs]) => `${field}: ${Array.isArray(msgs) ? msgs.join(', ') : String(msgs)}`)
      .join('; ');
  }
  return null;
}
