# AI-Powered Product Repricing

A review tool for a ~1,100-SKU chemical catalog: a pipeline prices and justifies every
SKU, a reviewer works a prioritized queue instead of all 1,100 rows, and every override
is persisted. Two supporting tools share the same data — a browser-based batch
re-pricing flow, and a quote generator that drafts a priced customer email.

## Architecture

```
data/products.csv, data/notes.csv
        │
        ├──▶ scripts/seed.ts (CLI)  ──┐
        │                             ▼
        └──▶ app/batch (upload) ──▶ agent/ (LangGraph)  ──▶  Postgres (Prisma)
                  via Inngest                                      │
                                                                    ▼
                                                    Next.js UI: review (/), quote (/quote)
```

Recommendations come from two entry points into the same `agent/` pipeline: the CLI
(`npm run seed`) for the initial load, and `/batch` for re-running it from the browser.
Both write to the `Product` table. The review UI (`/`) only reads/writes review state
there — it never calls an LLM. `/quote` is the exception: it calls the LLM live, per
request.

## The repricing agent (`agent/`) — LangGraph

```
START -> triage -+-> (no SKUs need reasoning) ---------------+
                  |                                          |
                  +-> (some SKUs need reasoning) -> buildStrategy
                                                         |     |
                                                         v     |
                                                     priceSkus |
                                                         |     |
                                                         v     v
                                                   guardrailCritic -(retry, LLM path only)-> priceSkus
                                                                        |
                                                                     (done)
                                                                        v
                                                                     finalize -> END
```

- **`triage`** (no LLM): ~57% of SKUs have no prior-year sales, so there's nothing to
  reason about — those get a formulaic hold-last-year's-margin price. Only SKUs with real
  sales history reach the reasoning path.
- **Note routing** (`agent/note-routing.ts`) runs once per catalog run, not per family.
  It chunks reasoning-path families into groups of ~20 and asks the model, once per
  chunk, which CRM notes apply to which family — avoiding 150+ redundant LLM calls
  against the same ~130-note corpus.
- **`buildStrategy`** sets one target margin delta per family from cost/revenue/win-rate
  trends plus its routed note directives.
- **`priceSkus`** applies that strategy per SKU, then reconciles the response against the
  SKUs actually asked about: drops hallucinated SKUs, dedupes repeats, force-flags any
  the model silently dropped.
- **`guardrailCritic`** (no LLM): margin floor, 30%-swing cap, cross-grade ordering check.
  Runs against every recommendation; a failure loops back to `priceSkus` with feedback,
  up to 2 retries, then force-flags for review.
- Runs once per base-chemical family (~221) rather than per SKU (~1,100), so a strategy
  is reasoned about once per chemical and applied across its pack-size/grade variants.

Every LLM call retries transient errors (429s, 5xx, timeouts) with backoff via
`shared/retry.ts`'s `withRetry`, 3 attempts before giving up on that family alone.

### Two ways to run the pipeline

- **`scripts/seed.ts`** (CLI) — a 15-worker pool (`agent/run.ts`) pulls families off a
  shared queue, persisting each as it finishes.
- **`/batch`** (browser) — same pipeline, run through Inngest instead of the worker pool
  (see below), so it isn't bound to one process or one request.

## Batch updates (`/batch`) — Inngest

