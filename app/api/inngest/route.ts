import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/client";
import { repriceCatalogFn, repriceFamilyFn } from "@/lib/inngest/functions";

// A family with a guardrail retry (extra priceSkus round-trip) has taken
// ~24-30s in testing — the whole repriceFamily graph run is currently one
// Inngest step, not split per LLM call, so a single invocation of this
// route needs headroom above that. Raise further if your Vercel plan's cap
// allows and you see slower families in practice.
export const maxDuration = 60;

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [repriceCatalogFn, repriceFamilyFn],
});
