/**
 * Typed, validated environment configuration.
 *
 * The repo-root `.env` is the single source of credentials. We load it once at
 * module import, validate with Zod, and expose a frozen, typed `config` object.
 * Importing this module with an invalid environment fails fast with a clear
 * message rather than surfacing cryptic errors deep inside an SDK call.
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import dotenv from 'dotenv';
import { z } from 'zod';

// Resolve the repo root (.../metermate) from this file: server/src/config.ts → up 3.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');
const envPath = path.join(repoRoot, '.env');

if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
} else {
  // Fall back to default lookup (cwd) so containerized/CI runs still work.
  dotenv.config();
}

const booleanish = z
  .string()
  .transform((v) => v.trim().toLowerCase())
  .transform((v) => v === '1' || v === 'true' || v === 'yes');

const envSchema = z.object({
  // Maxio Advanced Billing
  MAXIO_API_KEY: z.string().min(1, 'MAXIO_API_KEY is required'),
  MAXIO_SITE_SUBDOMAIN: z.string().min(1, 'MAXIO_SITE_SUBDOMAIN is required'),
  MAXIO_ENVIRONMENT: z.enum(['US', 'EU']).default('US'),
  MAXIO_DEFAULT_PRODUCT_FAMILY: z.string().min(1).default('metermate-consulting'),

  // Slack
  SLACK_BOT_TOKEN: z.string().min(1, 'SLACK_BOT_TOKEN is required'),
  SLACK_DIGEST_CHANNEL: z.string().optional().default(''),

  // Admin (placeholder auth)
  ADMIN_USER: z.string().min(1).default('admin'),
  ADMIN_PASSWORD: z.string().min(1).default('changeme'),

  // App
  PORT: z.coerce.number().int().positive().default(4000),
  SESSION_TTL_MINUTES: z.coerce.number().int().positive().default(30),
  DEMO_MODE: booleanish.default('true'),
  DIGEST_CRON: z.string().optional().default('0 9 * * 1'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('\n');
  // eslint-disable-next-line no-console
  console.error(`\n[config] Invalid environment configuration:\n${issues}\n`);
  throw new Error('Invalid environment configuration. See messages above.');
}

const env = parsed.data;

/**
 * Demo consultant directory. The plan models consultants as labels on a
 * transaction (not Maxio entities), seeded from env. Each consultant has a
 * stable slug-based id used in channel names and the transaction store.
 */
export interface ConsultantConfig {
  id: string;
  name: string;
  /** Slack workspace email; when present and a member, enables a tier-1 invite. */
  email: string | null;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 40);
}

function loadConsultants(): ConsultantConfig[] {
  const found: ConsultantConfig[] = [];
  for (let i = 1; i <= 10; i += 1) {
    const name = process.env[`CONSULTANT_${i}_NAME`];
    if (!name || !name.trim()) continue;
    const emailRaw = process.env[`CONSULTANT_${i}_EMAIL`];
    const email = emailRaw && emailRaw.trim() ? emailRaw.trim() : null;
    found.push({ id: slugify(name), name: name.trim(), email });
  }
  if (found.length === 0) {
    // Sensible demo defaults so the consultant dropdown is never empty.
    return [
      { id: 'consultant-one', name: 'Consultant One', email: null },
      { id: 'consultant-two', name: 'Consultant Two', email: null },
    ];
  }
  return found;
}

export const config = Object.freeze({
  maxio: {
    apiKey: env.MAXIO_API_KEY,
    siteSubdomain: env.MAXIO_SITE_SUBDOMAIN,
    environment: env.MAXIO_ENVIRONMENT,
    defaultProductFamily: env.MAXIO_DEFAULT_PRODUCT_FAMILY,
  },
  slack: {
    botToken: env.SLACK_BOT_TOKEN,
    digestChannel: env.SLACK_DIGEST_CHANNEL,
  },
  admin: {
    user: env.ADMIN_USER,
    password: env.ADMIN_PASSWORD,
  },
  app: {
    port: env.PORT,
    sessionTtlMinutes: env.SESSION_TTL_MINUTES,
    demoMode: env.DEMO_MODE,
    digestCron: env.DIGEST_CRON,
  },
  consultants: loadConsultants(),
});

export type AppConfig = typeof config;

export { slugify };