A multi-minute, hundreds-of-LLM-call job can't run inside one web request — Vercel kills
serverless functions once the response is sent, long before 221 families finish. Instead:
uploading a CSV creates a `BatchJob` row in Postgres (durable progress; an in-memory
variable wouldn't survive a serverless cold start) and sends one Inngest event. One
function groups the upload into families and routes notes once, then fans out one event
per family. A second function processes each family independently — concurrency-limited
to 5 (Inngest's free-tier cap) — so every HTTP invocation does only one family's work,
well under any serverless timeout, and atomically advances the `BatchJob` row until every
family is accounted for. The page polls that row every 2 seconds. Unaffected SKUs' review
state is left untouched; new SKUs are added, existing ones get fresh recommendations.

## Quotes (`/quote`)

Turns a company + requested chemicals/quantities into a priced, AI-drafted email.
Informal names ("IPA", "caustic soda") resolve against an embedding index over the
catalog's ~221 base chemical names (`db/chemical-index.ts`), matched against only the
top-k nearest candidates rather than the whole catalog. Primary output is the drafted
email; an itemized breakdown sits below it. Without `OPENAI_API_KEY`, falls back to a
substring match and a templated, non-AI email instead of failing outright.

## Persistence and review UI

One `Product` table (Prisma/Postgres) holds catalog fields, the AI's recommendation and
rationale, and review state together — no join, since ~221 families × ~5 SKUs each makes
a separate family table pointless. A Server Component runs one pre-sorted
`findMany` (`needsHumanReview desc, revenueImpact desc`); a client component
filters/searches/paginates in memory. Mutations are Server Actions through Prisma with
`revalidatePath`. Each row's drawer shows the SKU's rationale, the family strategy
rationale (with cited note excerpts), the guardrail reason if flagged, and an editable
price with an override note. `revenueImpact` ranks flagged SKUs by dollars at stake, and
bulk-approve clears everything unflagged in one click.

## Tradeoffs and known limitations

- **`scripts/seed.ts`'s worker pool isn't resumable** — a crash mid-run needs a full
  re-seed (safe, since upserts are idempotent, just not efficient). `/batch`'s Inngest
  path doesn't have this problem.
- **`quote-agent`'s embedding cache is a local JSON file**, not Postgres — survives
  within one warm serverless instance but not across cold starts on Vercel. `pgvector`
  would fix that.
- **A family's whole graph run is one Inngest step**, not one per LLM call. A guardrail
  retry has taken ~24-30s in testing — under the `maxDuration = 60` on
  `app/api/inngest/route.ts`, but more retries could need that raised, or the step split.
- **No auth, no multi-user review state, no per-user override attribution.**

## What's next

- Move `quote-agent`'s embedding cache into Postgres (`pgvector`).
- Split `repriceFamily`'s Inngest step into one step per graph node.
- Bulk actions within the flagged queue itself, not just "approve all unflagged."
- Sortable columns and family-grouped rows — sibling SKUs are scattered today.
- CSV export of the reviewed price list.
- Audit trail (who overrode what, when) — needs auth.

## Running it locally

```bash
npm install

# Postgres — point storage_PRISMA_DATABASE_URL (.env) at any Postgres instance, e.g.:
#   docker run -e POSTGRES_USER=repricing -e POSTGRES_PASSWORD=repricing \
#     -e POSTGRES_DB=repricing -p 5433:5432 postgres:16-alpine
npx prisma migrate dev

# OPENAI_API_KEY in .env, then generate recommendations for the whole catalog:
npm run seed

npm run dev
# → http://localhost:3000
```

`/batch` also needs a local Inngest dev server (Inngest orchestrates the fan-out even in
dev):

```bash
# .env: INNGEST_DEV=1
npx inngest-cli dev -u http://localhost:3000/api/inngest
```

`quote-agent` runs standalone via
`npm run quote -- --company "..." --items <file.json>` (defaults to
`quote-agent/example-request.json`), reading the same Postgres table `npm run seed`
populates.

## Deploying

Deployed on Vercel with a Postgres provider supplying `storage_PRISMA_DATABASE_URL` —
update `prisma/schema.prisma`'s `datasource` block if your provider names it differently.
`build` runs `prisma migrate deploy && next build`, so every deploy self-migrates through
Vercel's build-time environment. No manual `migrate deploy` against production — and for
a "Sensitive"-marked Vercel variable, none is possible, since those are write-only after
creation and `vercel env pull` can't retrieve them.

For `/batch` in production: install the Inngest Vercel integration (or set
`INNGEST_EVENT_KEY`/`INNGEST_SIGNING_KEY` manually) — it also syncs the app's functions
on deploy. Keep `repriceFamilyFn`'s `concurrency` at or below your Inngest plan's limit
(5 on free); exceeding it makes Inngest silently reject the whole function sync, leaving
nothing registered to process queued events.

`.vercelignore` excludes `.env`/`.env.local`/`.env.*.local`, since `vercel deploy` doesn't
reliably respect `.gitignore` for them — a leaked `.env` with `INNGEST_DEV=1` set would
make production try reaching a local-only Inngest dev server instead of Inngest Cloud.

Set `OPENAI_API_KEY` in Vercel's env vars for `/batch`/`/quote` to run their real LLM
paths; without it, `/batch` refuses to start and `/quote` falls back to placeholder mode.
