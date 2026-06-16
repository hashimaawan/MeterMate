# MeterMate

> A two-sided billing concierge: clients book and subscribe from a web form, **Maxio Advanced Billing** runs the billing, and a **private Slack channel per consultant↔client transaction** narrates every step — from "booking started" to "invoice paid."

MeterMate turns each billing action into a live, two-party conversation. A client submits a form (book a session, report usage, change plan, pause/cancel); the backend drives the matching Maxio operation and posts in-progress and completion updates into a private Slack channel scoped to that one consultant↔client pair. Different client → different channel. The consultant only ever sees the channels for transactions that involve them.

```
React form (client/admin)
      │  POST /api/<usecase>
      ▼
Express + Zod (+ adminGuard)
      │
      ├─▶ slackService.ensureTxnChannel()   create private channel, invite both parties, post "started"
      │
      ▼
maxioService.<operation>()                  billing op via the Maxio SDK
      │
      ├─ success ─▶ post completion block (+ "View in Maxio" / "Pay Invoice")
      └─ failure ─▶ post failure block      (billing is source of truth; Slack failures never block the response)
      ▼
JSON { status, txnId, channelId, ...result }
```

## Features

The build covers six end-to-end use cases (UC1–UC6):

| # | Use case | Actor | What it does |
| --- | --- | --- | --- |
| **UC1** | Book & Subscribe | Client | Creates the customer inline and a subscription on `basic` / `pro`; opens the transaction's Slack channel. |
| **UC2** | Report Usage | Client / Admin | Records metered usage (`consulting-minutes`) against the subscription and reads back the running period total. |
| **UC3** | Plan Change | Client / Admin | Previews the prorated delta, then applies the change — `prorate` now or `at-renewal`. |
| **UC4** | Lifecycle | Client / Admin | Pause, resume, cancel (immediate or end-of-period), reactivate. |
| **UC5** | Invoice Issue + Send | Admin | Creates → issues → optionally emails an itemized Maxio-hosted invoice with a public pay URL. |
| **UC6** | Billing Activity Digest | Admin | Per-consultant summary (active count, MRR, new signups, churn, open invoices) from live Maxio data. |

> **Pricing model (seeded):** flat monthly retainer — `basic` **$99/mo**, `pro` **$299/mo** — plus metered `consulting-minutes`. The consultant is a label on the transaction, not a rate.

## Tech stack

