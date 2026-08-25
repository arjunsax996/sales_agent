# AI-Powered Product Repricing

A review tool for repricing a ~1,100-SKU chemical catalog: an AI pipeline generates a
priced recommendation with a rationale for every SKU, a reviewer works a prioritized
queue instead of 1,100 rows, and every override is persisted.

## Architecture

```
data/products.csv, data/notes.csv
        │
        ▼
scripts/seed.ts  ──▶  agent/ (LangGraph)  ──▶  Postgres (Prisma)
  (one-time batch)                                    │
                                                        ▼
                                          Next.js review UI (app/)
                                          reads/writes review state only
```

The LLM only runs in `scripts/seed.ts`, a batch job — mirroring how the business
actually reprices (an annual pass, not a live per-request call). The web app never calls
an LLM; it reads recommendations Postgres already has and writes review decisions back
to the same table. No API key needed at request time, only to (re)generate
recommendations.

### The repricing agent (`agent/`) — LangGraph

```
triage (code, no LLM)
  │ no sales history → formulaic price, skip LLM
  │ has sales history →
  ▼
extractNotes → buildStrategy → priceSkus → guardrailCritic ─┬─ issues found → retry priceSkus (max 2x)
                                                              └─ clean → finalize
```

- Grouped by base chemical, not SKU: ~221 base chemicals across multiple grades and pack
  sizes, so pricing a SKU in isolation throws away the context a human pricer would use
  ("IPA is under margin pressure across the board" applies to every pack size). ~221
  graph invocations instead of ~1,142.
- `triage` is deterministic. 57% of SKUs have zero prior-year sales, so there's no signal
  for an LLM to add over "hold last year's margin % against this year's cost." Skips the
  model entirely for the majority of the catalog; falls back to zero-markup pass-through
  and force-flags for review when even that formula is undefined (missing/zero price).
- `extractNotes` resolves informal CRM language ("IPA," "caustic") against one family's
  notes into typed directives, turning 130 unstructured notes into something
  `buildStrategy` can reason over per family.
- `buildStrategy` sets one target margin delta per family from cost/revenue/win-rate
  trends plus those note directives, weighting leadership directives over a single rep's.
- `priceSkus` applies that strategy per SKU, then reconciles the model's response against
  the SKUs actually asked about — drops hallucinated SKUs, force-flags any silently
  dropped.
