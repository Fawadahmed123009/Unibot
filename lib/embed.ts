// Embeddings run fully in-process with @xenova/transformers (no daemon, no API key).
// Model: Xenova/all-MiniLM-L6-v2 -> 384 dims, mean-pooled and L2-normalized, so the
// dot product pgvector uses (embedding <=> q) equals cosine similarity.
// No 'server-only' import: standalone scripts (scripts/*.ts) use this module too.

import { env, pipeline, type FeatureExtractionPipeline } from "@xenova/transformers";

const EMBEDDING_DIMENSIONS = 384;
const BATCH_SIZE = 10;
const MAX_RETRIES_PER_BATCH = 2;
const MODEL_ID = "Xenova/all-MiniLM-L6-v2";

// Server-side use: fetch weights from the Hub once and cache them on disk.
env.allowLocalModels = false;
env.useBrowserCache = false;

let extractorPromise: Promise<FeatureExtractionPipeline> | null = null;

// Load the model once and reuse it for every batch and every call.
function getExtractor(): Promise<FeatureExtractionPipeline> {
  if (!extractorPromise) {
    extractorPromise = pipeline("feature-extraction", MODEL_ID) as Promise<
      FeatureExtractionPipeline
    >;
  }
  return extractorPromise;
}

/**
 * Returns one 384-dim normalized vector per input text, in order.
 * Sends batches of 10 and retries a failed batch up to 2 times. Throws if any
 * returned vector is not exactly 384 finite numbers.
 */
export async function embed(texts: string[]): Promise<number[][]> {
  const extractor = await getExtractor();

  const vectors: number[][] = [];
  for (let start = 0; start < texts.length; start += BATCH_SIZE) {
    const batch = texts.slice(start, start + BATCH_SIZE);
    let lastError: unknown;
    for (let attempt = 0; attempt <= MAX_RETRIES_PER_BATCH; attempt++) {
      try {
        vectors.push(...(await embedBatch(extractor, batch)));
        lastError = undefined;
        break;
      } catch (error) {
        lastError = error;
      }
    }
    if (lastError !== undefined) {
      throw new Error(
        `embed failed for batch at index ${start} after ${MAX_RETRIES_PER_BATCH + 1} attempts: ${String(lastError)}`,
      );
    }
  }
  return vectors;
}

async function embedBatch(extractor: FeatureExtractionPipeline, batch: string[]): Promise<number[][]> {
  // A string[] input yields a [batch, 384] tensor; tolist() -> number[][].
  const output = await extractor(batch, { pooling: "mean", normalize: true });
  const vectors = output.tolist() as number[][];

  if (!Array.isArray(vectors) || vectors.length !== batch.length) {
    throw new Error("transformers returned an unexpected shape");
  }
  for (const vector of vectors) {
    const valid =
      Array.isArray(vector) &&
      vector.length === EMBEDDING_DIMENSIONS &&
      vector.every((value) => typeof value === "number" && Number.isFinite(value));
    if (!valid) {
      throw new Error(`transformers returned a vector that is not ${EMBEDDING_DIMENSIONS} numbers`);
    }
  }
  return vectors;
}