- **Backend** — TypeScript · Node ≥20 · Express 4 · Zod
- **Frontend** — React 19 · Vite 6 (SPA, dev proxy to the API)
- **Billing** — [`@maxio-com/advanced-billing-sdk`](https://www.npmjs.com/package/@maxio-com/advanced-billing-sdk) v9.1
- **Notifications** — [`@slack/web-api`](https://www.npmjs.com/package/@slack/web-api) v7 (bot-token app)
- **Layout** — npm workspaces monorepo (`server/` + `web/`)

## Project structure

```
metermate/
├── package.json              # npm workspaces: server + web
├── plan.md                   # full design spec (use cases, architecture, ACs)
├── server/                   # Express + TypeScript backend
│   └── src/
│       ├── index.ts          # bootstrap + route mounting
│       ├── app.ts            # Express app
│       ├── config.ts         # typed env loader
│       ├── auth.ts           # hardcoded admin creds + adminGuard
│       ├── maxioClient.ts    # Maxio SDK client (Basic auth + site + env)
│       ├── catalog.ts        # shared component/product catalog
│       ├── stores/           # in-memory session + transaction stores (DB-ready)
│       ├── routes/           # one route per UC + meta (/health, /products, /consultants)
│       ├── schemas/          # Zod request schemas per route
│       ├── services/
│       │   ├── maxioService.ts   # one fn per UC; no Express/Slack imports
│       │   └── slackService.ts   # ensureTxnChannel (two-tier invite) + Block Kit builders
│       └── scripts/seed.ts   # seeds the product family, plans, and metered component
└── web/                      # React SPA (Vite)
    └── src/
        ├── App.tsx           # Client | Admin role switch + sub-nav
        ├── api.ts            # typed fetch wrappers
        └── components/{client,admin}/   # one form per UC
```

## Getting started

### Prerequisites

- **Node.js ≥ 20** (developed on 20.15 / npm 10.7)
- A **Maxio Advanced Billing** test site + API key
- A **Slack app** with a bot token (`xoxb-…`) and scopes `chat:write`, `groups:write`, `users:read.email`, `groups:read`

### 1. Install

```bash
npm install
```

### 2. Configure environment

Copy `.env.example` to `.env` in the repo root and fill it in:

```env
# Maxio Advanced Billing
MAXIO_API_KEY=
MAXIO_SITE_SUBDOMAIN=your-test-site
MAXIO_ENVIRONMENT=US                 # US | EU
MAXIO_DEFAULT_PRODUCT_FAMILY=metermate-consulting

# Slack (bot-token app)
SLACK_BOT_TOKEN=xoxb-...
SLACK_DIGEST_CHANNEL=                 # optional; UC6 posts here if set

# Demo consultants (emails should be real Slack workspace members for tier-1 invites)
CONSULTANT_1_NAME=Consultant One
CONSULTANT_1_EMAIL=
CONSULTANT_2_NAME=Consultant Two
CONSULTANT_2_EMAIL=

# Admin (placeholder auth)
ADMIN_USER=admin
ADMIN_PASSWORD=changeme

# App
PORT=4000
SESSION_TTL_MINUTES=30
DEMO_MODE=true
```

### 3. Seed the Maxio test site

Creates the product family, the `basic` / `pro` plans, and the metered `consulting-minutes` component with explicit price points:

```bash
npm run seed
```

### 4. Run

The backend and frontend run in **two terminals**:

```bash
# Terminal 1 — API on :4000
npm run dev

# Terminal 2 — Vite SPA on :5173 (proxies /api → :4000)
npm run dev --workspace web
```

Open **http://localhost:5173**, switch between the **Client** and **Admin** roles, and watch each transaction appear in its own private Slack channel.

## API

All mutating responses share a `status`-discriminated shape: `{ status, txnId, channelId?, channelName?, ...payload }`.

```
POST /api/book                 { sessionId, firstName, lastName, email, consultantId, productHandle, collectionMethod, couponCode? }
POST /api/usage                { sessionId, txnRef, componentHandle, quantity, memo?, timestamp? }
POST /api/plan-change/preview  { sessionId, txnRef, targetHandle, timing }
POST /api/plan-change          { sessionId, txnRef, targetHandle, timing }
POST /api/lifecycle            { sessionId, txnRef, action, cancelType?, reason? }
POST /api/invoices             { sessionId, txnRef, lineItems, memo?, sendEmail }   (adminGuard)
POST /api/digest               { sessionId, consultantId, windowDays? }             (adminGuard)
GET  /api/health               → { status, sessions, transactions, maxioSite, slackOk }
GET  /api/products             → plan dropdown
GET  /api/components           → component catalog
GET  /api/consultants          → consultant dropdown
GET  /api/admin/check          → 200/401 (adminGuard; validates admin creds)
```

Admin routes use HTTP Basic auth (`ADMIN_USER` / `ADMIN_PASSWORD`).

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the API server (watch mode) |
| `npm run dev --workspace web` | Start the Vite dev server |
| `npm run build` | Compile the server (`tsc`) |
| `npm run typecheck` | Type-check the server |
| `npm test` | Run the server test suite (Vitest) |
| `npm run seed` | Seed the Maxio test site |

## How the Slack channel-per-transaction model works

`ensureTxnChannel` looks up each party by email and uses a **two-tier invite strategy**:

1. **Workspace member** → invited directly into the private channel (the clean demo path).
2. **Not a workspace member** → the channel is still created with the consultant + bot; the client is notified **by email** (Maxio emails hosted invoices/pay links), and the channel notes *"client notified by email."*

This is deliberate: there is no supported way to add a non-member to a private Slack channel, so MeterMate handles it honestly rather than pretending the happy path always works. The transaction store maps `(consultantId, clientEmail) → channelId`, so subsequent actions for the same pair **reuse** the existing channel.

## Notes & scope

- **State is in-memory** (session + transaction `Map`s, TTL-swept). Both stores expose `get/put/delete/sweep` so swapping to Redis/Postgres is a per-file change. Digest scope is limited to subscriptions created in the current server session.
- **Admin auth is a placeholder** (hardcoded env creds) with a clean seam for OAuth/JWT later.
- **Test mode only** — all Maxio calls target a test site, never live billing.
- **Out of scope** (by design): real auth, cross-org/external-client Slack invites, interactive Slack buttons, real payment-method capture, a persistent DB, and Maxio webhooks. See [`plan.md`](./plan.md) for the full rationale.

See [`plan.md`](./plan.md) for the complete design spec — use cases, architecture, failure isolation, and acceptance criteria.