- `guardrailCritic` (deterministic): margin floor, 30%-swing cap, and a cross-grade check
  (a lower grade shouldn't price above a higher grade at the same pack size — a bug that
  already existed in last year's data). Runs against every recommendation; a failure
  loops back to `priceSkus` with feedback, up to 2 retries, then force-flags.

### Scale: what actually gets surfaced

1. `needsHumanReview` is set throughout the pipeline, not bolted on after the fact.
2. `revenueImpact` (`|Δprice| × last year's revenue`) ranks flagged SKUs by dollars at
   stake, not alphabetically.
3. Bulk-approve clears everything the AI didn't flag in one click, so review is ~16% of
   the catalog, not all of it. (Was 83% until a bug got fixed — see below.)
4. A "why flagged" breakdown buckets review reasons (grade ordering, win-rate extremes,
   margin/cost) so a reviewer sees what kind of attention 187 SKUs need before opening
   one.
5. Auto-advance jumps the drawer to the next SKU needing a decision instead of a
   close-then-click round trip per row.

### Persistence

One `Product` table (Prisma/Postgres) holds catalog fields, the AI's recommendation and
rationale, and review state together, so progress survives a refresh or restart.
`scripts/seed.ts` persists per family as each finishes rather than buffering all 221 in
memory, so one family's OpenAI error doesn't cost the ones that already succeeded.

### Review UI (`app/`)

A Server Component does one pre-sorted `prisma.product.findMany`
(`needsHumanReview desc, revenueImpact desc`); a client component filters/searches that
in memory. Mutations (`approve` / `override` / `reset` / bulk-approve) are Server Actions
writing through Prisma with `revalidatePath`. Each row's drawer shows the SKU's own
rationale, the family-level strategy rationale (with the actual CRM note excerpts cited),
the specific guardrail reason if flagged, and an editable price with an override note.

### What actually broke

Two real bugs surfaced by running against live OpenAI calls and real Postgres data, not
just reading the code:

- `priceSkus`'s structured-output schema 400'd on every family — `.optional()` isn't
  allowed under OpenAI strict mode, only `.nullable()`. Failed on the first family of the
  first full run; fixed and re-ran clean across all 221.
- A guardrail rule flagged 86% of everything for the wrong reason: the cross-grade check
  treated "no grade in the product name" (512/1,142 SKUs — just missing data) the same as
  "unrecognized grade value" (a real anomaly). That single conflation generated 812 of
  943 flags. Fixed to skip blank grades silently, flagged count dropped to 187 (16%).
  Found by querying the actual `reviewReason` distribution in Postgres, not by
  inspection.

## Key design decisions

- Family-level graph, not per-SKU — fewer LLM calls, catches cross-grade bugs, matches
  how a human pricer thinks about a family of pack sizes/grades.
- Deterministic triage before any LLM call — no model call where there's no signal
  (no sales history) or no defined formula (missing last-year price).
- Batch job, not a live agent — mirrors the business's actual annual cadence, and means
  the deployed app works with no OpenAI key at request time.
- One Prisma table, not a normalized schema — `familyRationale` etc. denormalized onto
  every SKU; at 221 families × ~5 SKUs each, a join buys nothing.

## Tradeoffs

- No retry/backoff on OpenAI calls beyond the guardrail-driven reprice. A transient error
  drops that family; re-running `scripts/seed.ts` is safe (idempotent upserts) but not
  automatic.
- `extractNotes` sends all 130 notes to every family — fine at this scale, but no
  relevance filtering before the call.
- Concurrency is a fixed batch of 5 in one Node process, not a real job queue — a
  mid-run crash needs a full re-seed, not resumption.
- No auth, no multi-user review state, no per-user override attribution.
- `quote-agent/` (turns a company + requested chemicals/quantities into an ad-hoc quote,
  via an embedding index over base-chemical names) is reachable at `/quote`, reading live
  from the same `Product` table. Its embedding cache (`db/chemical-index.ts`) writes to a
  local JSON file — works locally and survives one warm Vercel instance (re-synced from
  Postgres each request), but doesn't durably cache across cold starts there. Real fix:
  move the cache into Postgres (`pgvector`), not done here.

## What I'd do with more time

- Real job runner (Inngest) for `scripts/seed.ts` with per-family retry, so a transient
  error doesn't drop a family and re-pricing one family doesn't require a full re-seed.
- Relevance/retrieval pass before `extractNotes` instead of sending all notes to every
  family (same idea already used in `quote-agent`'s chemical matching).
- Bulk actions within the flagged queue itself (multi-select, "approve all reason X"),
  not just "approve all unflagged."
- Sortable columns and family-grouped rows — sibling SKUs are scattered in the flat list
  today.
- CSV export of the reviewed price list — the only way out right now is querying
  Postgres directly.
- Audit trail (who overrode what, when) — needs auth, out of scope here.
- Wire `quote-agent/` into the review UI as a page calling `buildQuote` via a Server
  Action — it already reads the same data.

## Running it

```bash
npm install
# Postgres: point DATABASE_URL (.env) at any Postgres instance, e.g. a local
# `docker run -e POSTGRES_USER=repricing -e POSTGRES_PASSWORD=repricing \
#    -e POSTGRES_DB=repricing -p 5433:5432 postgres:16-alpine`
npx prisma migrate dev

# Set OPENAI_API_KEY in .env, then generate recommendations for the whole catalog:
npm run seed

npm run dev
# → http://localhost:3000
```

`quote-agent/` runs standalone via `npm run quote -- --company "..." --items <file.json>`
(defaults to `quote-agent/example-request.json`) — reads the same Postgres table
`npm run seed` populates.

## Deploying

`next build` succeeds with zero database access (review page is `dynamic =
"force-dynamic"`), and `postinstall: "prisma generate"` regenerates the client for
Vercel's build platform rather than shipping a locally-generated one. Provision a
Postgres reachable over the internet (Vercel Postgres/Neon, Supabase — local Docker only
works for local dev), set `DATABASE_URL` in Vercel's env vars, then run
`npx prisma migrate deploy` and `npm run seed` once from a machine with `OPENAI_API_KEY`
pointed at that production database. The seed job is a multi-minute batch of hundreds of
OpenAI calls — it should never run as a Vercel serverless function.
