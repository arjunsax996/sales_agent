# AI-Powered Product Repricing

A review tool for repricing a ~1,100-SKU chemical catalog: an AI pipeline generates a
priced recommendation (with a written rationale) for every SKU, a reviewer works through
a prioritized queue instead of 1,100 rows, and every override is persisted.

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

The LLM only runs in `scripts/seed.ts`, a batch job — mirroring how the business actually
reprices (an annual pass over the whole catalog, not a live per-request call). The web
app never calls an LLM; it reads recommendations Postgres already has and writes review
decisions back to the same table. That split keeps the UI fast and cheap to run, and
means a demo doesn't need an API key at request time — only to (re)generate recommendations.

### The repricing agent (`agent/`) — LangGraph

```
triage (code, no LLM)
  │ no sales history → formulaic price, skip LLM
  │ has sales history →
  ▼
extractNotes → buildStrategy → priceSkus → guardrailCritic ─┬─ issues found → retry priceSkus (max 2x)
                                                              └─ clean → finalize
```

- **Grouped by base chemical, not by SKU.** The catalog has ~221 base chemicals, each
  sold across multiple grades (Technical/Industrial/ACS Reagent/USP-NF) and pack sizes.
  Pricing a SKU in isolation throws away exactly the context a human pricer would use —
  "IPA is under margin pressure across the board" applies to every pack size of IPA. The
  graph runs once per family, not once per SKU: ~221 graph invocations instead of ~1,142.
- **`triage` is deterministic, not an LLM call.** 57% of SKUs have zero prior-year sales
  (`prev_year_sales === 0`) — there's no win-rate signal to reason about, so there's
  nothing for an LLM to add over "hold last year's margin % against this year's cost."
  Skipping the LLM here is a real quality decision (nothing to reason about) and a real
  cost/latency win (the majority of the catalog needs 0 model calls). When holding margin
  flat isn't even meaningful (a missing/zero last-year price), it falls back to a
  zero-markup cost pass-through and force-flags the SKU for review rather than emitting
  a garbage number.
- **`extractNotes`** resolves informal CRM language ("IPA", "caustic") against one
  family's raw notes and returns typed directives (summary, sentiment, source excerpt) —
  this is the step that turns 130 unstructured notes into something `buildStrategy` can
  reason over per-family.
- **`buildStrategy`** sets one target margin delta for the whole family from aggregate
  cost/revenue/win-rate trends plus the note directives, favoring leadership-level
  directives over a single rep's opinion.
- **`priceSkus`** applies that strategy per SKU, adjusting for each SKU's own numbers,
  and reconciles the model's response against the SKUs it was actually asked about —
  dropping any hallucinated SKU, and force-flagging any SKU the model silently dropped
  rather than letting it vanish.
- **`guardrailCritic`** is deterministic (no LLM): margin floor, a 30%-swing cap, and a
  cross-grade check (a lower grade shouldn't be priced above a higher grade at the same
  pack size — a bug that already exists in last year's data, e.g. Sodium Bicarbonate
  USP/NF priced above ACS Reagent). It checks every recommendation for the family,
  formulaic and LLM-priced alike. A failure loops back to `priceSkus` with the specific
  issue as feedback, up to 2 retries; if issues remain after that, the SKU is force-flagged
  for human review instead of shipping a value nobody checked.

### Scale: what actually gets surfaced

With 1,100+ SKUs, the product decision that matters most is *what a human never has to
look at*. Five things do that work:

1. **`needsHumanReview`** is set throughout the pipeline (triage's cost-breach case,
   `priceSkus`'s margin/win-rate/cost-swing rules, `guardrailCritic`'s unresolved issues)
   — not bolted on after the fact.
2. **`revenueImpact`** (`|Δprice| × last year's revenue`) ranks flagged SKUs by dollars
   at stake, not alphabetically — a $200k product moving 8% outranks a $400 product
   moving 20%.
3. **Bulk-approve.** The review UI's default view is the flagged queue; everything the
   AI didn't flag can be cleared in one click ("Approve N unflagged recommendations")
   instead of 1,100 individual clicks. A reviewer's actual job becomes "look at the ~16%
   the pipeline couldn't confidently resolve," not "look at everything." (This number was
   943/1,142 — 83% — until a real bug got fixed; see "What actually broke" below.)
4. **A "why flagged" breakdown**, not just a count. The flagged queue buckets its own
   review reasons (grade ordering, win-rate extremes, margin/cost issues, ...) so a
   reviewer can see *what kind* of attention 187 SKUs need before opening a single one —
   useful both for triage and for noticing when one issue type is systemically noisy.
