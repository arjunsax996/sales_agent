/**
 * Embedding-based nearest-neighbor search over base chemical names.
 *
 * At today's ~221 base chemicals, sending the whole list into every quote
 * resolution prompt is cheap and fine. This exists for the catalog this
 * doesn't hold true for: at 10,000+ distinct chemicals, dumping the full
 * list into a prompt blows the token budget and dilutes the model's
 * attention across candidates that were never going to match. Instead,
 * Agent 1 (agent/cli.ts) keeps this index in sync after every batch run,
 * and Agent 2 (quote-agent) asks it for just the top-k nearest names per
 * requested item before ever calling the LLM.
 *
 * In-memory cosine similarity over cached embeddings is fine up to maybe
 * tens of thousands of vectors. Past that, swap this file's internals for a
 * real ANN index (pgvector, Pinecone, etc.) — searchChemicals()'s signature
 * wouldn't need to change, since callers only see "give me a name, get back
 * the k closest catalog names."
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, resolve } from "path";
import { OpenAIEmbeddings } from "@langchain/openai";

interface IndexEntry {
  baseChemical: string;
  embedding: number[];
}

const INDEX_FILE = resolve(process.cwd(), "db/chemical-index.json");
const EMBED_BATCH_SIZE = 500; // stay well under typical embeddings-API request limits
const embeddingsModel = new OpenAIEmbeddings({ model: "text-embedding-3-small" });

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

class ChemicalIndex {
  private entries = new Map<string, IndexEntry>();

  constructor() {
    this.load();
  }

  private load() {
    if (!existsSync(INDEX_FILE)) return;
    const raw: IndexEntry[] = JSON.parse(readFileSync(INDEX_FILE, "utf-8"));
    this.entries = new Map(raw.map((e) => [e.baseChemical, e]));
  }

  private persist() {
    // Best-effort: on a read-only filesystem (e.g. Vercel's serverless runtime)
    // this throws. The freshly-embedded vectors are already in `this.entries`
    // in memory, so search() still works for the rest of this process's
    // lifetime — it just won't survive a cold start there. Don't let a
    // caching failure take down the actual request.
    try {
      mkdirSync(dirname(INDEX_FILE), { recursive: true });
      writeFileSync(INDEX_FILE, JSON.stringify([...this.entries.values()], null, 2));
    } catch (err) {
      console.warn("chemicalIndex: couldn't persist to disk (read-only filesystem?) — continuing with in-memory cache only", err);
    }
  }

  // Only embeds names not already cached, in batches — cheap to call after
  // every batch reprice run even though the catalog rarely changes much
  // run to run, and safe to call against a catalog far bigger than today's.
  async sync(baseChemicals: string[]): Promise<void> {
    const missing = [...new Set(baseChemicals)].filter((name) => !this.entries.has(name));
    if (missing.length === 0) return;

    for (let i = 0; i < missing.length; i += EMBED_BATCH_SIZE) {
      const batch = missing.slice(i, i + EMBED_BATCH_SIZE);
      const vectors = await embeddingsModel.embedDocuments(batch);
      batch.forEach((baseChemical, j) => {
        this.entries.set(baseChemical, { baseChemical, embedding: vectors[j] });
      });
    }
    this.persist();
  }

  async search(query: string, k = 8): Promise<{ baseChemical: string; score: number }[]> {
    if (this.entries.size === 0) return [];
    const [queryVector] = await embeddingsModel.embedDocuments([query]);
    return [...this.entries.values()]
      .map((entry) => ({ baseChemical: entry.baseChemical, score: cosineSimilarity(queryVector, entry.embedding) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }

  isEmpty(): boolean {
    return this.entries.size === 0;
  }
}

export const chemicalIndex = new ChemicalIndex();
