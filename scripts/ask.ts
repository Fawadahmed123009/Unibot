// End-to-end offline check: npx tsx scripts/ask.ts "question"
// Runs retrieve() + streamGroq() with the real prompt, no auth, no DB writes.
import { config as loadEnv } from "dotenv";
import { join } from "node:path";

import { SIMILARITY_THRESHOLD } from "../lib/config";
import { streamGroq } from "../lib/groq";
import { buildMessages, extractCitations, isRefusal, retrieve } from "../lib/rag";

loadEnv({ path: join(process.cwd(), ".env.local") });

async function main() {
  const question = process.argv.slice(2).join(" ").trim();
  if (!question) {
    console.error('Usage: npx tsx scripts/ask.ts "question"');
    process.exit(1);
  }

  const { topSimilarity, chunks } = await retrieve(question);
  console.log(`topSimilarity: ${topSimilarity.toFixed(4)} (threshold ${SIMILARITY_THRESHOLD})`);

  if (chunks.length === 0) {
    console.log("REFUSED (no chunk passed the threshold)");
    return;
  }

  for (const chunk of chunks) {
    console.log(
      `  ${chunk.similarity.toFixed(4)}  ${chunk.metadata.document_name ?? "?"}  >  ${chunk.metadata.section_heading ?? "?"}`,
    );
  }

  let answer = "";
  for await (const token of streamGroq(buildMessages(question, chunks, []))) {
    answer += token;
    process.stdout.write(token);
  }
  process.stdout.write("\n\n");

  if (isRefusal(answer)) {
    console.log("REFUSED (model answered with the refusal)");
    return;
  }

  console.log("Citations:");
  for (const citation of extractCitations(answer, chunks)) {
    console.log(
      `  [${citation.n}] ${citation.document_name ?? "?"} > ${citation.section_heading ?? "?"}` +
        ` (session: ${citation.session ?? "?"}, status: ${citation.status ?? "?"}, similarity: ${citation.similarity.toFixed(4)})`,
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