5. **Auto-advance.** Approving or overriding a SKU jumps the drawer straight to the next
   one in the current view that still needs a decision (skipping anything already
   resolved), instead of requiring a close-then-click-the-next-row round trip for every
   single item in a queue that can run into the hundreds.

### Persistence

One `Product` table (Prisma/Postgres) holds catalog fields, the AI's recommendation +
rationale, and the review state (`PENDING` / `APPROVED` / `OVERRIDDEN`, override price/note,
timestamp) together — a reviewer's progress and every override survive a refresh or a
server restart. `scripts/seed.ts` persists per family, as each one finishes, rather than
buffering all 221 results in memory and writing at the end — one family's OpenAI error
doesn't cost you the families that already succeeded.

### Review UI (`app/`)

Server Component (`page.tsx`) does one `prisma.product.findMany`, pre-sorted by
`needsHumanReview desc, revenueImpact desc`; a client component does filtering/search/tabs
against that in memory (1,100 rows is nothing for the browser — no reason to round-trip
to the server per keystroke). Mutations (`approve` / `override` / `reset` / bulk-approve)
are Next.js Server Actions that write straight through Prisma and `revalidatePath`.

Clicking a row opens a drawer with: the SKU's own rationale, the family-level strategy
rationale it came from (so "why did every pack size of this chemical move together" is
answered, not just "why did this one row move") — including the actual CRM note excerpts
(`familyCitedNotes`) `buildStrategy` cited, so a reviewer can check the AI's reasoning
against the source text instead of trusting its paraphrase of it — the specific
guardrail/review reason if flagged, and an editable price field with an optional
override note.

### What actually broke (and how it was found)

Two real bugs surfaced by running this against live OpenAI calls and the actual
Postgres data, not just by reading the code:

- **`priceSkus`'s structured-output schema 400'd on every family that reached it.**
  `reviewReason: z.string().optional()` — OpenAI's structured-output strict mode requires
  every schema property to be listed in `required`; `.optional()` violates that. First
  full seed run failed on the very first family it tried to reason about. Fixed to
  `.nullable()`, re-ran clean across all 221 families.
- **A guardrail rule was flagging 86% of everything for the wrong reason.** The
  cross-grade check treats "grade isn't in my known list" as an anomaly worth escalating
  to a human. About half the catalog's SKUs (512/1,142) simply have no grade word in
  their product name at all (`"Salicylic Acid, 2.5 kg"` — no grade stated), which isn't
  an anomaly, it's just missing data — but the code was treating "blank" and "weird
  unrecognized value" identically. That one distinction being wrong was single-handedly
  generating 812 of 943 flags (86%). Fixed `guardrailCritic` to skip the comparison
  silently on a blank grade while still escalating a genuinely unrecognized non-empty
  one, re-seeded, flagged count dropped to 187 (16%) with the grade-ambiguity reason
  gone entirely. Found by querying the actual `reviewReason` distribution in Postgres
  after seeding, not by inspection — the lesson being that a plausible-looking guardrail
  rule can still make the "surface what needs attention" story worse instead of better if
  nobody checks its actual hit rate against real data.

## Key design decisions

- **Family-level graph, not per-SKU.** Covered above — this is the single decision that
  shapes the rest of the pipeline (fewer LLM calls, catches cross-grade bugs, matches how
  a human pricer actually thinks about a family of pack sizes/grades).
- **Deterministic triage before any LLM call.** Don't spend a model call reasoning about
  data that has no signal to reason from (no sales history) — and don't let an LLM guess
  at a price when the formula itself is undefined (zero/missing last-year price).
- **Batch job, not a live agent behind every page load.** The business reprices once a
  year over months; the product should mirror that cadence, not pretend it's a chatbot.
  This also means the deployed web app has a real answer for "what happens with no
  OpenAI key at request time" — nothing calls one.
- **One Prisma table, not a normalized schema.** `familyRationale`/
  `familyTargetMarginDeltaPct` are denormalized onto every SKU in that family rather than
  living in a separate `FamilyStrategy` table joined at read time. At this scale (221
  distinct values duplicated across ~5 SKUs each) the join buys nothing and the review UI
  never needs to query at the family level independently of its SKUs.

## Tradeoffs

- **No retry/backoff around the OpenAI calls themselves** beyond the guardrail-driven
  `priceSkus` retry (which reprices, not retries a failed request). A transient API error
  fails that one family; `scripts/seed.ts` is safe to re-run (upserts are idempotent) but
  doesn't automatically retry failed families in the same invocation.
