// Central tunables for the RAG pipeline. Safe to edit freely; server and scripts
// both import this, so it must stay free of 'server-only' and env reads.

/**
 * Minimum cosine similarity a chunk needs to be used as context.
 * Tuned for all-MiniLM-L6-v2 (scripts/search.ts): irrelevant queries top out
 * around 0.20 (cricket 0.20, cake 0.10) while clearly-relevant ones score
 * 0.67-0.69 (merit formula). 0.45 sits above the noise ceiling with margin for
 * loosely-phrased on-topic questions and below the relevant band.
 */
export const SIMILARITY_THRESHOLD = 0.45;

/** How many chunks the match_chunks RPC asks for. */
export const TOP_K = 5;

/** How many past user/assistant messages go into the Groq prompt. */
export const HISTORY_MESSAGES = 6;

/** Hard cap on one user chat message. */
export const MAX_MESSAGE_CHARS = 1000;

// Groq retired the llama-3.x chat models (both previous values 404'd); these are
// models currently available to this key (verified via /v1/models + a live call).
export const GROQ_MODEL = "openai/gpt-oss-20b";
export const GROQ_FALLBACK_MODEL = "openai/gpt-oss-120b";

/** Exact refusal sentence (PROJECT.md rule 4). */
export const REFUSAL = "I don't have verified information on this.";
