/**
 * Idempotent test-site seed for UC1.
 *
 * Ensures the product family exists, then ensures the two recurring plans
 * (`basic` $99/mo, `pro` $299/mo) exist with explicit prices so nothing relies
 * on a Maxio default. Safe to run repeatedly — existing items are detected and
 * left untouched.
 *
 * Metered/event components (`consulting-minutes`, `api-calls`) are seeded with
 * their use case (UC2), keeping each feature's footprint self-contained.
 *
 * Run: `npm run seed`
 */
import { IntervalUnit } from '@maxio-com/advanced-billing-sdk';
import { config } from '../config.js';
import { createLogger } from '../logger.js';
import { maxio, toMaxioServiceError } from '../maxioClient.js';

const log = createLogger('seed');

const FAMILY_HANDLE = config.maxio.defaultProductFamily;

interface PlanSeed {
  handle: string;
  name: string;
  description: string;
  priceInCents: bigint;
}

const PLANS: PlanSeed[] = [
  {
    handle: 'basic',
    name: 'Basic',
    description: 'MeterMate Basic retainer — flat monthly consulting plan.',
    priceInCents: 9900n,
  },
  {
    handle: 'pro',
    name: 'Pro',
    description: 'MeterMate Pro retainer — flat monthly consulting plan.',
    priceInCents: 29900n,
  },
];

async function ensureProductFamily(): Promise<number> {
  const { result } = await maxio.productFamilies.listProductFamilies({});
  const existing = result.find((entry) => entry.productFamily?.handle === FAMILY_HANDLE);
  if (existing?.productFamily?.id) {
    log.info('Product family already exists', {
      handle: FAMILY_HANDLE,
      id: existing.productFamily.id,
    });
    return existing.productFamily.id;
  }

  const { result: created } = await maxio.productFamilies.createProductFamily({
    productFamily: {
      name: 'MeterMate Consulting',
      handle: FAMILY_HANDLE,
      description: 'MeterMate consulting plans and usage components.',
    },
  });
  const id = created.productFamily?.id;
  if (!id) throw new Error('Created product family returned no id');
  log.info('Created product family', { handle: FAMILY_HANDLE, id });
  return id;
}

async function ensurePlan(familyId: number, plan: PlanSeed): Promise<void> {
  // Detect existing product by handle.
  try {
    const { result } = await maxio.products.readProductByHandle(plan.handle);
    if (result.product?.id) {
      log.info('Plan already exists', { handle: plan.handle, id: result.product.id });
      return;
    }
  } catch {
    // Not found → fall through to create.
  }

  const { result } = await maxio.products.createProduct(String(familyId), {
    product: {
      name: plan.name,
      handle: plan.handle,
      description: plan.description,
      priceInCents: plan.priceInCents,
      interval: 1,
      intervalUnit: IntervalUnit.Month,
    },
  });
  log.info('Created plan', { handle: plan.handle, id: result.product?.id });
}

async function main(): Promise<void> {
  log.info('Seeding Maxio test site', { site: config.maxio.siteSubdomain, family: FAMILY_HANDLE });
  try {
    const familyId = await ensureProductFamily();
    for (const plan of PLANS) {
      await ensurePlan(familyId, plan);
    }

    // Print the resulting catalog for verification.
    const { result } = await maxio.products.listProducts({ perPage: 200 });
    const rows = result
      .map((e) => e.product)
      .filter((p): p is NonNullable<typeof p> => Boolean(p?.handle))
      .map((p) => `  - ${p.handle}: ${p.name} — $${(Number(p.priceInCents ?? 0n) / 100).toFixed(2)}/mo`);

    log.info('Seed complete');
    // eslint-disable-next-line no-console
    console.log(`\nSeeded plans in family "${FAMILY_HANDLE}":\n${rows.join('\n')}\n`);
  } catch (err) {
    const normalized = toMaxioServiceError(err, 'seed');
    log.error('Seed failed', { statusCode: normalized.statusCode, detail: normalized.detail });
    process.exit(1);
  }
}

void main();