- **`extractNotes` sends the full 130-note dump to every one of the 221 families.** Fine
  at this scale (130 notes is nothing token-wise), but doesn't pre-filter notes by
  relevance before the call — it relies entirely on the model to ignore irrelevant notes
  per-family. Would need a retrieval step first at real CRM-note volume.
- **Concurrency is a fixed batch size (5) inside a single Node process**, not a real job
  queue. Fine for 221 families; the actual `for` loop in `agent/run.ts` is the place a
  crash mid-run would need external tracking (job status, resumability) to be handled
  properly rather than "re-run the whole seed."
- **No auth, no multi-user review state** — out of scope per the brief, but a real
  version needs per-user attribution on overrides (who approved/overrode what).
- A second agent (`quote-agent/` — turns a company + a list of requested chemicals/
  quantities into an ad-hoc customer quote, using an embedding index over base-chemical
  names so it scales past today's 221 names) is now reachable from the app itself, at
  `/quote` (`app/quote/page.tsx` + `app/quote/actions.ts`), alongside the review board at
  `/` — a "Review" / "New Quote" nav switches between them. It reads live from the same
  Postgres `Product` table as the review app, so a quote always reflects the latest
  approved/overridden prices, not a stale snapshot. **One real limitation carried over
  from before it had a page**: `db/chemical-index.ts` (the embedding cache the quote flow
  searches against) writes to a local JSON file — fine for `npm run dev` or `npm run quote`
  locally, but that write would fail on Vercel's read-only filesystem in production. It's
  synced fresh from Postgres on every quote request (cheap — only new names get embedded),
  so it still *works* on a fresh Vercel deployment for the length of one warm serverless
  instance, but doesn't durably cache across cold starts there the way it does locally.
  The real fix is moving the cache into Postgres (a `chemical_embeddings` table, or
  `pgvector`) instead of a local file — not done here, flagged as a known gap.

## What I'd do with more time

- Wire `scripts/seed.ts` into an actual job runner (Inngest fits the suggested stack)
  with per-family retry/backoff, so a transient OpenAI error doesn't just drop that
  family from the run — and so re-pricing a single family (e.g. after a new sales note
  comes in) doesn't require re-running the whole catalog.
- A relevance/retrieval pass before `extractNotes` (embed notes once, pull only the
  top-k per family) instead of sending all 130 notes to every family — same idea already
  applied to `quote-agent`'s chemical-name matching, not yet applied to notes.
- **Bulk action within the flagged queue itself**, not just "approve all unflagged" — at
  187 SKUs it's far more tractable than 943 was, but still too many to click through one
  at a time. Multi-select + "approve selected," or "approve everything flagged only for
  reason X," is the natural next lever now that the "why flagged" breakdown makes those
  categories visible.
- **Sortable table columns and family-grouped rows.** Sort order is fixed server-side
  today; sibling SKUs of the same chemical are scattered in the flat list even though
  they usually share a family rationale word-for-word.
- **A final export** — "download the reviewed price list" (SKU, effective price,
  status) as a CSV. Right now the only way to get reviewed data back out is querying
  Postgres directly, but a repricing tool's actual deliverable to the business is a clean
  price list, not a database.
- Audit trail: who overrode what and when (needs auth, which is explicitly out of scope
  here, but is the natural next requirement once more than one person reviews).
- Wire `quote-agent/` into the same review UI (a "New Quote" page calling `buildQuote`
  via a Server Action) now that it already reads the same Postgres data — the remaining
  gap is a page, not a data layer.

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
(defaults to `quote-agent/example-request.json`) if you want to exercise it outside the
web app — it reads the same Postgres table `npm run seed` populates.

## Deploying

The app is Vercel-ready: `next build` succeeds with zero database access (the review
page is explicitly `dynamic = "force-dynamic"`, so nothing tries to hit Postgres at
build time — verified by running the build with the database stopped entirely), and
`postinstall: "prisma generate"` in `package.json` regenerates the Prisma Client for
whatever platform Vercel's build runs on, rather than shipping whatever got generated
locally. Provision a Postgres reachable over the internet (Vercel Postgres/Neon or
Supabase both work — local Docker Postgres only works for local dev), set `DATABASE_URL`
in the Vercel project's env vars, then run `npx prisma migrate deploy` and `npm run seed`
once from a machine with `OPENAI_API_KEY` pointed at that same production database
before or after the first deploy — the seed job is a multi-minute batch process making
hundreds of OpenAI calls, so it should never run as a Vercel serverless function.
